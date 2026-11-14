package playlist

import (
	"errors"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/db"
)

func newStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "moviko.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	s := New(d)
	now := time.Unix(1_800_000_000, 0)
	s.now = func() time.Time { return now }
	return s, &now
}

func ep(n int) Item {
	return Item{MediaID: 21, Episode: n, Title: "One Piece", Play: Play{Kind: "local", Path: "/lib/One Piece - " + strconv.Itoa(n) + ".mkv"}}
}

func episodes(p Playlist) []int {
	out := make([]int, len(p.Items))
	for i, it := range p.Items {
		out[i] = it.Episode
	}
	return out
}

func same(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestCreateAddRenameDelete(t *testing.T) {
	s, _ := newStore(t)
	changes := 0
	s.OnChange = func() { changes++ }
	p, err := s.Create("  Binge  night ", []Item{ep(1)})
	if err != nil || p.ID == "" || p.Name != "Binge night" || len(p.Items) != 1 || p.At <= 0 {
		t.Fatalf("create: %+v %v", p, err)
	}
	if _, err := s.Create(" ", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty name: %v", err)
	}
	if _, err := s.Create("x", []Item{{MediaID: 1, Episode: 1, Play: Play{Kind: "local"}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("item without a path: %v", err)
	}
	if _, err := s.Create("x", []Item{{MediaID: 1, Episode: 1, Play: Play{Kind: "mpv", Path: "/a"}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown kind: %v", err)
	}
	stream := Item{MediaID: 5, Episode: 2, Title: "Severance", Play: Play{Kind: "stream", Provider: "archive"}}
	p, err = s.Add(p.ID, []Item{ep(2), stream})
	if err != nil || !same(episodes(p), []int{1, 2, 2}) || p.Items[2].Play.Provider != "archive" {
		t.Fatalf("add: %+v %v", p, err)
	}
	if _, err := s.Add("nope", []Item{ep(3)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("add to none: %v", err)
	}
	p, err = s.Rename(p.ID, "Weekend")
	if err != nil || p.Name != "Weekend" {
		t.Fatalf("rename: %+v %v", p, err)
	}
	b, _ := s.Create("another", nil)
	list, err := s.List()
	if err != nil || len(list) != 2 || list[0].ID != b.ID || list[1].Name != "Weekend" {
		t.Fatalf("list (by name): %+v %v", list, err)
	}
	if b.Items == nil {
		t.Fatal("items null, not empty")
	}
	if err := s.Delete(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted: %v", err)
	}
	if err := s.Delete(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted twice: %v", err)
	}
	if changes != 5 {
		t.Fatalf("%d changes told, want 5", changes)
	}
}

func TestMoveAndRemove(t *testing.T) {
	s, now := newStore(t)
	p, _ := s.Create("p", []Item{ep(1), ep(2), ep(3), ep(4)})
	at := p.At
	steps := []struct {
		index, to int
		want      []int
	}{
		{0, 1, []int{2, 1, 3, 4}}, // down
		{3, 2, []int{2, 1, 4, 3}}, // up
		{0, 3, []int{1, 4, 3, 2}}, // to the end
		{3, 0, []int{2, 1, 4, 3}}, // to the start
		{2, 2, []int{2, 1, 4, 3}}, // nowhere
	}
	for _, st := range steps {
		got, err := s.Move(p.ID, st.index, st.to)
		if err != nil || !same(episodes(got), st.want) {
			t.Fatalf("move %d to %d: %v %v, want %v", st.index, st.to, episodes(got), err, st.want)
		}
		// Each change newer than the one before, also within a second.
		if got.At <= at {
			t.Fatalf("at %d after %d", got.At, at)
		}
		at = got.At
	}
	for _, bad := range [][2]int{{-1, 0}, {0, 4}, {4, 0}} {
		if _, err := s.Move(p.ID, bad[0], bad[1]); !errors.Is(err, ErrInvalid) {
			t.Fatalf("move %v: %v", bad, err)
		}
	}
	got, err := s.Remove(p.ID, 1)
	if err != nil || !same(episodes(got), []int{2, 4, 3}) {
		t.Fatalf("remove: %v %v", episodes(got), err)
	}
	got, err = s.Remove(p.ID, 2)
	if err != nil || !same(episodes(got), []int{2, 4}) {
		t.Fatalf("remove last: %v %v", episodes(got), err)
	}
	if _, err := s.Remove(p.ID, 2); !errors.Is(err, ErrInvalid) {
		t.Fatalf("remove past the end: %v", err)
	}
	*now = now.Add(time.Hour)
	got, _ = s.Remove(p.ID, 0)
	if got.At != now.Unix()*1000 {
		t.Fatalf("at %d, want now", got.At)
	}
}
