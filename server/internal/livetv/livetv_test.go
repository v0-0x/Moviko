package livetv

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/db"
)

const playlist = `#EXTM3U url-tvg="https://guide.example/epg.xml.gz, https://other.example/x.xml"
#EXTINF:-1 tvg-id="HumTV.pk@SD" tvg-logo="https://img.example/hum.png" group-title="Entertainment;Urdu" tvg-chno="7",Hum TV (720p)
https://a.example/hum/index.m3u8
#EXTINF:-1 tvg-id="LoveNature.ca" group-title="Documentary",Love Nature, 4K
#EXTVLCOPT:http-referrer=https://ln.example/
#EXTVLCOPT:http-user-agent=Player/1
https://b.example/ln.m3u8
#EXTINF:-1 tvg-id="ARD.de" http-referrer="https://ard.example/" group-title="General",Das Erste Ⓖ
https://c.example/ard.m3u8|User-Agent=VLC%2F3&referrer=https%3A%2F%2Fpipe.example%2F&Host=evil.example
#EXTINF:-1 tvg-name="By name" group-title="News",
https://d.example/news.ts
#EXTINF:-1,Radio over RTMP
rtmp://e.example/live
#EXTINF:-1 tvg-logo="javascript:alert(1)",A page
https://www.youtube.com/watch?v=abcdefghijk
#EXTGRP:Kids
https://f.example/orphan.m3u8
`

func TestParseM3U(t *testing.T) {
	list, guide := ParseM3U("src", playlist)
	if guide != "https://guide.example/epg.xml.gz" {
		t.Errorf("guide = %q", guide)
	}
	if len(list) != 5 {
		t.Fatalf("%d channels: %+v", len(list), list)
	}
	hum := list[0]
	if hum.Name != "Hum TV (720p)" || hum.EPGID != "HumTV.pk@SD" || hum.Country != "PK" || hum.Number != 7 || hum.Group != "Entertainment;Urdu" || hum.Logo != "https://img.example/hum.png" || hum.URL != "https://a.example/hum/index.m3u8" {
		t.Errorf("hum = %+v", hum)
	}
	if g := hum.Groups(); len(g) != 2 || g[1] != "Urdu" {
		t.Errorf("groups = %v", g)
	}
	// A name with a comma; the headers of its #EXTVLCOPT lines.
	if ln := list[1]; ln.Name != "Love Nature, 4K" || ln.Headers["Referer"] != "https://ln.example/" || ln.Headers["User-Agent"] != "Player/1" {
		t.Errorf("love nature = %+v", ln)
	}
	// Region-locked by its mark, which isn't part of the name; headers
	// after the address win, and none may name another host.
	ard := list[2]
	if ard.Name != "Das Erste" || !ard.RegionLocked || ard.Country != "DE" || ard.URL != "https://c.example/ard.m3u8" {
		t.Errorf("ard = %+v", ard)
	}
	if ard.Headers["User-Agent"] != "VLC/3" || ard.Headers["Referer"] != "https://pipe.example/" || ard.Headers["Host"] != "" {
		t.Errorf("ard headers = %v", ard.Headers)
	}
	if list[3].Name != "By name" || list[3].Number != 4 {
		t.Errorf("by name = %+v", list[3])
	}
	// Not a web address: left out. A logo that isn't one: none.
	if list[4].Name != "A page" || list[4].Logo != "" || webPage(list[4].URL) != "YouTube" {
		t.Errorf("page = %+v", list[4])
	}
	// The same channel keeps its key when the list is in another order.
	again, _ := ParseM3U("src", "#EXTM3U\n#EXTINF:-1 tvg-id=\"LoveNature.ca\",Love Nature, 4K\nhttps://b.example/ln.m3u8\n")
	if again[0].Key != list[1].Key || list[0].Key == list[1].Key {
		t.Errorf("keys: %q, %q, %q", again[0].Key, list[1].Key, list[0].Key)
	}
}

func TestAlternatives(t *testing.T) {
	ch := func(key, id, name, link string) Channel {
		return Channel{Key: key, EPGID: id, Name: name, URL: link}
	}
	all := []Channel{
		ch("a", "HumTV.pk@SD", "Hum TV", "https://1/"),
		ch("b", "HumTV.pk@HD", "Hum TV HD", "https://2/"),
		ch("c", "GodStandsTV.pk@Urdu", "God Stands", "https://3/"),
		ch("d", "GodStandsTV.pk@Arabic", "God Stands", "https://4/"),
		ch("e", "", "Hum TV (1080p) [Not 24/7]", "https://5/"),
		ch("f", "", "hum tv", "https://1/"), // the same address: not a backup
		ch("g", "", "ATV (Pakistan)", "https://6/"),
		ch("h", "", "ATV", "https://7/"),
	}
	keys := func(list []Channel) string {
		var out []string
		for _, c := range list {
			out = append(out, c.Key)
		}
		return strings.Join(out, ",")
	}
	// Two qualities of one channel, and the one without an id by its name.
	if got := keys(alternatives(all, all[0], 4)); got != "b,e" {
		t.Errorf("hum: %s", got)
	}
	// Two languages are two channels.
	if got := keys(alternatives(all, all[2], 4)); got != "" {
		t.Errorf("god stands: %s", got)
	}
	// A country in brackets is part of the name.
	if got := keys(alternatives(all, all[6], 4)); got != "" {
		t.Errorf("atv: %s", got)
	}
}

func TestParseXMLTV(t *testing.T) {
	now := time.Date(2026, 11, 20, 18, 0, 0, 0, time.UTC)
	xml := `<?xml version="1.0" encoding="ISO-8859-1"?><tv>
<channel id="ARD.de"><display-name>Das Erste</display-name></channel>
<programme start="20261120170000 +0000" stop="20261120183000 +0000" channel="ARD.de"><title lang="de">Tagesschau</title><title>Second</title><desc>News &amp; weather</desc></programme>
<programme start="20261120203000 +0100" stop="20261120213000 +0100" channel="ARD.de"><title>Tatort</title></programme>
<programme start="20261101000000 +0000" stop="20261101010000 +0000" channel="ARD.de"><title>Long ago</title></programme>
<programme start="20261120190000" stop="20261120200000" channel="Other"><title>Elsewhere</title></programme>
</tv>`
	for _, gz := range []bool{false, true} {
		var r strings.Builder
		if gz {
			w := gzip.NewWriter(&r)
			_, _ = w.Write([]byte(xml))
			_ = w.Close()
		} else {
			r.WriteString(xml)
		}
		g, err := ParseXMLTV(strings.NewReader(r.String()), now)
		if err != nil {
			t.Fatal(err)
		}
		ard := g["ard.de"]
		if len(ard) != 2 || ard[0].Title != "Tagesschau" || ard[0].Desc != "News & weather" || ard[1].Title != "Tatort" || ard[1].Start != time.Date(2026, 11, 20, 19, 30, 0, 0, time.UTC).Unix() {
			t.Fatalf("gz %v: ard = %+v", gz, ard)
		}
		on, next := nowNext(ard, now.Unix())
		if on == nil || on.Title != "Tagesschau" || next == nil || next.Title != "Tatort" {
			t.Errorf("now %+v, next %+v", on, next)
		}
		if len(g["other"]) != 1 {
			t.Errorf("other = %+v", g["other"])
		}
	}
}

// newService is Live TV on a fresh database, with events noted.
func newService(t *testing.T) (*Service, *atomic.Int32) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "moviko.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	s := New(d, filepath.Join(t.TempDir(), "livetv"))
	var events atomic.Int32
	s.OnChange = func(string, any) { events.Add(1) }
	return s, &events
}

// waitCheck waits for the check under way to end.
func waitCheck(t *testing.T, s *Service) CheckStatus {
	t.Helper()
	for i := 0; i < 400; i++ {
		if st := s.Check(); !st.Running && st.Total > 0 {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the check didn't end")
	return CheckStatus{}
}

func TestSourceChannelsAndCheck(t *testing.T) {
	var lists atomic.Int32
	mux := http.NewServeMux()
	var base string
	mux.HandleFunc("/list.m3u", func(w http.ResponseWriter, r *http.Request) {
		lists.Add(1)
		fmt.Fprintf(w, "#EXTM3U\n#EXTINF:-1 tvg-id=\"One.us\" group-title=\"News\",One\n%[1]s/one.m3u8\n#EXTINF:-1 tvg-id=\"Two.us\" group-title=\"News\",Two\n%[1]s/gone.m3u8\n#EXTINF:-1 group-title=\"XXX\",Three\n%[1]s/one.m3u8?x\n#EXTINF:-1 tvg-id=\"Four.de\",Four [Geo-blocked]\n%[1]s/master.m3u8\n#EXTINF:-1 tvg-id=\"One.us@HD\",One HD\n%[1]s/one-hd.m3u8\n", base)
	})
	mux.HandleFunc("/one.m3u8", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "#EXTM3U\n#EXTINF:4,\nseg1.ts\n") })
	mux.HandleFunc("/one-hd.m3u8", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "#EXTM3U\n#EXTINF:4,\nseg1.ts\n") })
	// A master list that answers, whose video is gone.
	mux.HandleFunc("/master.m3u8", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n")
	})
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<!DOCTYPE html><html><body>hi</body></html>")
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	base = srv.URL

	s, events := newService(t)
	s.Region = func() string { return "us" }
	ctx := context.Background()

	// An address on this computer: only for this computer to add.
	if _, err := s.Add(ctx, Add{Kind: KindM3U, URL: base + "/list.m3u"}); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "computer Moviko runs on") {
		t.Fatalf("add from the network: %v", err)
	}
	// A web page isn't a playlist.
	if _, err := s.Add(ctx, Add{Kind: KindM3U, URL: base + "/page", Local: true}); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "web page") {
		t.Fatalf("add a page: %v", err)
	}
	src, err := s.Add(ctx, Add{Kind: KindM3U, URL: base + "/list.m3u", Local: true})
	if err != nil {
		t.Fatal(err)
	}
	if src.Channels != 5 || !src.Local || src.Name != "127.0.0.1" || len(s.Sources()) != 1 {
		t.Fatalf("source = %+v", src)
	}
	if hosts := s.LocalHosts(); len(hosts) != 1 || !strings.HasPrefix(hosts[0], "127.0.0.1:") {
		t.Fatalf("local hosts = %v", hosts)
	}

	// Without a check yet: everything but the adult group, and the one
	// locked to another country.
	set := s.Settings()
	set.AutoCheck = false
	if _, err := s.SaveSettings(set); err != nil {
		t.Fatal(err)
	}
	l := s.Channels(ctx, false)
	if len(l.Channels) != 3 || l.HiddenLocked != 1 || l.HiddenDown != 0 {
		t.Fatalf("listed %d, locked %d, down %d", len(l.Channels), l.HiddenLocked, l.HiddenDown)
	}
	if l := s.Channels(ctx, true); len(l.Channels) != 4 {
		t.Fatalf("with adult groups: %d", len(l.Channels))
	}
	if lists.Load() != 1 {
		t.Fatalf("the playlist was fetched %d times", lists.Load())
	}

	// The check: the one that's gone, and the master whose video is gone.
	if !s.CheckAll(ctx) {
		t.Fatal("the check didn't start")
	}
	st := waitCheck(t, s)
	if st.Total != 5 || st.Done != 5 || st.Working != 3 {
		t.Fatalf("check = %+v", st)
	}
	l = s.Channels(ctx, false)
	if len(l.Channels) != 2 || l.HiddenDown != 1 {
		t.Fatalf("after the check: %d listed, %d down: %+v", len(l.Channels), l.HiddenDown, l.Channels)
	}
	var two, one string
	for _, c := range s.all(ctx) {
		switch c.Name {
		case "Two":
			two = c.Key
		case "One":
			one = c.Key
		}
	}
	// Shown with why when those aren't hidden; a favourite always shows.
	set.HideNotWorking = false
	_, _ = s.SaveSettings(set)
	for _, c := range s.Channels(ctx, false).Channels {
		if c.Key == two && !strings.Contains(c.Down, "gone") {
			t.Errorf("two is down for %q", c.Down)
		}
	}
	set.HideNotWorking = true
	_, _ = s.SaveSettings(set)
	if err := s.SetFavourite(two, true); err != nil {
		t.Fatal(err)
	}
	if l := s.Channels(ctx, false); len(l.Channels) != 3 {
		t.Fatalf("with a favourite that's down: %d", len(l.Channels))
	}
	// It played after all: working again.
	s.Report(two, true, "")
	_ = s.SetFavourite(two, false)
	if l := s.Channels(ctx, false); len(l.Channels) != 3 || l.HiddenDown != 0 {
		t.Fatalf("after it played: %d listed, %d down", len(l.Channels), l.HiddenDown)
	}

	// Playing: the channel, its other quality to fall back on, and it's the
	// one watched last.
	p, err := s.Open(ctx, one)
	if err != nil || p.Channel.URL != base+"/one.m3u8" || len(p.Backups) != 1 || p.Backups[0].Name != "One HD" {
		t.Fatalf("open = %+v, %v", p, err)
	}
	if r := s.Recent(); len(r) != 1 || r[0] != one {
		t.Fatalf("recent = %v", r)
	}
	if _, err := s.Open(ctx, "nope"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("open a channel that's gone: %v", err)
	}

	// Kept on disk: another start has them without asking the source.
	n := lists.Load()
	again := New(s.db, s.dir)
	if l := again.Channels(ctx, true); len(l.Channels) == 0 || lists.Load() != n {
		t.Fatalf("after a restart: %d channels, %d fetches more", len(l.Channels), lists.Load()-n)
	}
	// The app never gets a password, nor the login in an address.
	v := Source{URL: "https://user:pw@tv.example/get.php?username=u&password=secret&type=m3u", Pass: "x"}.View()
	if v.Pass != "" || strings.Contains(v.URL, "secret") || strings.Contains(v.URL, "pw@") {
		t.Errorf("view = %+v", v)
	}
	if err := s.Remove(src.ID); err != nil || len(s.Sources()) != 0 || len(s.Channels(ctx, true).Channels) != 0 {
		t.Fatalf("after removing: %v, %d sources", err, len(s.Sources()))
	}
	if events.Load() == 0 {
		t.Error("nothing was told")
	}
}

func TestXtreamAndGuide(t *testing.T) {
	now := time.Date(2026, 11, 20, 18, 0, 0, 0, time.UTC)
	mux := http.NewServeMux()
	mux.HandleFunc("/player_api.php", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("username") != "me" || q.Get("password") != "p w" {
			fmt.Fprint(w, `{"user_info":{"auth":0}}`)
			return
		}
		switch q.Get("action") {
		case "":
			fmt.Fprint(w, `{"user_info":{"auth":1,"status":"Active"}}`)
		case "get_live_categories":
			fmt.Fprint(w, `[{"category_id":"3","category_name":"Sports"}]`)
		case "get_live_streams":
			fmt.Fprint(w, `[{"num":1,"name":" Sport 1 ","stream_id":101,"stream_icon":"https://img.example/s1.png","epg_channel_id":"Sport1.de","category_id":"3"},{"num":"2","name":"Sport 2","stream_id":"102","category_id":3}]`)
		}
	})
	mux.HandleFunc("/xmltv.php", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<tv><programme start="20261120173000 +0000" stop="20261120190000 +0000" channel="sport1.de"><title>Football</title></programme></tv>`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	s, _ := newService(t)
	s.Now = func() time.Time { return now }
	ctx := context.Background()
	if _, err := s.Add(ctx, Add{Kind: KindXtream, URL: srv.URL, User: "me", Pass: "wrong", Local: true}); err == nil || !strings.Contains(err.Error(), "refused the username") {
		t.Fatalf("wrong password: %v", err)
	}
	// The address as providers give it, with what follows the server's.
	src, err := s.Add(ctx, Add{Kind: KindXtream, URL: srv.URL + "/get.php?username=me&type=m3u", User: "me", Pass: "p w", Name: "My TV", Local: true})
	if err != nil {
		t.Fatal(err)
	}
	if src.URL != srv.URL || src.Channels != 2 || src.Name != "My TV" {
		t.Fatalf("source = %+v", src)
	}
	set := s.Settings()
	set.AutoCheck = false
	_, _ = s.SaveSettings(set)
	l := s.Channels(ctx, false)
	if len(l.Channels) != 2 || l.Channels[0].Name != "Sport 1" || l.Channels[0].Group != "Sports" || l.Channels[1].Group != "Sports" || l.Channels[1].Number != 2 {
		t.Fatalf("channels = %+v", l.Channels)
	}
	p, err := s.Open(ctx, l.Channels[0].Key)
	if err != nil || p.Channel.URL != srv.URL+"/live/me/p%20w/101.m3u8" {
		t.Fatalf("open = %+v, %v", p.Channel, err)
	}
	// The login's own guide, in the background.
	if g := s.Guide(ctx); len(g) != 0 {
		t.Fatalf("guide before it came: %v", g)
	}
	var g map[string]Now
	for i := 0; i < 300 && len(g) == 0; i++ {
		time.Sleep(10 * time.Millisecond)
		g = s.Guide(ctx)
	}
	if on := g[l.Channels[0].Key].Now; on == nil || on.Title != "Football" {
		t.Fatalf("guide = %+v", g)
	}
	if progs := s.Programmes(ctx, l.Channels[0].Key); len(progs) != 1 {
		t.Fatalf("programmes = %+v", progs)
	}
}

// When none of several channels answers, the connection is down, not every
// channel: none is counted as not working.
func TestCheckWithoutAConnection(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	base := srv.URL
	srv.Close() // nothing answers there any more
	s, _ := newService(t)
	var list []Channel
	for i := 0; i < 6; i++ {
		list = append(list, Channel{Key: fmt.Sprint("k", i), Name: fmt.Sprint("Channel ", i), URL: fmt.Sprintf("%s/%d.m3u8", base, i)})
	}
	if !s.StartCheck(list) {
		t.Fatal("the check didn't start")
	}
	if st := waitCheck(t, s); st.Done != 6 || st.Working != 0 {
		t.Fatalf("check = %+v", st)
	}
	if h := s.healthMap(); len(h) != 0 {
		t.Fatalf("noted as not working: %v", h)
	}
}
