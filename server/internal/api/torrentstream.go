package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/player"
	"github.com/v0-0x/kumobox-movies/server/internal/providers"
	"github.com/v0-0x/kumobox-movies/server/internal/release"
	"github.com/v0-0x/kumobox-movies/server/internal/stream"
	"github.com/v0-0x/kumobox-movies/server/internal/torrentstream"
)

// Torrent streaming (package torrentstream): a torrent played (a streaming
// addon's, or a result of the Torrents tab) downloads as it plays, here,
// instead of going to the torrent client. A device with no BitTorrent
// client (a TV) has the computer its downloads go to stream it, and reads it
// from there.

func (s *Server) torrentStreamRoutes() {
	m := s.mux
	// A torrent streamed on the computer the downloads go to (see
	// streamTorrentViaHost): its ID is <that Moviko's ID>.<the session there>.
	m.HandleFunc("GET /api/torrentstream/{id}", h(func(r *http.Request) (any, error) {
		if host, sid, ok := strings.Cut(r.PathValue("id"), "."); ok {
			raw, _, err := s.app.Share.AskHost(r.Context(), host, "/api/peer/torrentstream/"+sid, nil)
			if err != nil {
				return nil, notFound(err.Error())
			}
			var st torrentstream.Status
			if err := json.Unmarshal(raw, &st); err != nil {
				return nil, &apiError{http.StatusBadGateway, "unexpected answer"}
			}
			st.ID = host + "." + st.ID
			return st, nil
		}
		st, ok := s.app.TorrentStream.Status(r.PathValue("id"))
		if !ok {
			return nil, notFound("this torrent isn't being played any more")
		}
		return st, nil
	}))
	m.HandleFunc("GET /api/torrentstream/{id}/file", func(w http.ResponseWriter, r *http.Request) {
		if host, sid, ok := strings.Cut(r.PathValue("id"), "."); ok {
			s.app.Share.ForwardPath(w, r, host, "/api/peer/torrentstream/"+sid+"/file")
			return
		}
		s.app.TorrentStream.Serve(w, r, r.PathValue("id"))
	})
	m.HandleFunc("DELETE /api/torrentstream/{id}", h(func(r *http.Request) (any, error) {
		if host, sid, ok := strings.Cut(r.PathValue("id"), "."); ok {
			_, _, err := s.app.Share.AskHost(r.Context(), host, "/api/peer/torrentstream/"+sid+"/stop", struct{}{})
			return nil, err
		}
		s.app.TorrentStream.Stop(r.PathValue("id"))
		return nil, nil
	}))
}

// hostTorrentBody is what a device asks the computer its downloads go to,
// to have it stream a torrent: the torrent, and which of its files.
type hostTorrentBody struct {
	Magnet   string `json:"magnet"`
	InfoHash string `json:"infoHash"`
	Name     string `json:"name"`
	// Show: Episode is a show's episode key (the file of that episode is
	// picked, in a season's torrent); FileIdx, when >= 0, is the file.
	Show    bool `json:"show"`
	Episode int  `json:"episode"`
	FileIdx int  `json:"fileIdx"`
}

// peerTorrentStreamRoutes: for the Movikos allowed to download onto this
// one (a TV: no torrent client of its own), a torrent streamed here, read
// by that Moviko alone.
func (s *Server) peerTorrentStreamRoutes(viaHost func(http.HandlerFunc) http.HandlerFunc) {
	m := s.mux
	m.HandleFunc("POST /api/peer/torrents/stream", viaHost(h(func(r *http.Request) (any, error) {
		var body hostTorrentBody
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		magnet, err := torrentstream.Magnet(body.Magnet, body.InfoHash, body.Name)
		if err != nil {
			return nil, badRequest(err.Error())
		}
		ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
		defer cancel()
		ts, err := s.app.TorrentStream.Open(ctx, magnet, pickFile(body.Show, body.Episode, body.FileIdx))
		if err != nil {
			return nil, &apiError{http.StatusBadGateway, err.Error()}
		}
		s.torrentMu.Lock()
		if s.torrentOwners == nil {
			s.torrentOwners = map[string]string{}
		}
		// Torrents no longer streamed (stopped, or dropped by the engine
		// when no one read them) are forgotten.
		for id := range s.torrentOwners {
			if _, ok := s.app.TorrentStream.Status(id); !ok {
				delete(s.torrentOwners, id)
			}
		}
		s.torrentOwners[ts.ID] = peerOf(r).ID
		s.torrentMu.Unlock()
		return ts, nil
	})))
	m.HandleFunc("GET /api/peer/torrentstream/{id}", viaHost(h(func(r *http.Request) (any, error) {
		id := r.PathValue("id")
		if !s.ownsTorrent(peerOf(r).ID, id) {
			return nil, notFound("this torrent isn't being played any more")
		}
		st, ok := s.app.TorrentStream.Status(id)
		if !ok {
			return nil, notFound("this torrent isn't being played any more")
		}
		return st, nil
	})))
	m.HandleFunc("GET /api/peer/torrentstream/{id}/file", viaHost(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !s.ownsTorrent(peerOf(r).ID, id) {
			http.Error(w, "this torrent isn't being played any more: play it again", http.StatusNotFound)
			return
		}
		s.app.TorrentStream.Serve(w, r, id)
	}))
	m.HandleFunc("POST /api/peer/torrentstream/{id}/stop", viaHost(h(func(r *http.Request) (any, error) {
		id := r.PathValue("id")
		if s.ownsTorrent(peerOf(r).ID, id) {
			s.app.TorrentStream.Stop(id)
			s.torrentMu.Lock()
			delete(s.torrentOwners, id)
			s.torrentMu.Unlock()
		}
		return nil, nil
	})))
}

// ownsTorrent reports a torrent streamed here (its session's ID) for the
// Moviko with that ID (peerTorrentStreamRoutes): the one that may read it.
func (s *Server) ownsTorrent(peerID, id string) bool {
	if peerID == "" || id == "" {
		return false
	}
	s.torrentMu.Lock()
	defer s.torrentMu.Unlock()
	return s.torrentOwners[id] == peerID
}

// streamTorrentViaHost starts the torrent on the Moviko the downloads go to
// (POST /api/peer/torrents/stream there, behind its Downloads grant): its
// status, with its ID here (<host>.<id there>), and the handler that reads
// its file from there. ok is false when no computer takes this device's
// downloads.
func (s *Server) streamTorrentViaHost(ctx context.Context, body hostTorrentBody) (ts torrentstream.Status, serve http.Handler, err error) {
	host := s.app.Settings.Get().Sharing.DownloadTo
	unavailable := torrentstream.ErrUnavailable.Error()
	if host == "" {
		return ts, nil, badRequest(unavailable + " (or let a computer take this device's downloads: it then streams them)")
	}
	raw, name, ok, err := s.app.Share.TorrentsHost(ctx, "stream", body)
	if !ok {
		return ts, nil, badRequest(unavailable)
	}
	if err != nil {
		return ts, nil, &apiError{http.StatusBadGateway, err.Error()}
	}
	var st torrentstream.Status
	if err := json.Unmarshal(raw, &st); err != nil || st.ID == "" {
		return ts, nil, &apiError{http.StatusBadGateway, name + ": unexpected answer"}
	}
	sid := st.ID
	st.ID = host + "." + sid
	serve = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.app.Share.ForwardPath(w, r, host, "/api/peer/torrentstream/"+sid+"/file")
	})
	return st, serve, nil
}

// streamTorrent plays a torrent as it downloads: in mpv, or in the in-app
// player (the file as it is when the browser plays it, converted
// otherwise), as providerPlay answers.
func (s *Server) streamTorrent(r *http.Request, media *catalog.Media, episode int, st stream.Stream, body providerPlayBody) (any, error) {
	name := firstLine(st.Title)
	if st.Filename != "" {
		name = st.Filename
	}
	magnet, err := torrentstream.Magnet(st.Magnet, st.InfoHash, name)
	if err != nil {
		return nil, badRequest(err.Error())
	}
	// Its details come from its peers: up to a minute and a half.
	ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
	defer cancel()
	show := media != nil && media.IsShow()
	ts, err := s.app.TorrentStream.Open(ctx, magnet, pickFile(show, episode, st.FileIdx))
	serve := http.Handler(nil)
	if errors.Is(err, torrentstream.ErrUnavailable) {
		// No client here (a TV): the computer the downloads go to streams
		// it, and this one reads it from there.
		var apiErr error
		if ts, serve, apiErr = s.streamTorrentViaHost(ctx, hostTorrentBody{Magnet: st.Magnet, InfoHash: st.InfoHash, Name: name, Show: show, Episode: episode, FileIdx: st.FileIdx}); apiErr != nil {
			return nil, apiErr
		}
	} else if err != nil {
		return nil, &apiError{http.StatusBadGateway, err.Error()}
	} else {
		serve = s.app.TorrentStream.Handler(ts.ID)
	}
	remote := stream.RegisterRemoteHandler("torrent:"+ts.ID, serve)

	cfg := s.app.Settings.Get()
	playerName := body.Player
	if playerName == "" {
		playerName = cfg.Playback.DefaultPlayer
	}
	if !isTrusted(r) {
		playerName = "builtin"
	}
	t := s.app.PlayTitles(r.Context(), media.ID, episode, media.PreferredTitle())
	if playerName == "mpv" {
		target, err := stream.RemoteURL(remote)
		if err != nil {
			return nil, err
		}
		sess, err := s.app.Player.PlayMpv(player.PlayRequest{
			MediaID: media.ID, Episode: episode, Title: t.Window, MediaTitle: t.Media, EpisodeTitle: t.Episode,
			Source: "torrent", Target: target, Start: body.Start, Provider: st.Provider, Quality: st.Quality, Release: ts.Name,
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"action": "mpv", "player": "mpv", "session": sess, "provider": st.Provider, "torrent": ts}, nil
	}
	src := map[string]any{
		"id": "torrent:" + ts.ID, "url": "/api/torrentstream/" + ts.ID + "/file", "originalUrl": "", "headers": map[string]string{}, "remote": remote, "type": providers.StreamUnknown,
		"quality": st.Quality, "label": firstLine(st.Title), "release": ts.Name, "server": "Torrent", "provider": st.Provider,
		"subtitles": []map[string]any{}, "filename": ts.Name, "notWebReady": !webPlayable(ts.Name), "torrent": ts.ID,
	}
	s.app.Player.ResetBuiltinProgress(media.ID, episode, 0)
	resume := s.app.History.ResumePosition(media.ID, episode)
	if body.Start != nil {
		resume = *body.Start
	}
	return map[string]any{
		"action": "builtin", "player": "builtin", "sources": []map[string]any{src}, "title": t.Window, "mediaTitle": t.Media, "episodeTitle": t.Episode, "resumeAt": resume,
		"tracks": s.app.Player.Tracks.Get(media.ID), "mediaId": media.ID, "episode": episode, "key": episode, "provider": st.Provider, "torrent": ts,
	}, nil
}

// webPlayable: a file browsers may play as it is (MP4, WebM); the rest
// (Matroska, AVI...) is converted at once.
func webPlayable(name string) bool {
	return slices.Contains([]string{".mp4", ".m4v", ".webm"}, strings.ToLower(filepath.Ext(name)))
}

// pickFile picks the file to play: the one the stream names, else for a
// show's episode the file of that episode (a season's torrent), else the
// largest video.
func pickFile(show bool, episode, fileIdx int) torrentstream.Pick {
	return func(paths []string) int {
		if fileIdx >= 0 && fileIdx < len(paths) {
			return fileIdx
		}
		if !show {
			return -1
		}
		season, ep := catalog.SplitKey(episode)
		for i, p := range paths {
			if !release.IsVideo(p) {
				continue
			}
			info := release.ParsePath(p)
			inSeason := len(info.Seasons) == 0 || slices.Contains(info.Seasons, season)
			if inSeason && slices.Contains(info.Episodes, ep) {
				return i
			}
		}
		return -1
	}
}
