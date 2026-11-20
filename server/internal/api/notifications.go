package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/events"
)

// Notifications (the bell on Home): two lists.
//
// Shows is about the movies and shows on the list, put together when asked:
// the episodes that came out this week of the shows being watched, and the
// movies of the watchlist that came out.
//
// System is what Moviko did or needs: a download finished or failed, a scan
// found files, the auto downloader took a release, an update is out,
// something went wrong. They're noted here as the app's events go by (the
// ones GET /api/events sends to the pages), the last maxSystem of them.
//
// What was seen is a time per list, kept here so every device agrees: a
// notification newer than it is new.
//
// Not the alerts (package notify), which say things once as they happen, as
// a toast or a notification of the system: these lists stay to be read.
//
// Devices on the LAN read both lists, mark them seen and clear the System
// one, as they get the same events and change the list.

// notifItem is one notification, of either list.
type notifItem struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text"`
	At    int64  `json:"at"` // unix seconds
	// Cover: the movie's or show's, where it's about one.
	Cover string `json:"cover,omitempty"`
	// To: the page it leads to (the app's own path).
	To      string `json:"to,omitempty"`
	MediaID int    `json:"mediaId,omitempty"`
}

const (
	kvNotifSystem = "notifications:system"
	kvNotifSeen   = "notifications:seen"

	maxSystem = 50
	maxShows  = 40
	// An episode or a movie that came out is news for a week.
	airedFor = 7 * 24 * time.Hour
	// The same thing again this soon after is the same notification.
	sameWithin = 10 * time.Minute
)

// systemLog is the System list as kept.
type systemLog struct {
	Items []notifItem `json:"items"` // newest first
	// Update: the version last told about (once each, also after Clear).
	Update string `json:"update,omitempty"`
}

// notifMu: one change at a time to what's kept (the events come on their
// own goroutine, the requests on theirs).
var notifMu sync.Mutex

func (s *Server) notificationRoutes() {
	m := s.mux
	m.HandleFunc("GET /api/notifications", h(s.notifications))
	m.HandleFunc("POST /api/notifications/seen", h(s.notificationsSeen))
	m.HandleFunc("DELETE /api/notifications/system", h(func(r *http.Request) (any, error) {
		notifMu.Lock()
		defer notifMu.Unlock()
		var l systemLog
		_, _ = s.app.DB.GetKV(kvNotifSystem, &l)
		l.Items = nil
		return nil, s.app.DB.SetKV(kvNotifSystem, l)
	}))
	// The app's events, as the pages get them, for as long as it runs.
	ch, unsub := s.app.Hub.Subscribe()
	go func() {
		defer unsub()
		done := s.app.Context().Done()
		for {
			select {
			case <-done:
				return
			case raw, ok := <-ch:
				if !ok {
					return
				}
				s.systemEvent(raw, time.Now())
			}
		}
	}()
}

func (s *Server) notifications(r *http.Request) (any, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	shows := s.showNotifications(ctx, time.Now())
	notifMu.Lock()
	var l systemLog
	_, _ = s.app.DB.GetKV(kvNotifSystem, &l)
	seen := s.notifSeen()
	notifMu.Unlock()
	return map[string]any{
		"shows":  append([]notifItem{}, shows...),
		"system": append([]notifItem{}, l.Items...),
		"seen":   seen,
	}, nil
}

// notifSeen is when each list was last looked at (0: never).
func (s *Server) notifSeen() map[string]int64 {
	seen := map[string]int64{}
	_, _ = s.app.DB.GetKV(kvNotifSeen, &seen)
	return map[string]int64{"shows": seen["shows"], "system": seen["system"]}
}

// A list was looked at: it's seen up to at, the time of the newest one
// shown (one that came in since stays new), or up to now without it. Never
// back in time; nothing is removed.
func (s *Server) notificationsSeen(r *http.Request) (any, error) {
	var body struct {
		Category string `json:"category"`
		At       int64  `json:"at"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if body.Category != "shows" && body.Category != "system" {
		return nil, badRequest("category is shows or system")
	}
	at := time.Now().Unix()
	if body.At > 0 && body.At < at {
		at = body.At
	}
	notifMu.Lock()
	defer notifMu.Unlock()
	seen := s.notifSeen()
	if at <= seen[body.Category] {
		return map[string]any{"seen": seen}, nil
	}
	seen[body.Category] = at
	if err := s.app.DB.SetKV(kvNotifSeen, seen); err != nil {
		return nil, err
	}
	return map[string]any{"seen": seen}, nil
}

// ---------------------------------------------------------------------------
// Shows

// showNotifications puts the Shows list together, newest first. The
// episodes are left out when the calendar can't be had (TMDB not answering,
// no key): the movies, which the list has, still show.
func (s *Server) showNotifications(ctx context.Context, now time.Time) []notifItem {
	showAdult := s.app.Settings.Get().UI.ShowAdult
	coll, err := s.app.Platform.Collection(ctx, "", false)
	if err != nil || coll == nil {
		return nil
	}
	entries := coll.Entries()
	since := now.Add(-airedFor).Unix()
	var out []notifItem

	// Episodes out, of the shows being watched.
	if wantsAired(entries) {
		// Whole days, so that the calendar kept (an hour) is found again.
		day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		eps, _ := s.app.Platform.Schedule(ctx, day.AddDate(0, 0, -7).Unix(), day.AddDate(0, 0, 1).Unix())
		out = append(out, airedItems(eps, entries, since, now.Unix(), showAdult)...)
	}

	// Movies out, of the watchlist.
	out = append(out, releasedItems(entries, since, now.Unix(), showAdult)...)

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].At != out[j].At {
			return out[i].At > out[j].At
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > maxShows {
		out = out[:maxShows]
	}
	return out
}

// airedStatuses: the lists whose shows' new episodes are news (the ones
// the alerts tell about).
var airedStatuses = map[string]bool{"CURRENT": true, "REPEATING": true}

// wantsAired: the list has a show whose episodes would be told about
// (without one the calendar isn't asked for).
func wantsAired(entries []*catalog.ListEntry) bool {
	for _, e := range entries {
		if airedStatuses[e.Status] && catalog.IsShow(e.MediaID) {
			return true
		}
	}
	return false
}

// airedItems is the episodes out between since and now of the shows being
// watched, one notification for those of a show out the same day (a season
// put out at once). One watched already isn't news, nor a special.
func airedItems(eps []*catalog.AiringEpisode, entries []*catalog.ListEntry, since, now int64, showAdult bool) []notifItem {
	list := map[int]*catalog.ListEntry{}
	for _, e := range entries {
		if airedStatuses[e.Status] {
			list[e.MediaID] = e
		}
	}
	type batch struct {
		media *catalog.Media
		at    int64
		keys  []int
	}
	var batches []*batch
	byDay := map[[2]int64]*batch{}
	told := map[[2]int]bool{}
	for _, ep := range eps {
		if ep == nil || ep.Media == nil || int64(ep.AiringAt) <= since || int64(ep.AiringAt) > now {
			continue
		}
		if season, _ := catalog.SplitKey(ep.Episode); season == 0 {
			continue
		}
		e := list[ep.Media.ID]
		if e == nil || e.Progress >= ep.Episode || (ep.Media.IsAdult && !showAdult) {
			continue
		}
		if told[[2]int{ep.Media.ID, ep.Episode}] {
			continue
		}
		told[[2]int{ep.Media.ID, ep.Episode}] = true
		day := [2]int64{int64(ep.Media.ID), int64(ep.AiringAt)}
		b := byDay[day]
		if b == nil {
			b = &batch{media: ep.Media, at: int64(ep.AiringAt)}
			byDay[day] = b
			batches = append(batches, b)
		}
		b.keys = append(b.keys, ep.Episode)
	}
	var out []notifItem
	for _, b := range batches {
		sort.Ints(b.keys)
		first, last := b.keys[0], b.keys[len(b.keys)-1]
		text := catalog.FormatKey(first) + " is out"
		if first != last {
			text = keyRange(first, last) + " are out"
		}
		out = append(out, notifItem{
			ID: fmt.Sprintf("aired:%d:%d", b.media.ID, last), Kind: "aired", Title: b.media.PreferredTitle(), Text: text,
			At: b.at, Cover: coverOf(b.media), To: "/entry?id=" + strconv.Itoa(b.media.ID), MediaID: b.media.ID,
		})
	}
	return out
}

// keyRange writes a run of episodes by its ends: "S02E01–E08", or
// "S02E08–S03E01" across seasons.
func keyRange(first, last int) string {
	fs, _ := catalog.SplitKey(first)
	ls, le := catalog.SplitKey(last)
	if fs == ls {
		return fmt.Sprintf("%s–E%02d", catalog.FormatKey(first), le)
	}
	return catalog.FormatKey(first) + "–" + catalog.FormatKey(last)
}

// releasedItems is the movies of the watchlist that came out between since
// and now. TMDB only has the day: a movie is out at 00:00 UTC that day,
// like an episode.
func releasedItems(entries []*catalog.ListEntry, since, now int64, showAdult bool) []notifItem {
	var out []notifItem
	for _, e := range entries {
		m := e.Media
		if e.Status != "PLANNING" || m == nil || m.IsShow() || (m.IsAdult && !showAdult) {
			continue
		}
		d := m.StartDate
		if d.Year == nil || d.Month == nil || d.Day == nil {
			continue
		}
		at := time.Date(*d.Year, time.Month(*d.Month), *d.Day, 0, 0, 0, 0, time.UTC).Unix()
		if at <= since || at > now {
			continue
		}
		out = append(out, notifItem{
			ID: "released:" + strconv.Itoa(m.ID), Kind: "released", Title: m.PreferredTitle(), Text: "Out now",
			At: at, Cover: coverOf(m), To: "/entry?id=" + strconv.Itoa(m.ID), MediaID: m.ID,
		})
	}
	return out
}

// coverOf is a cover for a small picture.
func coverOf(m *catalog.Media) string {
	c := m.CoverImage
	for _, u := range []string{c.Large, c.Medium, c.ExtraLarge} {
		if u != "" {
			return u
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// System

// systemEvent looks at one of the app's events (as sent to the pages) and
// notes the ones worth a notification. Not the ones that come all the time
// (progress, the pages' refreshes), nor the alerts (package notify): what
// they say is noted from the download, the scan and the calendar.
func (s *Server) systemEvent(raw []byte, now time.Time) {
	var ev struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if json.Unmarshal(raw, &ev) != nil || len(ev.Payload) == 0 {
		return
	}
	switch ev.Type {
	case events.DownloadProgress:
		// A download, each time it changes: only its end is noted.
		var d struct {
			ID      string `json:"id"`
			MediaID int    `json:"mediaId"`
			Episode int    `json:"episode"`
			Title   string `json:"title"`
			Image   string `json:"image"`
			Status  string `json:"status"`
			Error   string `json:"error"`
		}
		if json.Unmarshal(ev.Payload, &d) != nil || d.ID == "" {
			return
		}
		it := notifItem{Title: d.Title, Cover: d.Image, MediaID: d.MediaID}
		if it.Title == "" {
			it.Title = "Download"
		}
		// A show's episode by its number; a movie is the one file.
		episode := ""
		if catalog.IsShow(d.MediaID) && d.Episode > 0 {
			episode = catalog.FormatKey(d.Episode) + " "
		}
		switch d.Status {
		case "completed":
			it.Kind, it.Text, it.To = "downloaded", sentence(episode+"downloaded"), "/downloads"
			if d.MediaID > 0 {
				it.To = "/entry?id=" + strconv.Itoa(d.MediaID)
			}
		case "failed":
			it.Kind, it.Text, it.To = "download-failed", sentence(episode+"failed to download"), "/downloads"
			if d.Error != "" {
				it.Text += " · " + d.Error
			}
		default:
			return
		}
		s.noteSystem("download:"+d.ID+":"+d.Status, it, now)

	case events.ScanDone:
		var p struct {
			Added     int    `json:"added"`
			Unmatched int    `json:"unmatched"`
			Error     string `json:"error"`
		}
		if json.Unmarshal(ev.Payload, &p) != nil {
			return
		}
		if p.Error != "" {
			s.noteSystem("scan-failed:"+p.Error, notifItem{Kind: "scan-failed", Title: "Library scan failed", Text: p.Error, To: "/library"}, now)
			return
		}
		// A scan that found nothing new says nothing (they run by
		// themselves as files change).
		if p.Added <= 0 {
			return
		}
		it := notifItem{Kind: "scan", Title: "Library scan", Text: plural(p.Added, "new file"), To: "/local"}
		if p.Unmatched > 0 {
			it.Text += fmt.Sprintf(" · %d unmatched in the library", p.Unmatched)
			it.To = "/library?tab=unmatched"
		}
		s.noteSystem(fmt.Sprintf("scan:%d:%d", p.Added, p.Unmatched), it, now)

	case events.Toast:
		var t events.ToastPayload
		if json.Unmarshal(ev.Payload, &t) != nil || t.Message == "" {
			return
		}
		switch what, auto := strings.CutPrefix(t.Message, "Auto downloader: "); {
		case auto:
			s.noteSystem("auto:"+what, notifItem{Kind: "auto-download", Title: "Auto downloader", Text: what, To: "/auto-downloader"}, now)
		case strings.HasPrefix(t.Message, "Download failed ("):
			// Noted from the download itself, above.
		case t.Level == "error":
			s.noteSystem("error:"+t.Message, notifItem{Kind: "error", Title: "Error", Text: t.Message}, now)
		case t.Level == "warning":
			s.noteSystem("warning:"+t.Message, notifItem{Kind: "warning", Title: "Warning", Text: t.Message}, now)
		}

	case events.UpdateStatus:
		// Sent at every step of a check or an install: a version is told
		// about once.
		var u struct {
			Available bool `json:"available"`
			Latest    *struct {
				Version string `json:"version"`
				Beta    bool   `json:"beta"`
			} `json:"latest"`
		}
		if json.Unmarshal(ev.Payload, &u) != nil || !u.Available || u.Latest == nil || u.Latest.Version == "" {
			return
		}
		notifMu.Lock()
		defer notifMu.Unlock()
		var l systemLog
		_, _ = s.app.DB.GetKV(kvNotifSystem, &l)
		if l.Update == u.Latest.Version {
			return
		}
		l.Update = u.Latest.Version
		it := notifItem{Kind: "update", Title: "Update available", Text: "Moviko " + u.Latest.Version, To: "/settings?tab=updates"}
		if u.Latest.Beta {
			it.Text += " (beta)"
		}
		l.add("update:"+u.Latest.Version, it, now)
		_ = s.app.DB.SetKV(kvNotifSystem, l)
	}
}

// noteSystem adds a notification to the System list. key names what it's
// about: the same again within sameWithin isn't noted twice.
func (s *Server) noteSystem(key string, it notifItem, now time.Time) {
	notifMu.Lock()
	defer notifMu.Unlock()
	var l systemLog
	_, _ = s.app.DB.GetKV(kvNotifSystem, &l)
	if l.add(key, it, now) {
		_ = s.app.DB.SetKV(kvNotifSystem, l)
	}
}

// add puts it first in the list (its ID is its key and its time), unless
// the same key is there from a moment ago; the oldest past maxSystem go.
func (l *systemLog) add(key string, it notifItem, now time.Time) bool {
	it.At = now.Unix()
	for _, old := range l.Items {
		if i := strings.LastIndexByte(old.ID, '@'); i >= 0 && old.ID[:i] == key && it.At-old.At < int64(sameWithin/time.Second) {
			return false
		}
	}
	it.ID = key + "@" + strconv.FormatInt(it.At, 10)
	l.Items = append([]notifItem{it}, l.Items...)
	if len(l.Items) > maxSystem {
		l.Items = l.Items[:maxSystem]
	}
	return true
}

func plural(n int, what string) string {
	if n == 1 {
		return "1 " + what
	}
	return fmt.Sprintf("%d %ss", n, what)
}

// sentence is s with its first letter a capital ("downloaded" alone, for a
// movie; "S01E02 downloaded" is one already).
func sentence(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
