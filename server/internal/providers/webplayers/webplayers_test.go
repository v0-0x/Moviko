package webplayers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/v0-0x/kumobox-movies/server/internal/providers"
)

var (
	movie   = providers.Request{TMDBID: 603, IMDbID: "tt0133093", Type: providers.TypeMovie, Title: "The Matrix", Year: 1999}
	episode = providers.Request{TMDBID: 1396, IMDbID: "tt0903747", Type: providers.TypeTV, Title: "Breaking Bad", Season: 2, Episode: 5}
)

func page(t *testing.T, p *Provider, r providers.Request) string {
	t.Helper()
	got, err := p.Page(context.Background(), r)
	if err != nil {
		t.Fatalf("%s: %v", p.Site.Key, err)
	}
	return got
}

// The pages are the ones Streambert opens (src/utils/api.js).
func TestPages(t *testing.T) {
	want := map[string][2]string{
		"vidsrc":     {"https://vsembed.su/embed/movie/603?autoplay=1", "https://vsembed.su/embed/tv/1396/2/5?autoplay=1"},
		"vidfast":    {"https://vidfast.vc/movie/603?autoPlay=true&pip=hide&poster=true&title=true", "https://vidfast.vc/tv/1396/2/5?autoPlay=true&pip=hide&poster=true&title=true"},
		"vidlove":    {"https://player.vidlove.cc/embed/movie/603?autonext=false&autoplay=true&hideautonext=true&hidenextbutton=true&showNextEpisode=false", "https://player.vidlove.cc/embed/tv/1396/2/5?autonext=false&autoplay=true&hideautonext=true&hidenextbutton=true&showNextEpisode=false"},
		"aether":     {"https://aether.ist/media/tmdb-movie-603", "https://aether.ist/media/tmdb-tv-1396/2/5"},
		"vidrift":    {"https://embed.vidrift.net/embed/movie/603?hide=next%2Cepisodes%2Ccast&title=true", "https://embed.vidrift.net/embed/tv/1396/2/5?hide=next%2Cepisodes%2Ccast&title=true"},
		"vidnest":    {"https://vidnest.fun/movie/603", "https://vidnest.fun/tv/1396/2/5"},
		"devideosrc": {"https://devideosrc.co/custom/movie/tt0133093?autoplay=1&muted=0", "https://devideosrc.co/custom/serial/tt0903747/2/5?autoplay=1&muted=0"},
		"frembed":    {"https://frembed.uno/embed/movie/603", "https://frembed.uno/embed/serie/1396?epi=5&sa=2"},
	}
	for key, w := range want {
		s := SiteByKey(key)
		if s == nil {
			t.Fatalf("no site %q", key)
		}
		p := New(s, "")
		if got := page(t, p, movie); got != w[0] {
			t.Errorf("%s movie: %s, want %s", key, got, w[0])
		}
		if got := page(t, p, episode); got != w[1] {
			t.Errorf("%s episode: %s, want %s", key, got, w[1])
		}
	}
	if len(want)+1 != len(Sites) {
		t.Errorf("%d sites, %d checked", len(Sites), len(want)+1)
	}
}

func TestStream(t *testing.T) {
	p := New(SiteByKey("devideosrc"), "")
	streams, err := p.Streams(context.Background(), movie)
	if err != nil || len(streams) != 1 {
		t.Fatalf("streams: %v, %v", streams, err)
	}
	s := streams[0]
	if !s.Embed || s.ExternalURL == "" || s.URL != "" || s.Provider != "web:devideosrc" || s.ProviderName != "DeVideoSrc" || !strings.Contains(s.Title, "German") {
		t.Errorf("stream: %+v", s)
	}
	if !providers.Playable(s) || s.Direct() || s.IsTorrent() {
		t.Errorf("a web player's stream is a page to open: %+v", s)
	}
}

func TestMirrorAndSubtitles(t *testing.T) {
	p := New(SiteByKey("vidfast"), "vidfast.example/")
	p.SubLang = "pt-BR"
	if got, want := page(t, p, movie), "https://vidfast.example/movie/603?autoPlay=true&pip=hide&poster=true&sub=pt&title=true"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	// A site with no subtitle parameter leaves the language out.
	q := New(SiteByKey("vidnest"), "http://10.0.0.2:8080/x/")
	q.SubLang = "eng"
	if got, want := page(t, q, movie), "http://10.0.0.2:8080/x/movie/603"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	for _, bad := range []string{"javascript:alert(1)", "file:///etc/passwd", "ftp://x"} {
		if got, err := New(SiteByKey("vidnest"), bad).Page(context.Background(), movie); err == nil {
			t.Errorf("%q made %s", bad, got)
		}
	}
	for in, want := range map[string]string{"en": "en", "ENG": "en", "fre": "fr", "pt-BR": "pt", "": "", "english": "", "e1": ""} {
		if got := subLang(in); got != want {
			t.Errorf("subLang(%q) = %q, want %q", in, got, want)
		}
	}
}

// What a site can't look a title up with is a skip, not a failure of the
// site.
func TestSkips(t *testing.T) {
	noIDs := providers.Request{Type: providers.TypeMovie, Title: "Home video"}
	for _, s := range Sites {
		p := New(s, "")
		p.Kinopoisk = KinopoiskID
		if _, err := p.Streams(context.Background(), noIDs); !providers.IsSkip(err) {
			t.Errorf("%s without ids: %v", s.Key, err)
		}
	}
	kino := New(SiteByKey("kinohub"), "")
	if kino.Supports(providers.TypeTV) || !kino.Supports(providers.TypeMovie) {
		t.Error("KinoHub has movies only")
	}
	if _, err := kino.Streams(context.Background(), episode); !providers.IsSkip(err) {
		t.Errorf("KinoHub episode: %v", err)
	}
	noSeason := episode
	noSeason.Episode = 0
	if _, err := New(SiteByKey("vidsrc"), "").Streams(context.Background(), noSeason); !providers.IsSkip(err) {
		t.Errorf("episode 0: %v", err)
	}
}

func TestKinopoisk(t *testing.T) {
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("query")
		asked = append(asked, q)
		w.Header().Set("Content-Type", "application/sparql-results+json")
		switch {
		case strings.Contains(q, `wdt:P4947 "603"`):
			w.Write([]byte(`{"results":{"bindings":[{"kp":{"type":"literal","value":"301"}}]}}`))
		case strings.Contains(q, `wdt:P345 "tt0000001"`):
			w.Write([]byte(`{"results":{"bindings":[{"kp":{"value":"77"}}]}}`))
		default:
			w.Write([]byte(`{"results":{"bindings":[]}}`))
		}
	}))
	defer srv.Close()
	oldURL, oldHTTP := WikidataURL, wikidataHTTP
	WikidataURL, wikidataHTTP = srv.URL, func() *http.Client { return srv.Client() }
	defer func() { WikidataURL, wikidataHTTP = oldURL, oldHTTP }()

	p := New(SiteByKey("kinohub"), "")
	if got, want := page(t, p, movie), "https://on.kinohub.vip/movie/301"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	// Kept: not asked again.
	page(t, p, movie)
	if len(asked) != 1 {
		t.Errorf("asked %d times, want 1", len(asked))
	}
	// Not under its TMDB id: by its IMDb id.
	other := providers.Request{TMDBID: 900001, IMDbID: "tt0000001", Type: providers.TypeMovie}
	if got, want := page(t, p, other), "https://on.kinohub.vip/movie/77"; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	// Unknown to Wikidata: a skip.
	if _, err := p.Page(context.Background(), providers.Request{TMDBID: 900002, IMDbID: "tt0000002", Type: providers.TypeMovie}); !providers.IsSkip(err) {
		t.Errorf("unknown movie: %v", err)
	}
}
