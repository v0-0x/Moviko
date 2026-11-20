package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/livetv"
	"github.com/v0-0x/kumobox-movies/server/internal/stream"
)

// Live TV (internal/livetv): the channels of the IPTV sources added here.
// Sources and settings are this computer's to change (a source is an
// address the server fetches, with a login sometimes); devices on the
// network watch, keep favourites and have the channels checked.
func (s *Server) liveTVRoutes() {
	m := s.mux
	tv := s.app.LiveTV
	fail := func(err error) error {
		if errors.Is(err, livetv.ErrInvalid) {
			return badRequest(livetv.Message(err))
		}
		return err
	}
	views := func() []livetv.Source {
		out := []livetv.Source{}
		for _, src := range tv.Sources() {
			out = append(out, src.View())
		}
		return out
	}
	m.HandleFunc("GET /api/livetv", h(func(r *http.Request) (any, error) {
		return map[string]any{"sources": views(), "settings": tv.Settings(), "check": tv.Check()}, nil
	}))
	m.HandleFunc("PUT /api/livetv/settings", h(thisComputer(func(r *http.Request) (any, error) {
		var body livetv.Settings
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		return tv.SaveSettings(body)
	})))
	m.HandleFunc("POST /api/livetv/sources", h(thisComputer(func(r *http.Request) (any, error) {
		var body livetv.Add
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		body.Local = true
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		src, err := tv.Add(ctx, body)
		if err != nil {
			return nil, fail(err)
		}
		return src.View(), nil
	})))
	m.HandleFunc("DELETE /api/livetv/sources/{id}", h(thisComputer(func(r *http.Request) (any, error) {
		return nil, tv.Remove(r.PathValue("id"))
	})))
	m.HandleFunc("PUT /api/livetv/sources/{id}", h(thisComputer(func(r *http.Request) (any, error) {
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		tv.SetEnabled(r.PathValue("id"), body.Enabled)
		return nil, nil
	})))
	m.HandleFunc("POST /api/livetv/sources/{id}/refresh", h(func(r *http.Request) (any, error) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		src, err := tv.Refresh(ctx, r.PathValue("id"))
		if err != nil {
			return nil, fail(err)
		}
		return src.View(), nil
	}))
	m.HandleFunc("GET /api/livetv/channels", h(func(r *http.Request) (any, error) {
		return tv.Channels(r.Context(), s.app.Settings.Get().UI.ShowAdult), nil
	}))
	m.HandleFunc("GET /api/livetv/guide", h(func(r *http.Request) (any, error) {
		if key := r.URL.Query().Get("key"); key != "" {
			return tv.Programmes(r.Context(), key), nil
		}
		return tv.Guide(r.Context()), nil
	}))
	m.HandleFunc("POST /api/livetv/favourite", h(func(r *http.Request) (any, error) {
		var body struct {
			Key string `json:"key"`
			On  bool   `json:"on"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		return nil, tv.SetFavourite(body.Key, body.On)
	}))
	m.HandleFunc("POST /api/livetv/play", h(s.liveTVPlay))
	// How a channel played, as the player saw it.
	m.HandleFunc("POST /api/livetv/report", h(func(r *http.Request) (any, error) {
		var body struct {
			Key string `json:"key"`
			OK  bool   `json:"ok"`
			Why string `json:"why"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		tv.Report(body.Key, body.OK, body.Why)
		return nil, nil
	}))
	m.HandleFunc("POST /api/livetv/check", h(func(r *http.Request) (any, error) {
		var body struct {
			Stop bool `json:"stop"`
		}
		if err := decode(r, &body); err != nil {
			return nil, err
		}
		if body.Stop {
			tv.StopCheck()
		} else {
			tv.CheckAll(r.Context())
		}
		return tv.Check(), nil
	}))
}

// liveTVPlay is POST /api/livetv/play {key, backup}: how the in-app player
// plays a channel. The channel's address stays here: the player gets the
// proxy's (an HLS stream, which browsers play) and the converter's (any
// other stream, read by ffmpeg), and the same channel in the other lists
// to try when this one doesn't play. A channel that is a web page (a
// YouTube live page) is for the browser.
func (s *Server) liveTVPlay(r *http.Request) (any, error) {
	var body struct {
		Key string `json:"key"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	p, err := s.app.LiveTV.Open(r.Context(), body.Key)
	if err != nil {
		if errors.Is(err, livetv.ErrInvalid) {
			return nil, notFound(livetv.Message(err))
		}
		return nil, err
	}
	c := p.Channel
	out := map[string]any{"key": c.Key, "name": c.Name, "logo": c.Logo, "group": c.Group, "source": s.app.LiveTV.SourceName(c.Source)}
	if p.Web != "" {
		out["action"], out["url"], out["service"] = "external", c.URL, p.Web
		return out, nil
	}
	backups := []map[string]any{}
	for _, b := range p.Backups {
		backups = append(backups, map[string]any{"key": b.Key, "name": b.Name, "source": s.app.LiveTV.SourceName(b.Source)})
	}
	out["action"], out["backups"] = "play", backups
	headers := map[string]string{}
	for k, v := range c.Headers {
		headers[k] = v
	}
	if liveIsHLS(r.Context(), c.URL, headers) {
		out["hls"] = stream.ProxyURL(c.URL, headers)
		out["convert"] = "/api/local/transcode?path=" + url.QueryEscape(stream.RegisterRemoteHLS(c.URL, headers))
	} else {
		out["convert"] = "/api/local/transcode?path=" + url.QueryEscape(stream.RegisterRemote(c.URL, headers))
	}
	return out, nil
}

// liveIsHLS reports an HLS stream: by its address, or else by what it
// answers with (a look at its first bytes; an address that doesn't answer
// in time is taken as a plain stream, and the player says how it went).
func liveIsHLS(ctx context.Context, link string, headers map[string]string) bool {
	if u, err := url.Parse(link); err == nil {
		p := strings.ToLower(u.Path)
		switch {
		case strings.HasSuffix(p, ".m3u8") || strings.HasSuffix(p, ".m3u"):
			return true
		case strings.HasSuffix(p, ".ts") || strings.HasSuffix(p, ".mp4") || strings.HasSuffix(p, ".mkv") || strings.HasSuffix(p, ".flv"):
			return false
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	resp, err := stream.Fetch(ctx, link, headers, "")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	head := make([]byte, 1024)
	n, _ := io.ReadFull(resp.Body, head)
	return stream.LinkKind(resp.Header.Get("Content-Type"), head[:n]) == stream.LinkHLS
}
