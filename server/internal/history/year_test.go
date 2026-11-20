package history

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/db"
)

func TestYear(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "moviko.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	s := NewStore(d)
	// Five hours behind UTC: the year, its months and its days turn at
	// 05:00 UTC, not at midnight.
	loc := time.FixedZone("UTC-5", -5*3600)
	put := func(media, ep int, pos, dur float64, at time.Time) {
		t.Helper()
		if _, err := d.Write(`INSERT INTO watch_history(media_id, episode, position, duration, source, updated_at, seq) VALUES(?, ?, ?, ?, 'local', ?, 0)`, media, ep, pos, dur, at.Unix()); err != nil {
			t.Fatal(err)
		}
	}
	// Shows, but the movie watched on July 5.
	const show = showBase
	at := func(y int, m time.Month, day, h, min int) time.Time { return time.Date(y, m, day, h, min, 0, 0, loc) }

	// The year before, by an hour here (already 2026 in UTC), and two
	// years before.
	put(show+9, 12, 1440, 1440, time.Date(2026, 1, 1, 4, 0, 0, 0, time.UTC))
	put(show+8, 1, 1440, 1440, at(2024, 6, 1, 12, 0))
	// The year after, by a second here.
	put(show+9, 13, 1440, 1440, time.Date(2027, 1, 1, 5, 0, 0, 0, time.UTC))

	// The first minutes of the year: started, not finished.
	put(show+1, 1, 300, 1440, at(2026, 1, 1, 0, 5))
	// The end of January and the start of February, two minutes apart.
	put(show+1, 2, 1440, 1440, at(2026, 1, 31, 23, 59))
	put(show+1, 3, 1440, 1440, at(2026, 2, 1, 0, 1))
	// A binge on March 14, to ten to midnight; the next episode is the
	// next day's.
	put(show+2, 1, 1440, 1440, at(2026, 3, 14, 20, 0))
	put(show+2, 2, 1440, 1440, at(2026, 3, 14, 20, 30))
	put(show+2, 3, 1300, 1440, at(2026, 3, 14, 21, 0)) // past 85%: finished
	put(show+3, 1, 600, 1440, at(2026, 3, 14, 23, 50)) // 10 minutes of another
	put(show+2, 4, 1440, 1440, at(2026, 3, 15, 0, 10))
	// A quieter day in July.
	put(show+4, 1, 1440, 1440, at(2026, 7, 4, 10, 0))
	put(show+4, 2, 1440, 1440, at(2026, 7, 4, 11, 0))
	// A movie the day after: two hours.
	put(603, 1, 7000, 7200, at(2026, 7, 5, 21, 0))
	// The last second of the year here (2027 in UTC): finished. Then one
	// only started, at the same second: not the last show.
	put(show+5, 7, 1440, 1440, time.Date(2027, 1, 1, 4, 59, 59, 0, time.UTC))
	put(show+6, 1, 60, 1440, time.Date(2027, 1, 1, 4, 59, 59, 0, time.UTC))

	y, err := s.Year(2026, 0.85, loc)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(y.Years, []int{2024, 2025, 2026, 2027}) {
		t.Errorf("years: %v", y.Years)
	}
	// 9 episodes finished (24 min each), 5 + 10 + 1 minutes of those started,
	// and the movie.
	if y.Movies != 1 || y.Episodes != 9 || y.Minutes != 9*24+16+120 || y.Days != 8 {
		t.Errorf("totals: %d movies, %d episodes, %d minutes, %d days", y.Movies, y.Episodes, y.Minutes, y.Days)
	}
	months := map[string]Month{
		"2026-01": {"2026-01", 0, 1, 29},
		"2026-02": {"2026-02", 0, 1, 24},
		"2026-03": {"2026-03", 0, 4, 106},
		"2026-07": {"2026-07", 1, 2, 168},
		"2026-12": {"2026-12", 0, 1, 25},
	}
	if len(y.Months) != 12 {
		t.Fatalf("months: %+v", y.Months)
	}
	for i, m := range y.Months {
		want, ok := months[m.Month]
		if !ok {
			want = Month{Month: time.Date(2026, time.Month(i+1), 1, 0, 0, 0, 0, loc).Format("2006-01")}
		}
		if m != want {
			t.Errorf("month %d: %+v, want %+v", i+1, m, want)
		}
	}
	// The movie's day (two hours) is longer than the binge of March 14 (82 minutes).
	if y.Busiest == nil || *y.Busiest != (Day{Date: "2026-07-05", Movies: 1, Minutes: 120, MediaID: 603}) {
		t.Errorf("busiest: %+v", y.Busiest)
	}
	// The first finished (not the one only started on January 1), and the
	// last finished.
	if y.First == nil || *y.First != (Watched{MediaID: show + 1, Episode: 2, At: at(2026, 1, 31, 23, 59).Unix()}) {
		t.Errorf("first: %+v", y.First)
	}
	if y.Last == nil || y.Last.MediaID != show+5 || y.Last.Episode != 7 {
		t.Errorf("last: %+v", y.Last)
	}
	shows := []Show{{603, 1, 0, 120}, {show + 2, 0, 4, 96}, {show + 1, 0, 2, 53}, {show + 4, 0, 2, 48}, {show + 5, 0, 1, 24}, {show + 3, 0, 0, 10}, {show + 6, 0, 0, 1}}
	if !reflect.DeepEqual(y.Shows, shows) {
		t.Errorf("shows: %+v", y.Shows)
	}

	// The year before has the one episode UTC puts in 2026.
	y, err = s.Year(2025, 0.85, loc)
	if err != nil {
		t.Fatal(err)
	}
	if y.Episodes != 1 || y.Months[11].Episodes != 1 || y.Busiest == nil || y.Busiest.Date != "2025-12-31" || y.First.MediaID != show+9 || y.First.Episode != 12 {
		t.Errorf("2025: %+v, busiest %+v, first %+v", y, y.Busiest, y.First)
	}
}

// Two days as busy as each other: the earlier one. And a year with only
// episodes started: the first and the last of those.
func TestYearTies(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "moviko.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	s := NewStore(d)
	loc := time.UTC
	const show = showBase
	put := func(media, ep int, pos, dur float64, at time.Time) {
		t.Helper()
		if _, err := d.Write(`INSERT INTO watch_history(media_id, episode, position, duration, source, updated_at, seq) VALUES(?, ?, ?, ?, 'local', ?, 0)`, media, ep, pos, dur, at.Unix()); err != nil {
			t.Fatal(err)
		}
	}
	put(show+7, 1, 600, 1440, time.Date(2026, 9, 9, 12, 0, 0, 0, loc))
	put(show+3, 1, 600, 1440, time.Date(2026, 5, 2, 12, 0, 0, 0, loc))
	put(show+5, 1, 600, 1440, time.Date(2026, 5, 2, 13, 0, 0, 0, loc))
	put(show+4, 1, 1200, 1440, time.Date(2026, 6, 1, 12, 0, 0, 0, loc))
	y, err := s.Year(2026, 0.85, loc)
	if err != nil {
		t.Fatal(err)
	}
	// May 2 and June 1 are 20 minutes each; on May 2, two shows as much
	// as each other: the lower id.
	if y.Busiest == nil || *y.Busiest != (Day{Date: "2026-05-02", Episodes: 0, Minutes: 20, MediaID: show + 3}) {
		t.Errorf("busiest: %+v", y.Busiest)
	}
	if y.Episodes != 0 || y.First == nil || y.First.MediaID != show+3 || y.Last == nil || y.Last.MediaID != show+7 {
		t.Errorf("first %+v, last %+v", y.First, y.Last)
	}
}

// Nothing watched: twelve empty months, and lists (not null) for the page.
func TestYearEmpty(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "moviko.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	y, err := NewStore(d).Year(2026, 0.85, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	if len(y.Months) != 12 || y.Months[0].Month != "2026-01" || y.Months[11].Month != "2026-12" || y.Busiest != nil || y.First != nil || y.Last != nil {
		t.Errorf("empty year: %+v", y)
	}
	b, _ := json.Marshal(y)
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	if _, ok := raw["years"].([]any); !ok {
		t.Errorf("years isn't a list: %s", b)
	}
	if _, ok := raw["shows"].([]any); !ok {
		t.Errorf("shows isn't a list: %s", b)
	}
}
