// Package webplayers holds the web players Streambert
// (github.com/truelockmc/streambert, src/utils/api.js) streams from, as
// providers: VidSrc, Vidfast, Vidlove, Aether, Vidrift, Vidnest,
// DeVideoSrc, Frembed and KinoHub. Each is a site whose page for a movie
// or an episode is nothing but a player, found by the title's TMDB id (its
// IMDb id for DeVideoSrc, its Kinopoisk id for KinoHub).
//
// Unlike Moviko's other providers they hand out no video link: a stream of
// theirs is the player's page (Stream.ExternalURL, with Stream.Embed set),
// which Moviko shows in a window of its own. So nothing is asked of a site
// before its page opens, and Moviko can't tell beforehand whether it has
// the title. Each is a provider of its own, turned on, made the default
// and tracked apart; they're unofficial sites, off until the user turns
// them on.
package webplayers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/providers"
	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// The id a site finds titles by.
const (
	byTMDB      = ""
	byIMDb      = "imdb"
	byKinopoisk = "kinopoisk"
)

// Site is one of the web players.
type Site struct {
	// ID is the provider's id: "web:" and the site's key (the key alone
	// would clash with FreeFlix's Vidlink-like names sooner or later).
	ID   string
	Key  string
	Name string
	// DefaultURL is the site's address.
	DefaultURL string
	// Note is what sets the site apart ("German", "Several languages"...).
	Note string
	// MovieOnly: the site has no page for episodes.
	MovieOnly bool

	idType string
	// movie and episode are the pages' paths (and query), after the
	// address: id is the TMDB, IMDb or Kinopoisk id.
	movie   func(id string) string
	episode func(id string, season, episode int) string
	// params go on every page; subParam is the one that names the
	// subtitle language (ISO 639-1), when the site has one.
	params   [][2]string
	subParam string
}

func site(key, name, address, note string) *Site {
	return &Site{ID: Prefix + key, Key: key, Name: name, DefaultURL: address, Note: note}
}

// Prefix starts the id of every web player.
const Prefix = "web:"

// Sites are the web players, in Streambert's order.
var Sites = []*Site{
	with(site("vidsrc", "VidSrc", "https://vsembed.su", ""), func(s *Site) {
		s.movie = func(id string) string { return "/embed/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/embed/tv/%s/%d/%d", id, se, ep) }
		s.params = [][2]string{{"autoplay", "1"}}
		s.subParam = "ds_lang"
	}),
	with(site("vidfast", "Vidfast", "https://vidfast.vc", ""), func(s *Site) {
		s.movie = func(id string) string { return "/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/tv/%s/%d/%d", id, se, ep) }
		s.params = [][2]string{{"autoPlay", "true"}, {"poster", "true"}, {"title", "true"}, {"pip", "hide"}}
		s.subParam = "sub"
	}),
	with(site("vidlove", "Vidlove", "https://player.vidlove.cc", ""), func(s *Site) {
		s.movie = func(id string) string { return "/embed/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/embed/tv/%s/%d/%d", id, se, ep) }
		s.params = [][2]string{{"autoplay", "true"}, {"autonext", "false"}, {"showNextEpisode", "false"}, {"hideautonext", "true"}, {"hidenextbutton", "true"}}
	}),
	with(site("aether", "Aether", "https://aether.ist", "Several audio languages"), func(s *Site) {
		s.movie = func(id string) string { return "/media/tmdb-movie-" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/media/tmdb-tv-%s/%d/%d", id, se, ep) }
	}),
	with(site("vidrift", "Vidrift", "https://embed.vidrift.net", "Several audio languages"), func(s *Site) {
		s.movie = func(id string) string { return "/embed/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/embed/tv/%s/%d/%d", id, se, ep) }
		s.params = [][2]string{{"title", "true"}, {"hide", "next,episodes,cast"}}
		s.subParam = "sub"
	}),
	with(site("vidnest", "Vidnest", "https://vidnest.fun", ""), func(s *Site) {
		s.movie = func(id string) string { return "/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/tv/%s/%d/%d", id, se, ep) }
	}),
	with(site("devideosrc", "DeVideoSrc", "https://devideosrc.co", "German"), func(s *Site) {
		s.idType = byIMDb
		s.movie = func(id string) string { return "/custom/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/custom/serial/%s/%d/%d", id, se, ep) }
		s.params = [][2]string{{"autoplay", "1"}, {"muted", "0"}}
	}),
	with(site("frembed", "Frembed", "https://frembed.uno", "French"), func(s *Site) {
		s.movie = func(id string) string { return "/embed/movie/" + id }
		s.episode = func(id string, se, ep int) string { return fmt.Sprintf("/embed/serie/%s?sa=%d&epi=%d", id, se, ep) }
	}),
	with(site("kinohub", "KinoHub", "https://on.kinohub.vip", "Russian"), func(s *Site) {
		s.idType = byKinopoisk
		s.MovieOnly = true
		s.movie = func(id string) string { return "/movie/" + id }
	}),
}

func with(s *Site, set func(*Site)) *Site {
	set(s)
	return s
}

// SiteByKey returns the web player key names ("vidsrc"...), nil when
// there's none.
func SiteByKey(key string) *Site {
	for _, s := range Sites {
		if s.Key == key {
			return s
		}
	}
	return nil
}

// Provider is one of the web players.
type Provider struct {
	Site *Site
	// BaseURL is the site's address (Site.DefaultURL when empty): sites
	// move to mirrors from time to time.
	BaseURL string
	// SubLang is the subtitle language asked of the sites that take one
	// ("en", "fr"...; empty: the site's own choice).
	SubLang string
	// Kinopoisk finds a title's Kinopoisk id (Wikidata's, when nil).
	Kinopoisk func(ctx context.Context, r providers.Request) (string, error)
}

// New returns the provider of site; baseURL replaces its address when not
// empty.
func New(site *Site, baseURL string) *Provider { return &Provider{Site: site, BaseURL: baseURL} }

func (p *Provider) ID() string   { return p.Site.ID }
func (p *Provider) Name() string { return p.Site.Name }
func (p *Provider) Kind() string { return providers.KindBuiltin }

// Supports reports movies, and episodes on the sites that have them.
func (p *Provider) Supports(mediaType string) bool {
	return mediaType == providers.TypeMovie || !p.Site.MovieOnly
}

var imdbID = regexp.MustCompile(`^tt\d+$`)

// Streams answers with the page of the site's player for the movie or
// episode: one stream, without asking the site anything.
func (p *Provider) Streams(ctx context.Context, r providers.Request) ([]providers.Stream, error) {
	page, err := p.Page(ctx, r)
	if err != nil {
		return nil, err
	}
	title := "Web player"
	if p.Site.Note != "" {
		title += " · " + p.Site.Note
	}
	return []providers.Stream{{
		Provider: p.ID(), ProviderName: p.Name(), Title: title,
		Type: providers.StreamUnknown, FileIdx: -1,
		ExternalURL: page, Embed: true,
	}}, nil
}

// Page is the address of the site's player for the movie or episode.
func (p *Provider) Page(ctx context.Context, r providers.Request) (string, error) {
	s := p.Site
	if r.IsTV() && (s.MovieOnly || s.episode == nil) {
		return "", providers.Skip(fmt.Errorf("%s only has movies", s.Name))
	}
	if r.IsTV() && (r.Season < 0 || r.Episode <= 0) {
		return "", providers.Skip(fmt.Errorf("%s needs a season and an episode", s.Name))
	}
	var id string
	switch s.idType {
	case byIMDb:
		if !imdbID.MatchString(r.IMDbID) {
			return "", providers.Skip(fmt.Errorf("%s needs the title's IMDb id, which TMDB doesn't have", s.Name))
		}
		id = r.IMDbID
	case byKinopoisk:
		find := p.Kinopoisk
		if find == nil {
			find = KinopoiskID
		}
		kp, err := find(ctx, r)
		if err != nil {
			return "", err
		}
		id = kp
	default:
		if r.TMDBID <= 0 {
			return "", providers.Skip(fmt.Errorf("%s needs the title's TMDB id", s.Name))
		}
		id = strconv.Itoa(r.TMDBID)
	}
	base, err := baseURL(p.BaseURL, s.DefaultURL)
	if err != nil {
		return "", err
	}
	path := s.movie(id)
	if r.IsTV() {
		path = s.episode(id, r.Season, r.Episode)
	}
	u, err := url.Parse(base + path)
	if err != nil {
		return "", err
	}
	q := u.Query()
	for _, kv := range s.params {
		q.Set(kv[0], kv[1])
	}
	if lang := subLang(p.SubLang); lang != "" && s.subParam != "" {
		q.Set(s.subParam, lang)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// subLang is the two-letter code of a language setting ("en", "eng",
// "pt-BR"...), "" when it isn't one.
func subLang(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if i := strings.IndexAny(lang, "-_"); i > 0 {
		lang = lang[:i]
	}
	if two, ok := threeLetter[lang]; ok {
		return two
	}
	if len(lang) != 2 || lang[0] < 'a' || lang[0] > 'z' || lang[1] < 'a' || lang[1] > 'z' {
		return ""
	}
	return lang
}

// The ISO 639-2 codes of the languages subtitles are usually asked in.
var threeLetter = map[string]string{
	"eng": "en", "fre": "fr", "fra": "fr", "ger": "de", "deu": "de", "spa": "es", "ita": "it", "por": "pt",
	"rus": "ru", "jpn": "ja", "kor": "ko", "chi": "zh", "zho": "zh", "ara": "ar", "dut": "nl", "nld": "nl",
	"pol": "pl", "tur": "tr", "swe": "sv", "nor": "no", "dan": "da", "fin": "fi", "hin": "hi", "ukr": "uk",
}

// baseURL is a site's address without a path's trailing slash: a host
// alone gets https. Only http(s) addresses are taken.
func baseURL(configured, def string) (string, error) {
	b := strings.TrimSpace(configured)
	if b == "" {
		b = def
	}
	if !strings.Contains(b, "://") {
		b = "https://" + b
	}
	u, err := url.Parse(b)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", fmt.Errorf("%q isn't a site's address", configured)
	}
	return strings.TrimRight(u.Scheme+"://"+u.Host+u.Path, "/"), nil
}

// Wikidata
//
// KinoHub finds movies by their Kinopoisk id, which TMDB doesn't have:
// Wikidata does, on the item that has the TMDB movie id (P4947) or the
// IMDb id (P345), as P2603. Ids never change: they're kept for as long as
// Moviko runs.

// WikidataURL is Wikidata's SPARQL endpoint (tests point it elsewhere).
var WikidataURL = "https://query.wikidata.org/sparql"

// wikidataHTTP is the client asked (util.HTTP, which can't reach the LAN).
var wikidataHTTP = func() *http.Client { return util.HTTP }

var (
	kinopoiskMu  sync.Mutex
	kinopoiskIDs = map[int]string{}
)

var digits = regexp.MustCompile(`^\d+$`)

// KinopoiskID finds the Kinopoisk id of the movie r asks for, by its TMDB
// id, then by its IMDb id.
func KinopoiskID(ctx context.Context, r providers.Request) (string, error) {
	if r.TMDBID <= 0 {
		return "", providers.Skip(errors.New("KinoHub needs the title's TMDB id"))
	}
	kinopoiskMu.Lock()
	id, ok := kinopoiskIDs[r.TMDBID]
	kinopoiskMu.Unlock()
	if ok {
		return id, nil
	}
	id, err := wikidataKinopoisk(ctx, "P4947", strconv.Itoa(r.TMDBID))
	if err == nil && id == "" && imdbID.MatchString(r.IMDbID) {
		id, err = wikidataKinopoisk(ctx, "P345", r.IMDbID)
	}
	if err != nil {
		return "", err
	}
	if id == "" {
		return "", providers.Skip(errors.New("Wikidata has no Kinopoisk id for this movie"))
	}
	kinopoiskMu.Lock()
	kinopoiskIDs[r.TMDBID] = id
	kinopoiskMu.Unlock()
	return id, nil
}

// wikidataKinopoisk is the Kinopoisk id of the item whose property prop is
// value ("" when there's none). value is digits or an IMDb id: nothing
// that could change the query.
func wikidataKinopoisk(ctx context.Context, prop, value string) (string, error) {
	if !digits.MatchString(value) && !imdbID.MatchString(value) {
		return "", nil
	}
	query := fmt.Sprintf(`SELECT ?kp WHERE { ?item wdt:%s "%s" . ?item wdt:P2603 ?kp . } LIMIT 1`, prop, value)
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, WikidataURL+"?format=json&query="+url.QueryEscape(query), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/sparql-results+json")
	req.Header.Set("User-Agent", "Moviko (https://github.com/v0-0x/Moviko)")
	res, err := wikidataHTTP().Do(req)
	if err != nil {
		return "", fmt.Errorf("Wikidata: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Wikidata answered %s", res.Status)
	}
	var out struct {
		Results struct {
			Bindings []struct {
				KP struct {
					Value string `json:"value"`
				} `json:"kp"`
			} `json:"bindings"`
		} `json:"results"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); err != nil {
		return "", fmt.Errorf("Wikidata: %w", err)
	}
	if len(out.Results.Bindings) == 0 || !digits.MatchString(out.Results.Bindings[0].KP.Value) {
		return "", nil
	}
	return out.Results.Bindings[0].KP.Value, nil
}
