// Package livetv is Live TV: channels from IPTV sources the user adds (M3U
// playlists with an optional XMLTV guide, Xtream Codes logins), kept apart
// from the movies and shows. Moviko comes with no source. The channels of a
// source are kept on disk and fetched again once a day; which ones answer
// is checked in the background, and those that don't are left out.
//
// Made after Stream Goat's Live TV (github.com/sherazi5110/stream-goat,
// GPL-3.0): its playlist reading, its way of telling the same channel in
// two lists, and its channel check.
package livetv

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/db"
	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// Kinds of source.
const (
	KindM3U    = "m3u"
	KindXtream = "xtream"
)

// ErrInvalid is what a source can't be added for (said to the user as it is).
var ErrInvalid = errors.New("live tv")

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// Message is err's text for the user (without the package's mark).
func Message(err error) string {
	return strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")
}

// Source is a list of channels the user added.
type Source struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
	URL  string `json:"url"`
	// EPG is the XMLTV guide's address ("": the one the playlist names, or
	// the login's own).
	EPG  string `json:"epg,omitempty"`
	User string `json:"user,omitempty"`
	// Pass never leaves the server (View).
	Pass    string `json:"pass,omitempty"`
	Enabled bool   `json:"enabled"`
	// Local: on this computer or the home network (added from this
	// computer): fetched and played from there all the same.
	Local bool `json:"local,omitempty"`
	// Guide is the guide the playlist named for itself.
	Guide string `json:"guide,omitempty"`
	// Channels and FetchedAt (unix seconds) are of the last fetch.
	Channels  int   `json:"channels"`
	FetchedAt int64 `json:"fetchedAt"`
	// Error is why the last fetch failed ("" when it didn't).
	Error string `json:"error,omitempty"`
}

// View is a source as the app gets it: without its password, and its
// address without the login a playlist's can carry.
func (s Source) View() Source {
	s.Pass = ""
	if u, err := url.Parse(s.URL); err == nil {
		u.User = nil
		q := u.Query()
		for k := range q {
			if lk := strings.ToLower(k); lk == "password" || lk == "pass" || lk == "token" || lk == "key" {
				q.Set(k, "…")
			}
		}
		u.RawQuery = q.Encode()
		s.URL = u.String()
	}
	if s.EPG != "" {
		s.EPG = "set"
	}
	s.Guide = ""
	return s
}

// Settings are Live TV's own.
type Settings struct {
	// HideNotWorking leaves out the channels the last check (or a try to
	// play them) found not working.
	HideNotWorking bool `json:"hideNotWorking"`
	// HideRegionLocked leaves out the channels marked as playing only in
	// their own country, unless that's Country.
	HideRegionLocked bool `json:"hideRegionLocked"`
	// AutoCheck checks the channels in the background, each once a day.
	AutoCheck bool `json:"autoCheck"`
	// Country is the viewer's (two letters; "": TMDB's region).
	Country string `json:"country"`
}

// Health is what the last check found for a channel.
type Health struct {
	OK  bool   `json:"ok"`
	At  int64  `json:"at"`
	Why string `json:"why,omitempty"`
}

const (
	sourcesKey    = "livetv:sources"
	settingsKey   = "livetv:settings"
	favouritesKey = "livetv:favourites"
	recentKey     = "livetv:recent"

	maxPlaylist  = 64 << 20
	maxChannels  = 100_000
	maxSources   = 30
	maxRecent    = 24
	refreshAfter = 24 * time.Hour
	guideAfter   = 12 * time.Hour
	healthFor    = 7 * 24 * time.Hour
	checkAfter   = 24 * time.Hour
	// A run checks no more than this (a public list of 10,000 channels is
	// done over a few days, what's looked at first).
	maxCheck = 3000
)

// Service is Live TV's sources, channels, guide and checks.
type Service struct {
	// HTTP fetches playlists, logins and guides from the internet (never
	// from this computer or the network); Local from there, for the
	// sources added as such.
	HTTP, Local *http.Client
	// Region is the country to fall back on (TMDB's region setting).
	Region func() string
	// OnChange is told when what Live TV shows changed (a source, a check).
	OnChange func(what string, payload any)
	Now      func() time.Time

	db  *db.DB
	dir string

	mu       sync.Mutex
	loaded   map[string][]Channel
	fetching map[string]chan struct{}
	health   map[string]Health
	guide    map[string]guide
	check    *CheckStatus
	stop     context.CancelFunc
	// hosts is LocalHosts' answer, kept (it's asked for every part of a
	// stream) until a source or its channels change.
	hosts      []string
	hostsKnown bool
}

type guide struct {
	at       time.Time
	loading  bool
	channels map[string][]Programme
}

// New returns Live TV keeping its channel lists under dir.
func New(d *db.DB, dir string) *Service {
	transport := func(dial func(ctx context.Context, network, addr string) (net.Conn, error), proxy func(*http.Request) (*url.URL, error)) *http.Transport {
		return &http.Transport{Proxy: proxy, DialContext: dial, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 30 * time.Second}
	}
	return &Service{
		HTTP:  &http.Client{Timeout: 5 * time.Minute, Transport: transport(util.PublicDialContext(15*time.Second), util.PublicProxy)},
		Local: &http.Client{Timeout: 5 * time.Minute, Transport: transport((&net.Dialer{Timeout: 15 * time.Second}).DialContext, nil)},
		Now:   time.Now,
		db:    d, dir: dir,
		loaded: map[string][]Channel{}, fetching: map[string]chan struct{}{}, guide: map[string]guide{},
	}
}

func (s *Service) changed(what string, payload any) {
	if s.OnChange != nil {
		s.OnChange(what, payload)
	}
}

// ---------------------------------------------------------------------------
// Settings, favourites, recently watched

// Settings are Live TV's settings (all on by default).
func (s *Service) Settings() Settings {
	v := Settings{HideNotWorking: true, HideRegionLocked: true, AutoCheck: true}
	_, _ = s.db.GetKV(settingsKey, &v)
	v.Country = strings.ToUpper(strings.TrimSpace(v.Country))
	if len(v.Country) != 2 {
		v.Country = ""
	}
	return v
}

// SaveSettings keeps them.
func (s *Service) SaveSettings(v Settings) (Settings, error) {
	if err := s.db.SetKV(settingsKey, v); err != nil {
		return v, err
	}
	s.changed("settings", nil)
	return s.Settings(), nil
}

// country is the viewer's country.
func (s *Service) country() string {
	if c := s.Settings().Country; c != "" {
		return c
	}
	if s.Region != nil {
		return strings.ToUpper(strings.TrimSpace(s.Region()))
	}
	return ""
}

func (s *Service) keys(key string) []string {
	var v []string
	_, _ = s.db.GetKV(key, &v)
	return v
}

// Favourites are the keys of the favourite channels, as they were added.
func (s *Service) Favourites() []string { return s.keys(favouritesKey) }

// Recent are the keys of the channels watched last, the last first.
func (s *Service) Recent() []string { return s.keys(recentKey) }

// SetFavourite adds a channel to the favourites, or takes it off.
func (s *Service) SetFavourite(key string, on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, k := range s.keys(favouritesKey) {
		if k != key {
			out = append(out, k)
		}
	}
	if on && key != "" && len(key) < 200 {
		out = append(out, key)
	}
	if len(out) > 2000 {
		out = out[len(out)-2000:]
	}
	return s.db.SetKV(favouritesKey, out)
}

func (s *Service) watched(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []string{key}
	for _, k := range s.keys(recentKey) {
		if k != key && len(out) < maxRecent {
			out = append(out, k)
		}
	}
	_ = s.db.SetKV(recentKey, out)
}

// ---------------------------------------------------------------------------
// Sources

// Sources are the sources added, as they were.
func (s *Service) Sources() []Source {
	var v []Source
	_, _ = s.db.GetKV(sourcesKey, &v)
	return v
}

func (s *Service) source(id string) (Source, bool) {
	for _, src := range s.Sources() {
		if src.ID == id {
			return src, true
		}
	}
	return Source{}, false
}

// update changes the saved source id with fn (nothing when it's gone).
func (s *Service) update(id string, fn func(*Source)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.Sources()
	for i := range list {
		if list[i].ID == id {
			fn(&list[i])
			_ = s.db.SetKV(sourcesKey, list)
			s.forgetHosts()
			return
		}
	}
}

var githubBlob = regexp.MustCompile(`^https?://github\.com/([^/]+)/([^/]+)/blob/(.+)$`)

// rawGitHub turns a GitHub page of a file ("…/blob/…") into the file itself.
func rawGitHub(link string) string {
	if m := githubBlob.FindStringSubmatch(link); m != nil {
		return "https://raw.githubusercontent.com/" + m[1] + "/" + m[2] + "/" + m[3]
	}
	return link
}

// Add is what Add takes.
type Add struct {
	Kind string `json:"kind"`
	URL  string `json:"url"`
	Name string `json:"name"`
	EPG  string `json:"epg"`
	User string `json:"user"`
	Pass string `json:"pass"`
	// Local allows an address on this computer or the home network (only
	// this computer may say so).
	Local bool `json:"-"`
}

// Add adds a source once it has answered with channels, and returns it.
func (s *Service) Add(ctx context.Context, a Add) (Source, error) {
	if a.Kind != KindM3U && a.Kind != KindXtream {
		return Source{}, invalid("choose a playlist or an Xtream Codes login")
	}
	link := rawGitHub(strings.TrimRight(strings.TrimSpace(a.URL), "/"))
	if link != "" && !strings.Contains(link, "://") {
		link = "http://" + link
		if a.Kind == KindM3U {
			link = "https://" + strings.TrimPrefix(link, "http://")
		}
	}
	u, err := url.Parse(link)
	if err != nil || !streamScheme(link) {
		return Source{}, invalid("enter an address starting with http:// or https://")
	}
	if a.Kind == KindXtream {
		// The login's address is the server's: what a pasted link has after it isn't.
		u.Path, u.RawQuery, u.Fragment = strings.TrimSuffix(strings.TrimSuffix(u.Path, "/player_api.php"), "/get.php"), "", ""
		link = strings.TrimRight(u.String(), "/")
		if strings.TrimSpace(a.User) == "" || a.Pass == "" {
			return Source{}, invalid("enter the username and password of the login")
		}
	}
	epg := strings.TrimSpace(a.EPG)
	if epg != "" && !streamScheme(epg) {
		return Source{}, invalid("the guide's address must start with http:// or https://")
	}
	local := false
	if privateHost(u.Hostname()) {
		if !a.Local {
			return Source{}, invalid("a source on this computer or the home network can only be added on the computer Moviko runs on")
		}
		local = true
	}
	sum := sha1.Sum([]byte(a.Kind + "|" + link + "|" + strings.TrimSpace(a.User)))
	src := Source{ID: hex.EncodeToString(sum[:6]), Kind: a.Kind, Name: strings.TrimSpace(a.Name), URL: link, EPG: epg, User: strings.TrimSpace(a.User), Pass: a.Pass, Enabled: true, Local: local}
	if src.Name == "" {
		src.Name = strings.TrimPrefix(u.Hostname(), "www.")
	}
	if len(src.Name) > 80 {
		src.Name = strings.ToValidUTF8(src.Name[:80], "")
	}
	list, guide, err := s.fetch(ctx, src)
	if err != nil {
		return Source{}, err
	}
	if len(list) == 0 {
		return Source{}, invalid("no channels found at that address")
	}
	src.Guide, src.Channels, src.FetchedAt = guide, len(list), s.Now().Unix()

	s.mu.Lock()
	var out []Source
	for _, o := range s.Sources() {
		if o.ID != src.ID {
			out = append(out, o)
		}
	}
	if len(out) >= maxSources {
		s.mu.Unlock()
		return Source{}, invalid("that's as many sources as Live TV takes: remove one first")
	}
	err = s.db.SetKV(sourcesKey, append(out, src))
	s.forgetHosts()
	s.mu.Unlock()
	if err != nil {
		return Source{}, err
	}
	s.store(src.ID, list)
	s.changed("sources", nil)
	return src, nil
}

// Remove takes a source off, with its channels.
func (s *Service) Remove(id string) error {
	s.mu.Lock()
	var out []Source
	for _, o := range s.Sources() {
		if o.ID != id {
			out = append(out, o)
		}
	}
	err := s.db.SetKV(sourcesKey, out)
	delete(s.loaded, id)
	s.forgetHosts()
	s.mu.Unlock()
	_ = os.Remove(s.file(id))
	s.changed("sources", nil)
	return err
}

// SetEnabled turns a source on or off (its channels stay kept).
func (s *Service) SetEnabled(id string, on bool) {
	s.update(id, func(src *Source) { src.Enabled = on })
	s.changed("sources", nil)
}

// Refresh fetches a source's channels again now.
func (s *Service) Refresh(ctx context.Context, id string) (Source, error) {
	src, ok := s.source(id)
	if !ok {
		return Source{}, invalid("no such source")
	}
	if _, err := s.load(ctx, src, true); err != nil {
		return Source{}, err
	}
	src, _ = s.source(id)
	s.changed("sources", nil)
	return src, nil
}

// LocalHosts are the hosts (with their ports) on this computer or the home
// network that streams may come from: those of the sources added as local,
// and of their channels at the same machine.
func (s *Service) LocalHosts() []string {
	s.mu.Lock()
	if s.hostsKnown {
		out := s.hosts
		s.mu.Unlock()
		return out
	}
	s.mu.Unlock()
	out := []string{}
	for _, src := range s.Sources() {
		if !src.Local || !src.Enabled {
			continue
		}
		u, err := url.Parse(src.URL)
		if err != nil {
			continue
		}
		list, _ := s.load(context.Background(), src, false)
		seen := map[string]bool{hostKey(u): true}
		for _, c := range list {
			if cu, err := url.Parse(c.URL); err == nil && strings.EqualFold(cu.Hostname(), u.Hostname()) {
				seen[hostKey(cu)] = true
			}
		}
		for k := range seen {
			out = append(out, k)
		}
	}
	s.mu.Lock()
	s.hosts, s.hostsKnown = out, true
	s.mu.Unlock()
	return out
}

// forgetHosts has LocalHosts worked out again (a source or its channels
// changed). Called with s.mu held.
func (s *Service) forgetHosts() { s.hosts, s.hostsKnown = nil, false }

// hostKey is a URL's host and port, the port from the scheme when it has
// none (as stream.HostKey).
func hostKey(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = "80"
		if strings.EqualFold(u.Scheme, "https") {
			port = "443"
		}
	}
	return net.JoinHostPort(strings.ToLower(u.Hostname()), port)
}

// privateHost reports a name or address of this computer or the network.
func privateHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".lan") || strings.HasSuffix(host, ".home.arpa") || !strings.Contains(host, ".") && net.ParseIP(host) == nil {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return util.IsPrivateIP(ip)
	}
	return false
}

// ---------------------------------------------------------------------------
// Fetching

func (s *Service) client(src Source) *http.Client {
	if src.Local {
		return s.Local
	}
	return s.HTTP
}

// get fetches an address's body (gunzipped when it's gzip), up to limit.
func (s *Service) get(ctx context.Context, c *http.Client, link string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", util.UserAgent)
	resp, err := c.Do(req)
	if err != nil {
		return nil, tidy(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("the server answered %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, tidy(err)
	}
	if len(body) > 2 && body[0] == 0x1f && body[1] == 0x8b {
		gz, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		if body, err = io.ReadAll(io.LimitReader(gz, limit+1)); err != nil {
			return nil, err
		}
	}
	if int64(len(body)) > limit {
		return nil, errors.New("the answer is too large")
	}
	return body, nil
}

// tidy is a request's error without its address (which can hold a login).
func tidy(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}

func (s *Service) fetch(ctx context.Context, src Source) ([]Channel, string, error) {
	var list []Channel
	var guide string
	var err error
	if src.Kind == KindXtream {
		list, err = s.xtream(ctx, src)
	} else {
		var body []byte
		if body, err = s.get(ctx, s.client(src), src.URL, maxPlaylist); err == nil {
			text := string(body)
			head := strings.ToLower(strings.TrimSpace(text[:min(len(text), 20000)]))
			if strings.HasPrefix(head, "<!doctype html") || strings.HasPrefix(head, "<html") || strings.HasPrefix(head, "<") && !strings.Contains(head, "#extinf") {
				return nil, "", invalid(`that address is a web page, not a playlist. Use the playlist file's own address (it usually ends in .m3u or .m3u8; on GitHub, the "Raw" button)`)
			}
			list, guide = ParseM3U(src.ID, text)
		}
	}
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return nil, "", err
		}
		return nil, "", invalid("%s didn't answer with its channels: %v", src.Name, err)
	}
	if len(list) > maxChannels {
		list = list[:maxChannels]
	}
	return list, guide, nil
}

// xtream asks an Xtream Codes server (player_api.php) for its live channels.
func (s *Service) xtream(ctx context.Context, src Source) ([]Channel, error) {
	auth := "username=" + url.QueryEscape(src.User) + "&password=" + url.QueryEscape(src.Pass)
	api := src.URL + "/player_api.php?" + auth
	c := s.client(src)
	body, err := s.get(ctx, c, api, 4<<20)
	if err != nil {
		return nil, err
	}
	var login struct {
		User struct {
			Auth json.RawMessage `json:"auth"`
		} `json:"user_info"`
	}
	if json.Unmarshal(body, &login) != nil {
		return nil, invalid("that address isn't an Xtream Codes server (it didn't answer as one)")
	}
	if a := strings.Trim(string(login.User.Auth), `"`); a == "0" {
		return nil, invalid("the provider refused the username or password")
	}
	names := map[string]string{}
	if body, err := s.get(ctx, c, api+"&action=get_live_categories", 16<<20); err == nil {
		var cats []struct {
			ID   json.RawMessage `json:"category_id"`
			Name string          `json:"category_name"`
		}
		if json.Unmarshal(body, &cats) == nil {
			for _, cat := range cats {
				names[strings.Trim(string(cat.ID), `"`)] = cat.Name
			}
		}
	}
	if body, err = s.get(ctx, c, api+"&action=get_live_streams", maxPlaylist); err != nil {
		return nil, err
	}
	var streams []struct {
		ID       json.RawMessage `json:"stream_id"`
		Name     string          `json:"name"`
		Icon     string          `json:"stream_icon"`
		Category json.RawMessage `json:"category_id"`
		EPG      string          `json:"epg_channel_id"`
		Num      json.RawMessage `json:"num"`
	}
	if err := json.Unmarshal(body, &streams); err != nil {
		return nil, errors.New("its list of channels couldn't be read")
	}
	var out []Channel
	for _, st := range streams {
		id := strings.Trim(string(st.ID), `"`)
		if id == "" || id == "null" {
			continue
		}
		num, _ := strconv.Atoi(strings.Trim(string(st.Num), `"`))
		if num == 0 {
			num = len(out) + 1
		}
		out = append(out, Channel{
			Key: src.ID + ":" + id, Source: src.ID, Name: strings.TrimSpace(st.Name), Logo: webLink(st.Icon), Group: names[strings.Trim(string(st.Category), `"`)],
			URL:   src.URL + "/live/" + url.PathEscape(src.User) + "/" + url.PathEscape(src.Pass) + "/" + url.PathEscape(id) + ".m3u8",
			EPGID: st.EPG, Number: num,
		})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Channels

func (s *Service) file(id string) string { return filepath.Join(s.dir, id+".json") }

func (s *Service) store(id string, list []Channel) {
	s.mu.Lock()
	s.loaded[id] = list
	s.forgetHosts()
	s.mu.Unlock()
	out := make([]stored, len(list))
	for i, c := range list {
		out[i] = stored{Channel: c, U: c.URL, H: c.Headers}
	}
	b, err := json.Marshal(out)
	if err == nil {
		if err = os.MkdirAll(s.dir, 0o700); err == nil {
			// The addresses can hold logins: this user's alone.
			tmp := s.file(id) + ".tmp"
			if err = os.WriteFile(tmp, b, 0o600); err == nil {
				err = os.Rename(tmp, s.file(id))
			}
		}
	}
	if err != nil {
		log.Printf("live tv: keeping the channels: %v", err)
	}
}

func (s *Service) read(id string) ([]Channel, bool) {
	b, err := os.ReadFile(s.file(id))
	if err != nil {
		return nil, false
	}
	var in []stored
	if json.Unmarshal(b, &in) != nil {
		return nil, false
	}
	out := make([]Channel, len(in))
	for i, c := range in {
		out[i] = c.Channel
		out[i].URL, out[i].Headers = c.U, c.H
	}
	return out, true
}

// load is a source's channels: the ones in memory or kept on disk, fetched
// again when they're a day old (or force). A source that doesn't answer
// keeps the list it had.
func (s *Service) load(ctx context.Context, src Source, force bool) ([]Channel, error) {
	s.mu.Lock()
	list, ok := s.loaded[src.ID]
	s.mu.Unlock()
	if !ok {
		if list, ok = s.read(src.ID); ok {
			s.mu.Lock()
			s.loaded[src.ID] = list
			s.mu.Unlock()
		}
	}
	fresh := s.Now().Sub(time.Unix(src.FetchedAt, 0)) < refreshAfter
	if ok && !force && (fresh || util.Offline()) {
		return list, nil
	}
	if ok && !force {
		// Shown as it is now; the new list comes in the background.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			if _, err := s.refetch(ctx, src); err == nil {
				s.changed("sources", nil)
			}
		}()
		return list, nil
	}
	got, err := s.refetch(ctx, src)
	if err != nil && ok {
		return list, nil
	}
	return got, err
}

// refetch fetches a source's channels, once at a time for a source.
func (s *Service) refetch(ctx context.Context, src Source) ([]Channel, error) {
	s.mu.Lock()
	if wait, busy := s.fetching[src.ID]; busy {
		s.mu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		s.mu.Lock()
		list := s.loaded[src.ID]
		s.mu.Unlock()
		return list, nil
	}
	done := make(chan struct{})
	s.fetching[src.ID] = done
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.fetching, src.ID)
		s.mu.Unlock()
		close(done)
	}()

	list, guide, err := s.fetch(ctx, src)
	if err == nil && len(list) == 0 {
		err = invalid("%s has no channels any more", src.Name)
	}
	now := s.Now().Unix()
	if err != nil {
		// Asked again in an hour, not at every look.
		s.update(src.ID, func(o *Source) { o.Error, o.FetchedAt = Message(err), now-int64(refreshAfter/time.Second)+3600 })
		return nil, err
	}
	s.store(src.ID, list)
	s.update(src.ID, func(o *Source) { o.Error, o.Guide, o.Channels, o.FetchedAt = "", guide, len(list), now })
	return list, nil
}

// all are the channels of the sources that are on.
func (s *Service) all(ctx context.Context) []Channel {
	var out []Channel
	for _, src := range s.Sources() {
		if !src.Enabled {
			continue
		}
		list, err := s.load(ctx, src, false)
		if err != nil {
			log.Printf("live tv: %s: %v", src.Name, Message(err))
			continue
		}
		out = append(out, list...)
	}
	return out
}

// Listed is a channel as the Live TV page shows it.
type Listed struct {
	Channel
	Favourite bool `json:"favourite,omitempty"`
	// Web names the service of a channel that is a web page (it opens in
	// the browser).
	Web string `json:"web,omitempty"`
	// Down: the last check found it not working (shown when those aren't
	// hidden), and why.
	Down string `json:"down,omitempty"`
}

// List is what the Live TV page shows.
type List struct {
	Channels []Listed `json:"channels"`
	// Hidden counts the channels left out: not working, and region-locked.
	HiddenDown   int `json:"hiddenDown"`
	HiddenLocked int `json:"hiddenLocked"`
	// Recent are the keys of those watched last.
	Recent []string `json:"recent"`
}

var adultGroups = regexp.MustCompile(`(?i)xxx|adult|18\+|porn|erotic`)

// Channels are the channels of the sources that are on, without those the
// settings leave out (adult groups unless adult titles are shown). The
// stale ones are checked in the background when that's on.
func (s *Service) Channels(ctx context.Context, adult bool) List {
	all := s.all(ctx)
	set := s.Settings()
	country := s.country()
	fav := map[string]bool{}
	for _, k := range s.Favourites() {
		fav[k] = true
	}
	health := s.healthMap()
	now := s.Now()
	out := List{Channels: make([]Listed, 0, len(all)), Recent: s.Recent()}
	if out.Recent == nil {
		out.Recent = []string{}
	}
	var due []Channel
	s.mu.Lock()
	for _, c := range all {
		if !adult && adultGroups.MatchString(c.Group) {
			continue
		}
		l := Listed{Channel: c, Favourite: fav[c.Key], Web: webPage(c.URL)}
		h, checked := health[c.Key]
		if checked && now.Sub(time.Unix(h.At, 0)) > healthFor {
			checked = false
		}
		if !checked || now.Sub(time.Unix(h.At, 0)) > checkAfter {
			if l.Web == "" {
				due = append(due, c)
			}
		}
		// A favourite stays in sight, whatever a check says.
		if c.RegionLocked && country != "" && !strings.EqualFold(c.Country, country) && set.HideRegionLocked && !l.Favourite {
			out.HiddenLocked++
			continue
		}
		if checked && !h.OK {
			if set.HideNotWorking && !l.Favourite {
				out.HiddenDown++
				continue
			}
			l.Down = h.Why
			if l.Down == "" {
				l.Down = "not working"
			}
		}
		out.Channels = append(out.Channels, l)
	}
	s.mu.Unlock()
	if set.AutoCheck && len(due) > 0 && !util.Offline() {
		s.StartCheck(due)
	}
	return out
}

// find is the channel with that key, and every channel (for its backups).
func (s *Service) find(ctx context.Context, key string) (Channel, []Channel, bool) {
	all := s.all(ctx)
	for _, c := range all {
		if c.Key == key {
			return c, all, true
		}
	}
	return Channel{}, all, false
}

// Play is a channel to play: its address and headers (for the server's
// proxy and converter, never the app), and the same channel elsewhere to
// fall back on.
type Play struct {
	Channel Channel
	Backups []Channel
	// Web names the service when the channel is a web page.
	Web string
}

// Open finds the channel to play and notes it as watched.
func (s *Service) Open(ctx context.Context, key string) (Play, error) {
	c, all, ok := s.find(ctx, key)
	if !ok {
		return Play{}, invalid("that channel isn't in your lists any more")
	}
	s.watched(key)
	p := Play{Channel: c, Web: webPage(c.URL)}
	for _, b := range alternatives(all, c, 4) {
		if webPage(b.URL) == "" {
			p.Backups = append(p.Backups, b)
		}
	}
	return p, nil
}

// SourceName is a source's name ("" when it's gone).
func (s *Service) SourceName(id string) string {
	src, _ := s.source(id)
	return src.Name
}

// ---------------------------------------------------------------------------
// Guide

// guideURL is where a source's guide is ("" for none).
func guideURL(src Source) string {
	switch {
	case src.EPG != "":
		return src.EPG
	case src.Kind == KindXtream:
		return src.URL + "/xmltv.php?username=" + url.QueryEscape(src.User) + "&password=" + url.QueryEscape(src.Pass)
	}
	return src.Guide
}

// Now is what's on a channel, and what follows.
type Now struct {
	Now  *Programme `json:"now,omitempty"`
	Next *Programme `json:"next,omitempty"`
}

// Guide is what's on now and next, by channel key, for the channels whose
// source has a guide that knows them. Guides are fetched in the background
// (twice a day): the first ask may have nothing yet, and Live TV is told
// when they're in.
func (s *Service) Guide(ctx context.Context) map[string]Now {
	out := map[string]Now{}
	now := s.Now()
	s.all(ctx) // the channels, when nothing asked for them yet
	for _, src := range s.Sources() {
		link := guideURL(src)
		if !src.Enabled || link == "" {
			continue
		}
		s.mu.Lock()
		g := s.guide[link]
		if !g.loading && now.Sub(g.at) > guideAfter && !util.Offline() {
			g.loading = true
			s.guide[link] = g
			go s.loadGuide(src, link)
		}
		list := s.loaded[src.ID]
		s.mu.Unlock()
		if len(g.channels) == 0 {
			continue
		}
		for _, c := range list {
			if c.EPGID == "" {
				continue
			}
			progs := g.channels[strings.ToLower(c.EPGID)]
			if on, next := nowNext(progs, now.Unix()); on != nil || next != nil {
				out[c.Key] = Now{Now: on, Next: next}
			}
		}
	}
	return out
}

// Programmes are a channel's programmes, from three hours ago on.
func (s *Service) Programmes(ctx context.Context, key string) []Programme {
	c, _, ok := s.find(ctx, key)
	src, _ := s.source(c.Source)
	if !ok || c.EPGID == "" {
		return []Programme{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.guide[guideURL(src)].channels[strings.ToLower(c.EPGID)]
	if out == nil {
		out = []Programme{}
	}
	return out
}

func (s *Service) loadGuide(src Source, link string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var parsed map[string][]Programme
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err == nil {
		req.Header.Set("User-Agent", util.UserAgent)
		var resp *http.Response
		if resp, err = s.client(src).Do(req); err == nil {
			if resp.StatusCode != http.StatusOK {
				err = fmt.Errorf("the server answered %s", resp.Status)
			} else {
				// Read as it comes, up to 1 GB of it.
				parsed, err = ParseXMLTV(io.LimitReader(resp.Body, 1<<30), s.Now())
			}
			resp.Body.Close()
		}
	}
	s.mu.Lock()
	g := s.guide[link]
	g.loading = false
	// Asked again in an hour when it failed.
	g.at = s.Now()
	if err != nil {
		g.at = g.at.Add(-guideAfter + time.Hour)
		log.Printf("live tv: %s's guide: %v", src.Name, tidy(err))
	} else {
		g.channels = parsed
	}
	s.guide[link] = g
	s.mu.Unlock()
	if err == nil {
		s.changed("guide", nil)
	}
}
