//go:build !android

package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/v0-0x/kumobox-movies/server/internal/share"
	"github.com/v0-0x/kumobox-movies/server/internal/stream"
	"github.com/v0-0x/kumobox-movies/server/internal/torrentstream"
)

// A torrent being played is read by ffprobe (and ffmpeg) through the stream
// relay, as an online stream is: the in-app player probes it to know
// whether to play it as it is or convert it.
func TestTorrentThroughTheRelay(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("no ffmpeg")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("no ffprobe")
	}
	s := newTestServer(t)
	useTorrentCache(t, s)
	dir := seedDir(t)
	name := "Test.Movie.2020.mkv"
	video := filepath.Join(dir, name)
	cmd := exec.Command(ffmpeg, "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=24", "-f", "lavfi", "-i", "sine=duration=4",
		"-c:v", "libx264", "-c:a", "aac", "-shortest", "-y", video)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg couldn't make a video: %v %s", err, out)
	}
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(video); err != nil {
		t.Fatal(err)
	}
	var mi metainfo.MetaInfo
	if mi.InfoBytes, err = bencode.Marshal(info); err != nil {
		t.Fatal(err)
	}
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir, cfg.Seed, cfg.NoDHT, cfg.DisableIPv6, cfg.ListenPort = dir, true, true, true, 0
	seeder, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer seeder.Close()
	tor, err := seeder.AddTorrent(&mi)
	if err != nil {
		t.Fatal(err)
	}
	if err := tor.VerifyData(); err != nil {
		t.Fatal(err)
	}
	h := mi.HashInfoBytes()
	magnet := mi.Magnet(&h, &info).String() + fmt.Sprintf("&x.pe=127.0.0.1:%d", seeder.LocalPort())

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	st, err := s.app.TorrentStream.Open(ctx, magnet, nil)
	if err != nil {
		t.Fatal(err)
	}
	remote := stream.RegisterRemoteHandler("torrent:"+st.ID, s.app.TorrentStream.Handler(st.ID))
	p, err := s.app.Local.Probe(ctx, remote)
	if err != nil {
		t.Fatal(err)
	}
	if p.Duration < 3.5 || len(p.Video) != 1 || p.Video[0].Codec != "h264" || len(p.Audio) != 1 {
		t.Fatalf("probe %+v", p)
	}
	// What the player is told: H.264 and AAC play as they are.
	if p.Method != "direct" {
		t.Fatalf("method %s: %s", p.Method, p.Reason)
	}
}

// A torrent played from the app (a streaming addon's, or a Torrents tab
// result) plays as it downloads: the in-app player gets its file here, and
// the "remote:" path to convert it.
func TestTorrentStreamPlay(t *testing.T) {
	s := newProvidersServer(t)
	useTorrentCache(t, s)
	dir := seedDir(t)
	name := "The.Dark.Knight.2008.1080p.mp4"
	data := make([]byte, 700<<10)
	for i := range data {
		data[i] = byte(i * 7)
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	var mi metainfo.MetaInfo
	var err error
	if mi.InfoBytes, err = bencode.Marshal(info); err != nil {
		t.Fatal(err)
	}
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir, cfg.Seed, cfg.NoDHT, cfg.DisableIPv6, cfg.ListenPort = dir, true, true, true, 0
	seeder, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer seeder.Close()
	tor, err := seeder.AddTorrent(&mi)
	if err != nil {
		t.Fatal(err)
	}
	if err := tor.VerifyData(); err != nil {
		t.Fatal(err)
	}
	h := mi.HashInfoBytes()
	magnet := mi.Magnet(&h, &info).String() + fmt.Sprintf("&x.pe=127.0.0.1:%d", seeder.LocalPort())

	var played struct {
		Action  string
		Sources []struct {
			URL, Remote, Filename, Torrent string
			NotWebReady                    bool
		}
		Torrent struct{ ID, Name string }
	}
	stream := map[string]any{"id": "torrent:x", "kind": "torrent", "provider": "torrents", "title": name, "magnet": magnet, "fileIdx": -1}
	w := do(s, "POST", "/api/providers/play", local, jsonBody(t, map[string]any{"mediaId": 155, "stream": stream, "player": "builtin"}), nil)
	decodeBody(t, w, &played)
	if played.Action != "builtin" || len(played.Sources) != 1 || played.Sources[0].Filename != name || played.Sources[0].NotWebReady || played.Sources[0].Torrent == "" ||
		!strings.HasPrefix(played.Sources[0].Remote, "remote:") {
		t.Fatalf("played: %d %+v", w.Code, played)
	}
	// Its file, a range of it as a seek asks.
	r := do(s, "GET", played.Sources[0].URL, local, "", func(r *http.Request) { r.Header.Set("Range", "bytes=300000-300099") })
	if r.Code != http.StatusPartialContent || !bytes.Equal(r.Body.Bytes(), data[300000:300100]) {
		t.Fatalf("file: %d, %d bytes", r.Code, r.Body.Len())
	}
	if w := do(s, "GET", "/api/torrentstream/"+played.Sources[0].Torrent, local, "", nil); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"name":"`+name+`"`) {
		t.Fatalf("status: %d %s", w.Code, w.Body)
	}
	if w := do(s, "DELETE", "/api/torrentstream/"+played.Sources[0].Torrent, local, "", nil); w.Code != http.StatusOK {
		t.Fatalf("stop: %d", w.Code)
	}
	if w := do(s, "GET", played.Sources[0].URL, local, "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("after stop: %d", w.Code)
	}
}

// seedDir is a temporary folder for a seeder's files, removed after the
// test as well as it can be: on Windows, a file a client has just closed
// can't be removed at once (t.TempDir would fail the test).
func seedDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "seed-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 50 && os.RemoveAll(dir) != nil; i++ {
			time.Sleep(100 * time.Millisecond)
		}
	})
	return dir
}

// useTorrentCache gives the app's torrent engine a cache the test removes
// as well as it can (on Windows the BitTorrent library may keep a file
// open until the program ends: in t.TempDir that would fail the test).
func useTorrentCache(t *testing.T, s *Server) {
	t.Helper()
	s.app.TorrentStream = torrentstream.New(filepath.Join(seedDir(t), "cache"))
	t.Cleanup(s.app.TorrentStream.Close)
}

// A device with no BitTorrent client (a TV) has the computer its downloads
// go to stream the torrent: the player reads it from there, through this
// Moviko, and no other device may.
func TestTorrentStreamThroughHost(t *testing.T) {
	_ = newCatalogServer(t) // its TMDB stand-in, for the servers below
	host, hostSrv := sharingServer(t)
	guest, _ := sharingServer(t)
	useTorrentCache(t, host)
	guest.app.TorrentStream.Unavailable = true
	cfg := guest.app.Settings.Get()
	cfg.TMDB.APIKey, cfg.Providers.Archive = testTMDBKey, false
	if _, err := guest.app.Settings.Save(cfg); err != nil {
		t.Fatal(err)
	}
	stream := func(magnet, name string) string {
		return jsonBody(t, map[string]any{"mediaId": 155, "player": "builtin",
			"stream": map[string]any{"id": "torrent:x", "kind": "torrent", "provider": "torrents", "title": name, "magnet": magnet, "fileIdx": -1}})
	}
	// No computer takes its downloads: said so.
	if w := do(guest, "POST", "/api/providers/play", local, stream("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567", "x"), nil); w.Code != http.StatusBadRequest {
		t.Fatalf("without a computer: %d %s", w.Code, w.Body)
	}

	addr := strings.TrimPrefix(hostSrv.URL, "http://")
	if w := do(guest, "POST", "/api/sharing/connect", local, `{"address":"`+addr+`"}`, nil); w.Code != http.StatusOK {
		t.Fatalf("connect: %d %s", w.Code, w.Body)
	}
	eventually(t, "the host to list the guest", func() bool { _, ok := peerIn(host, guest); return ok })
	gid, hid := guest.app.Share.ID(), host.app.Share.ID()
	yes := true
	if err := host.app.Share.SetAllowed(gid, true); err != nil {
		t.Fatal(err)
	}
	if err := host.app.Share.SetGrants(gid, share.Grants{Downloads: &yes}); err != nil {
		t.Fatal(err)
	}
	eventually(t, "downloads to go to the host", func() bool {
		do(guest, "POST", "/api/sharing/refresh", local, "{}", nil)
		return guest.app.Settings.Get().Sharing.DownloadTo == hid
	})

	dir := seedDir(t)
	name := "The.Dark.Knight.2008.1080p.mp4"
	data := make([]byte, 700<<10)
	for i := range data {
		data[i] = byte(i * 11)
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	var mi metainfo.MetaInfo
	var err error
	if mi.InfoBytes, err = bencode.Marshal(info); err != nil {
		t.Fatal(err)
	}
	tcfg := torrent.NewDefaultClientConfig()
	tcfg.DataDir, tcfg.Seed, tcfg.NoDHT, tcfg.DisableIPv6, tcfg.ListenPort = dir, true, true, true, 0
	seeder, err := torrentstream.NewClientRetrying(tcfg)
	if err != nil {
		t.Fatal(err)
	}
	defer seeder.Close()
	tor, err := seeder.AddTorrent(&mi)
	if err != nil {
		t.Fatal(err)
	}
	if err := tor.VerifyData(); err != nil {
		t.Fatal(err)
	}
	h := mi.HashInfoBytes()
	magnet := mi.Magnet(&h, &info).String() + fmt.Sprintf("&x.pe=127.0.0.1:%d", seeder.LocalPort())

	var played struct {
		Action  string
		Sources []struct {
			URL, Remote, Filename, Torrent string
		}
	}
	w := do(guest, "POST", "/api/providers/play", local, stream(magnet, name), nil)
	decodeBody(t, w, &played)
	if played.Action != "builtin" || len(played.Sources) != 1 || played.Sources[0].Filename != name || !strings.HasPrefix(played.Sources[0].Torrent, hid+".") ||
		!strings.HasPrefix(played.Sources[0].Remote, "remote:") {
		t.Fatalf("played: %d %s", w.Code, w.Body)
	}
	id := played.Sources[0].Torrent
	sid := strings.TrimPrefix(id, hid+".")
	// Its file, read from the host: a range of it as a seek asks.
	r := do(guest, "GET", played.Sources[0].URL, local, "", func(r *http.Request) { r.Header.Set("Range", "bytes=300000-300099") })
	if r.Code != http.StatusPartialContent || !bytes.Equal(r.Body.Bytes(), data[300000:300100]) {
		t.Fatalf("file: %d, %d bytes", r.Code, r.Body.Len())
	}
	if w := do(guest, "GET", "/api/torrentstream/"+id, local, "", nil); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"name":"`+name+`"`) || !strings.Contains(w.Body.String(), `"id":"`+id+`"`) {
		t.Fatalf("status: %d %s", w.Code, w.Body)
	}
	// Not for a browser on the host's network, nor without the grant.
	if w := do(host, "GET", "/api/peer/torrentstream/"+sid+"/file", lan, "", nil); w.Code == http.StatusOK || w.Code == http.StatusPartialContent {
		t.Fatalf("the torrent, unsigned: %d", w.Code)
	}
	if host.ownsTorrent("someone-else", sid) || !host.ownsTorrent(gid, sid) {
		t.Fatal("the torrent isn't the guest's alone")
	}
	if w := do(guest, "DELETE", "/api/torrentstream/"+id, local, "", nil); w.Code != http.StatusOK {
		t.Fatalf("stop: %d %s", w.Code, w.Body)
	}
	if _, ok := host.app.TorrentStream.Status(sid); ok {
		t.Fatal("still streamed on the host after the stop")
	}
	if w := do(guest, "GET", played.Sources[0].URL, local, "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("after stop: %d", w.Code)
	}
}
