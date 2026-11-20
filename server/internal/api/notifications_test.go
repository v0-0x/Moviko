package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
	"github.com/v0-0x/kumobox-movies/server/internal/events"
)

type notifAnswer struct {
	Shows  []notifItem      `json:"shows"`
	System []notifItem      `json:"system"`
	Seen   map[string]int64 `json:"seen"`
}

func getNotifications(t *testing.T, s *Server) notifAnswer {
	t.Helper()
	w := do(s, "GET", "/api/notifications", local, "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("notifications: %d %s", w.Code, w.Body.String())
	}
	var a notifAnswer
	if err := json.Unmarshal(w.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	if a.Shows == nil || a.System == nil {
		t.Fatalf("a list is null, not empty: %s", w.Body.String())
	}
	return a
}

func notifShow(tmdbID int, name string) *catalog.Media {
	m := &catalog.Media{ID: catalog.ShowID(tmdbID), TMDBID: tmdbID, Type: catalog.TypeTV, Status: "RELEASING", Title: catalog.Title{English: name}}
	m.CoverImage.Large = fmt.Sprintf("https://img.example/tv%d.jpg", tmdbID)
	return m
}

func notifMovie(tmdbID int, name string, released time.Time) *catalog.Media {
	m := &catalog.Media{ID: catalog.MovieID(tmdbID), TMDBID: tmdbID, Type: catalog.TypeMovie, Status: "FINISHED", Title: catalog.Title{English: name}}
	m.CoverImage.Large = fmt.Sprintf("https://img.example/movie%d.jpg", tmdbID)
	if !released.IsZero() {
		y, mo, d := released.UTC().Date()
		month := int(mo)
		m.StartDate = catalog.FuzzyDate{Year: &y, Month: &month, Day: &d}
	}
	return m
}

// An episode that came out this week of a show being watched (or watched
// again) is told about: not one watched already, not of a show on another
// list or off the list, not one still to come or older than a week, not a
// special, not an 18+ one unless those are shown. The episodes of a show
// out the same day are one notification.
func TestNotifAired(t *testing.T) {
	now := int64(1_800_000_000)
	hour, day := int64(3600), int64(86400)
	entry := func(id int, status string, progress int) *catalog.ListEntry {
		return &catalog.ListEntry{MediaID: catalog.ShowID(id), Status: status, Progress: progress, Media: notifShow(id, fmt.Sprint("Show ", id))}
	}
	ep := func(id, key int, at int64) *catalog.AiringEpisode {
		return &catalog.AiringEpisode{AiringAt: int(at), Episode: key, Media: notifShow(id, fmt.Sprint("Show ", id))}
	}
	adult := ep(7, 1002, now-hour)
	adult.Media.IsAdult = true
	entries := []*catalog.ListEntry{
		entry(1, "CURRENT", 2007), entry(2, "PLANNING", 0), entry(3, "PAUSED", 1003), entry(4, "COMPLETED", 1012),
		entry(5, "DROPPED", 1001), entry(6, "CURRENT", 1009), entry(7, "CURRENT", 0), entry(8, "REPEATING", 1002),
		entry(10, "CURRENT", 0), entry(11, "CURRENT", 2009),
	}
	eps := []*catalog.AiringEpisode{
		ep(1, 2008, now-2*hour),                    // watching, not seen yet
		ep(1, 2008, now-2*hour),                    // the same one twice in the calendar
		ep(2, 1001, now-3*day),                     // on the watchlist: not told
		ep(3, 1005, now-5*day),                     // paused
		ep(4, 1013, now-hour),                      // watched
		ep(5, 1002, now-hour),                      // dropped
		ep(6, 1009, now-hour),                      // watched already
		adult,                                      // 18+
		ep(8, 3001, now-6*day),                     // watching again
		ep(9, 1001, now-hour),                      // not on the list
		ep(1, 2009, now+hour),                      // not out yet
		ep(1, 2006, now-8*day),                     // older than a week
		ep(1, 3, now-hour),                         // a special
		ep(10, 1003, now-day),                      // a season out at once...
		ep(10, 1001, now-day),                      //
		ep(10, 1002, now-day),                      //
		ep(10, 1004, now-2*hour),                   // ...and one more the day after
		ep(11, 2010, now-3*day),                    // the last of a season and
		ep(11, 3001, now-3*day),                    // the first of the next
		{AiringAt: int(now - hour), Episode: 1004}, // no show
		nil,
	}
	got := airedItems(eps, entries, now-7*day, now, false)
	want := []struct{ id, text string }{
		{fmt.Sprintf("aired:%d:2008", catalog.ShowID(1)), "S02E08 is out"},
		{fmt.Sprintf("aired:%d:3001", catalog.ShowID(8)), "S03E01 is out"},
		{fmt.Sprintf("aired:%d:1003", catalog.ShowID(10)), "S01E01–E03 are out"},
		{fmt.Sprintf("aired:%d:1004", catalog.ShowID(10)), "S01E04 is out"},
		{fmt.Sprintf("aired:%d:3001", catalog.ShowID(11)), "S02E10–S03E01 are out"},
	}
	if len(got) != len(want) {
		t.Fatalf("aired = %+v, want %v", got, want)
	}
	for i, w := range want {
		if got[i].ID != w.id || got[i].Text != w.text {
			t.Fatalf("aired[%d] = %s %q, want %s %q", i, got[i].ID, got[i].Text, w.id, w.text)
		}
	}
	first := got[0]
	if first.Title != "Show 1" || first.At != now-2*hour || first.To != fmt.Sprintf("/entry?id=%d", catalog.ShowID(1)) || first.MediaID != catalog.ShowID(1) ||
		first.Cover != "https://img.example/tv1.jpg" || first.Kind != "aired" {
		t.Fatalf("aired item = %+v", first)
	}
	if got := airedItems(eps, entries, now-7*day, now, true); len(got) != 6 {
		t.Fatalf("with 18+ shown: %d items, want 6", len(got))
	}
	movie := &catalog.ListEntry{MediaID: 155, Status: "CURRENT", Media: notifMovie(155, "A Movie", time.Time{})}
	if wantsAired(entries[1:5]) || wantsAired([]*catalog.ListEntry{movie}) || !wantsAired(entries) {
		t.Fatal("wantsAired: only a list with a show being watched asks for the calendar")
	}
}

// A movie of the watchlist that came out this week is told about: not one
// on another list, not one still to come or out for longer, not one without
// its day, not a show, not an 18+ one unless those are shown.
func TestNotifReleased(t *testing.T) {
	now := time.Date(2027, 1, 15, 12, 0, 0, 0, time.UTC)
	day := func(n int) time.Time { return now.AddDate(0, 0, n) }
	entry := func(id int, status string, released time.Time) *catalog.ListEntry {
		return &catalog.ListEntry{MediaID: id, Status: status, Media: notifMovie(id, fmt.Sprint("Movie ", id), released)}
	}
	adult := entry(6, "PLANNING", day(-1))
	adult.Media.IsAdult = true
	noDay := entry(7, "PLANNING", day(-1))
	noDay.Media.StartDate.Day = nil
	show := &catalog.ListEntry{MediaID: catalog.ShowID(8), Status: "PLANNING", Media: notifShow(8, "A Show")}
	show.Media.StartDate = notifMovie(8, "", day(-1)).StartDate
	entries := []*catalog.ListEntry{
		entry(1, "PLANNING", day(-2)), entry(2, "PLANNING", day(0)), entry(3, "PLANNING", day(1)), entry(4, "PLANNING", day(-8)),
		entry(5, "COMPLETED", day(-2)), adult, noDay, show, {MediaID: 9, Status: "PLANNING"},
	}
	got := releasedItems(entries, now.Add(-airedFor).Unix(), now.Unix(), false)
	if len(got) != 2 || got[0].ID != "released:1" || got[1].ID != "released:2" {
		t.Fatalf("released = %+v", got)
	}
	want := time.Date(2027, 1, 13, 0, 0, 0, 0, time.UTC).Unix()
	if it := got[0]; it.Kind != "released" || it.Title != "Movie 1" || it.Text != "Out now" || it.At != want || it.To != "/entry?id=1" || it.MediaID != 1 || it.Cover != "https://img.example/movie1.jpg" {
		t.Fatalf("released item = %+v", it)
	}
	if got := releasedItems(entries, now.Add(-airedFor).Unix(), now.Unix(), true); len(got) != 3 {
		t.Fatalf("with 18+ shown: %d items, want 3", len(got))
	}
}

// Shows over the API, from this Moviko's own list and what it keeps of TMDB
// (nothing is asked of TMDB: the seasons are in the cache).
func TestNotifShowsRoute(t *testing.T) {
	s := newTestServer(t)
	if a := getNotifications(t, s); len(a.Shows) != 0 || len(a.System) != 0 || a.Seen["shows"] != 0 || a.Seen["system"] != 0 {
		t.Fatalf("at first: %+v", a)
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	day := func(n int) string { return today.AddDate(0, 0, n).Format(time.DateOnly) }

	show := notifShow(500, "Severance")
	show.Seasons = []catalog.Season{{Number: 1, EpisodeCount: 9}, {Number: 2, EpisodeCount: 10, AirDate: day(-20)}}
	show.LatestEpisode = 2004
	s.app.DB.SetCache(fmt.Sprintf("media-lite:%d", show.ID), show, time.Hour)
	st, progress := "CURRENT", 2002
	if err := s.app.Platform.UpdateEntry(t.Context(), catalog.EntryUpdate{MediaID: show.ID, Status: &st, Progress: &progress}); err != nil {
		t.Fatal(err)
	}
	episode := func(n int, date string) *catalog.Episode {
		return &catalog.Episode{Key: catalog.EpisodeKey(2, n), Season: 2, Number: n, AirDate: date}
	}
	s.app.DB.SetCache(fmt.Sprintf("season:%d:2", show.ID), catalog.SeasonDetail{MediaID: show.ID, Number: 2, Episodes: []*catalog.Episode{
		episode(1, day(-20)), episode(2, day(-8)), episode(3, day(-2)), episode(4, day(0)), episode(5, day(2)),
	}}, time.Hour)
	// On the watchlist: a movie out yesterday, one out next month.
	for _, m := range []*catalog.Media{notifMovie(155, "The Dark Knight", today.AddDate(0, 0, -1)), notifMovie(156, "Not out yet", today.AddDate(0, 1, 0))} {
		s.app.DB.SetCache(fmt.Sprintf("media-lite:%d", m.ID), m, time.Hour)
		if err := s.app.Platform.UpdateEntry(t.Context(), catalog.EntryUpdate{MediaID: m.ID}); err != nil {
			t.Fatal(err)
		}
	}

	a := getNotifications(t, s)
	want := []string{fmt.Sprintf("aired:%d:2004", show.ID), "released:155", fmt.Sprintf("aired:%d:2003", show.ID)}
	if len(a.Shows) != len(want) {
		t.Fatalf("shows = %+v, want %v", a.Shows, want)
	}
	for i, id := range want {
		if a.Shows[i].ID != id {
			t.Fatalf("shows[%d] (newest first) = %s, want %s", i, a.Shows[i].ID, id)
		}
	}
	if it := a.Shows[0]; it.Title != "Severance" || it.Text != "S02E04 is out" || it.To != fmt.Sprintf("/entry?id=%d", show.ID) || it.At != today.Unix() {
		t.Fatalf("aired = %+v", it)
	}
	// Watched: no longer news.
	progress = 2004
	if err := s.app.Platform.UpdateEntry(t.Context(), catalog.EntryUpdate{MediaID: show.ID, Progress: &progress}); err != nil {
		t.Fatal(err)
	}
	if a = getNotifications(t, s); len(a.Shows) != 1 || a.Shows[0].ID != "released:155" {
		t.Fatalf("after watching: %+v", a.Shows)
	}
}

func event(typ string, payload any) []byte {
	raw, _ := json.Marshal(events.Event{Type: typ, Payload: payload})
	return raw
}

// The System list: the events worth one are noted, newest first, the same
// one once; not progress, not what the pages refresh on.
func TestNotifSystem(t *testing.T) {
	s := newTestServer(t)
	now := time.Unix(1_800_000_000, 0)
	showID := catalog.ShowID(500)
	dl := func(id string, mediaID, episode int, title, status, errText string, progress float64) []byte {
		return event(events.DownloadProgress, map[string]any{"id": id, "mediaId": mediaID, "episode": episode, "title": title, "image": "https://img.example/x.jpg", "status": status, "error": errText, "progress": progress})
	}
	ep := func(id, status, errText string, progress float64) []byte {
		return dl(id, showID, 2005, "Severance", status, errText, progress)
	}
	// A download as it goes: only its end is noted, once.
	for _, raw := range [][]byte{ep("a", "queued", "", 0), ep("a", "downloading", "", 0.2), ep("a", "downloading", "", 0.9), ep("a", "completed", "", 1), ep("a", "completed", "", 1)} {
		s.systemEvent(raw, now)
	}
	s.systemEvent(ep("b", "failed", "no source found", 0), now.Add(time.Second))
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "Download failed (Severance - S02E05): no source found"}), now.Add(time.Second))
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "success", Message: "Downloaded Severance - S02E05"}), now.Add(time.Second))
	s.systemEvent(ep("c", "canceled", "", 0), now.Add(time.Second))
	s.systemEvent(event(events.DownloadProgress, map[string]any{"id": "a", "removed": true}), now.Add(time.Second))
	s.systemEvent(event(events.DownloadProgress, map[string]any{"cleared": true}), now.Add(time.Second))
	// The alerts say what's noted already.
	s.systemEvent(event("notify", map[string]any{"kind": "ready", "title": "Severance", "body": "S02E05 is downloaded.", "mediaId": showID, "episode": 2005}), now.Add(time.Second))
	a := getNotifications(t, s)
	if len(a.System) != 2 {
		t.Fatalf("downloads: %+v", a.System)
	}
	if it := a.System[1]; it.Kind != "downloaded" || it.Title != "Severance" || it.Text != "S02E05 downloaded" || it.To != fmt.Sprintf("/entry?id=%d", showID) || it.Cover == "" || it.At != now.Unix() || it.MediaID != showID {
		t.Fatalf("downloaded = %+v", it)
	}
	if it := a.System[0]; it.Kind != "download-failed" || it.Text != "S02E05 failed to download · no source found" || it.To != "/downloads" {
		t.Fatalf("failed = %+v", it)
	}
	if a.System[0].ID == a.System[1].ID || a.System[0].ID == "" {
		t.Fatalf("ids: %q %q", a.System[0].ID, a.System[1].ID)
	}
	// Failed again much later (tried again): noted again.
	s.systemEvent(ep("b", "failed", "no source found", 0), now.Add(time.Hour))
	if a = getNotifications(t, s); len(a.System) != 3 || a.System[0].ID == a.System[1].ID {
		t.Fatalf("failed again: %+v", a.System)
	}
	// A movie is the one file: no episode to name.
	s.systemEvent(dl("m", 155, 1, "The Dark Knight", "completed", "", 1), now.Add(90*time.Minute))
	s.systemEvent(dl("n", 155, 1, "The Dark Knight", "failed", "", 0), now.Add(91*time.Minute))
	if a = getNotifications(t, s); len(a.System) != 5 || a.System[1].Text != "Downloaded" || a.System[1].To != "/entry?id=155" || a.System[0].Text != "Failed to download" {
		t.Fatalf("a movie: %+v", a.System[:min(2, len(a.System))])
	}

	// Scans: one that found files, one that failed; not one with nothing
	// new, nor its progress.
	s.systemEvent(event(events.ScanProgress, map[string]any{"stage": "walking", "done": 1, "total": 9}), now)
	s.systemEvent(event(events.ScanDone, map[string]any{"total": 40, "added": 0, "unmatched": 3}), now)
	s.systemEvent(event(events.ScanDone, map[string]any{"total": 41, "added": 1, "unmatched": 0}), now.Add(2*time.Hour))
	s.systemEvent(event(events.ScanDone, map[string]any{"total": 53, "added": 12, "unmatched": 3}), now.Add(3*time.Hour))
	s.systemEvent(event(events.ScanDone, map[string]any{"error": "disk gone"}), now.Add(4*time.Hour))
	a = getNotifications(t, s)
	if len(a.System) != 8 || a.System[2].Text != "1 new file" || a.System[2].To != "/local" || a.System[1].Text != "12 new files · 3 unmatched in the library" || a.System[1].To != "/library?tab=unmatched" ||
		a.System[0].Title != "Library scan failed" || a.System[0].Text != "disk gone" {
		t.Fatalf("scans: %+v", a.System[:min(3, len(a.System))])
	}

	// Toasts: the auto downloader's, warnings and errors; not the rest.
	later := now.Add(5 * time.Hour)
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "success", Message: "Auto downloader: Severance S02E06 — Severance.S02E06.1080p.WEB"}), later)
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "info", Message: "Playing Severance"}), later)
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "success", Message: "Library scanned — 53 files, 50 matched"}), later)
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "warning", Message: "Den no longer takes downloads from this device: they're saved here again."}), later.Add(time.Second))
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "warning", Message: "Den no longer takes downloads from this device: they're saved here again."}), later.Add(2*time.Second))
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "Could not update progress: offline"}), later.Add(3*time.Second))
	a = getNotifications(t, s)
	if len(a.System) != 11 || a.System[2].Title != "Auto downloader" || a.System[2].Text != "Severance S02E06 — Severance.S02E06.1080p.WEB" || a.System[2].To != "/auto-downloader" ||
		a.System[1].Title != "Warning" || a.System[0].Title != "Error" || a.System[0].Text != "Could not update progress: offline" {
		t.Fatalf("toasts: %+v", a.System[:min(4, len(a.System))])
	}

	// An update: told once per version, whatever the steps of the check;
	// also after Clear.
	upd := func(version string, available, beta bool) []byte {
		return event(events.UpdateStatus, map[string]any{"available": available, "checking": false, "latest": map[string]any{"version": version, "beta": beta}, "current": map[string]any{"version": "2.1.0"}})
	}
	s.systemEvent(event(events.UpdateStatus, map[string]any{"available": false, "checking": true}), later)
	s.systemEvent(upd("2.1.0", false, false), later)
	s.systemEvent(upd("2.1.1", true, false), later.Add(time.Minute))
	s.systemEvent(upd("2.1.1", true, false), later.Add(time.Hour))
	a = getNotifications(t, s)
	if len(a.System) != 12 || a.System[0].Title != "Update available" || a.System[0].Text != "Moviko 2.1.1" || a.System[0].To != "/settings?tab=updates" {
		t.Fatalf("update: %+v", a.System[:min(2, len(a.System))])
	}
	if w := do(s, "DELETE", "/api/notifications/system", local, "", nil); w.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", w.Code, w.Body.String())
	}
	s.systemEvent(upd("2.1.1", true, false), later.Add(2*time.Hour))
	if a = getNotifications(t, s); len(a.System) != 0 {
		t.Fatalf("after Clear: %+v", a.System)
	}
	s.systemEvent(upd("2.1.2", true, true), later.Add(3*time.Hour))
	if a = getNotifications(t, s); len(a.System) != 1 || a.System[0].Text != "Moviko 2.1.2 (beta)" {
		t.Fatalf("the next version: %+v", a.System)
	}

	// What isn't an event, or carries nothing: ignored.
	s.systemEvent([]byte("not json"), later)
	s.systemEvent(event(events.LibraryUpdated, nil), later)
	s.systemEvent(event(events.CollectionUpdate, map[string]any{"mediaId": 155}), later)
	if a = getNotifications(t, s); len(a.System) != 1 {
		t.Fatalf("after noise: %+v", a.System)
	}
}

// The System list keeps the last maxSystem, newest first.
func TestNotifSystemCap(t *testing.T) {
	s := newTestServer(t)
	now := time.Unix(1_800_000_000, 0)
	for i := range maxSystem + 15 {
		s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: fmt.Sprint("problem ", i)}), now.Add(time.Duration(i)*time.Second))
	}
	a := getNotifications(t, s)
	if len(a.System) != maxSystem || a.System[0].Text != fmt.Sprint("problem ", maxSystem+14) || a.System[maxSystem-1].Text != "problem 15" {
		t.Fatalf("%d kept, first %q, last %q", len(a.System), a.System[0].Text, a.System[len(a.System)-1].Text)
	}
	seen := map[string]bool{}
	for _, it := range a.System {
		if seen[it.ID] {
			t.Fatalf("id %q twice", it.ID)
		}
		seen[it.ID] = true
	}
}

// Seen: a time per list, kept here; looking at one doesn't touch the other,
// nor remove anything.
func TestNotifSeen(t *testing.T) {
	s := newTestServer(t)
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "a problem"}), time.Now().Add(-time.Minute))
	a := getNotifications(t, s)
	if len(a.System) != 1 || a.Seen["system"] != 0 || a.System[0].At <= a.Seen["system"] {
		t.Fatalf("before: %+v", a)
	}
	for _, body := range []string{`{}`, `{"category":"other"}`} {
		if w := do(s, "POST", "/api/notifications/seen", local, body, nil); w.Code != http.StatusBadRequest {
			t.Fatalf("seen %s: %d", body, w.Code)
		}
	}
	before := time.Now().Unix()
	w := do(s, "POST", "/api/notifications/seen", local, `{"category":"system"}`, nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"seen"`) {
		t.Fatalf("seen: %d %s", w.Code, w.Body.String())
	}
	a = getNotifications(t, s)
	if len(a.System) != 1 || a.Seen["system"] < before || a.Seen["shows"] != 0 || a.System[0].At > a.Seen["system"] {
		t.Fatalf("after system seen: %+v", a)
	}
	if w := do(s, "POST", "/api/notifications/seen", local, `{"category":"shows"}`, nil); w.Code != http.StatusOK {
		t.Fatalf("seen shows: %d", w.Code)
	}
	if a = getNotifications(t, s); a.Seen["shows"] < before || a.Seen["system"] < before {
		t.Fatalf("after both: %+v", a.Seen)
	}
	// Seen up to the newest one shown: not past it, never back, never ahead
	// of now.
	shown := a.Seen["shows"]
	seenAfter := func(body string) int64 {
		t.Helper()
		if w := do(s, "POST", "/api/notifications/seen", local, body, nil); w.Code != http.StatusOK {
			t.Fatalf("seen %s: %d", body, w.Code)
		}
		return getNotifications(t, s).Seen["shows"]
	}
	if got := seenAfter(`{"category":"shows","at":1000}`); got != shown {
		t.Fatalf("seen went back: %d, was %d", got, shown)
	}
	if got := seenAfter(`{"category":"shows","at":99999999999}`); got < shown || got > time.Now().Unix() {
		t.Fatalf("seen ahead of now: %d", got)
	}
	// Something new after that is new again.
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "another problem"}), time.Now().Add(time.Minute))
	if a = getNotifications(t, s); len(a.System) != 2 || a.System[0].At <= a.Seen["system"] {
		t.Fatalf("a newer one: %+v", a)
	}
}

// Seen up to the newest one shown: one that came in since stays new.
func TestNotifSeenUpTo(t *testing.T) {
	s := newTestServer(t)
	now := time.Now()
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "shown"}), now.Add(-2*time.Minute))
	shown := getNotifications(t, s).System[0].At
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "came in since"}), now.Add(-time.Minute))
	if w := do(s, "POST", "/api/notifications/seen", local, fmt.Sprintf(`{"category":"system","at":%d}`, shown), nil); w.Code != http.StatusOK {
		t.Fatalf("seen: %d %s", w.Code, w.Body.String())
	}
	a := getNotifications(t, s)
	if a.Seen["system"] != shown || len(a.System) != 2 || a.System[0].At <= a.Seen["system"] || a.System[1].At > a.Seen["system"] {
		t.Fatalf("seen up to %d: %+v", shown, a)
	}
}

// The events come from the app's own hub: what's published there is noted
// without anything asking.
func TestNotifFromHub(t *testing.T) {
	s := newTestServer(t)
	s.app.Hub.Publish(events.Toast, events.ToastPayload{Level: "success", Message: "Auto downloader: Show S01E01 — Show.S01E01.1080p"})
	s.app.Hub.Error("Library folder /x looks empty")
	for range 100 {
		if a := getNotifications(t, s); len(a.System) == 2 {
			if a.System[1].Title != "Auto downloader" || a.System[0].Title != "Error" {
				t.Fatalf("from the hub: %+v", a.System)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the hub's events weren't noted")
}

// A device on the LAN reads the lists, marks them seen and clears the
// System one, as it gets the same events and changes the list.
func TestNotifFromLAN(t *testing.T) {
	s := newTestServer(t)
	cfg := s.app.Settings.Get()
	cfg.Server.AllowLAN, cfg.Server.Password = true, ""
	if _, err := s.app.Settings.Save(cfg); err != nil {
		t.Fatal(err)
	}
	s.systemEvent(event(events.Toast, events.ToastPayload{Level: "error", Message: "a problem"}), time.Now().Add(-time.Minute))
	var a notifAnswer
	decodeBody(t, do(s, "GET", "/api/notifications", lan, "", nil), &a)
	if len(a.System) != 1 || a.System[0].Text != "a problem" {
		t.Fatalf("read from the LAN: %+v", a)
	}
	if w := do(s, "POST", "/api/notifications/seen", lan, `{"category":"system"}`, nil); w.Code != http.StatusOK {
		t.Fatalf("seen from the LAN: %d %s", w.Code, w.Body.String())
	}
	if a = getNotifications(t, s); a.Seen["system"] < a.System[0].At {
		t.Fatalf("seen on this computer too: %+v", a)
	}
	if w := do(s, "DELETE", "/api/notifications/system", lan, "", nil); w.Code != http.StatusOK {
		t.Fatalf("clear from the LAN: %d %s", w.Code, w.Body.String())
	}
	if a = getNotifications(t, s); len(a.System) != 0 {
		t.Fatalf("after Clear: %+v", a.System)
	}
}
