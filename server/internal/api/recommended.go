package api

import (
	"net/http"
	"sort"

	"github.com/v0-0x/kumobox-movies/server/internal/catalog"
)

// "Because you watched X" on Discover: TMDB's recommendations for a movie
// or show of the list, without what's on the list already.
type recommendedRow struct {
	Because *catalog.Media   `json:"because"`
	Items   []*catalog.Media `json:"items"`
	// Next is where to start the time after (?n=), so another title of the
	// list is recommended from each time Discover opens.
	Next int `json:"next"`
}

// recommendSeeds are the titles to recommend from, the first to try first:
// what was finished or is being watched, the last touched first.
func recommendSeeds(entries []*catalog.ListEntry) []*catalog.ListEntry {
	var out []*catalog.ListEntry
	for _, e := range entries {
		if e.Media != nil && (e.Status == "COMPLETED" || e.Status == "CURRENT" || e.Status == "REPEATING") {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

// recommendedFor is what a title's recommendations leave once what's on
// the list (onList) is taken out, and adult ones unless they're shown.
func recommendedFor(m *catalog.Media, onList map[int]bool, adult bool) []*catalog.Media {
	out := []*catalog.Media{}
	if m == nil || m.Recommendations == nil {
		return out
	}
	seen := map[int]bool{}
	for _, n := range m.Recommendations.Nodes {
		r := n.MediaRecommendation
		if r == nil || onList[r.ID] || seen[r.ID] || (r.IsAdult && !adult) {
			continue
		}
		seen[r.ID] = true
		out = append(out, r)
	}
	return out
}

// One row: from the n-th of the titles watched (?n=, going round them; the
// last touched is the first), or the first after it that has enough to
// recommend; a few are tried (each is one lookup, kept like the title's page).
func (s *Server) recommended(r *http.Request) (any, error) {
	rows := []recommendedRow{}
	c, err := s.app.Platform.Collection(r.Context(), "", false)
	if err != nil || c == nil {
		return rows, nil
	}
	entries := c.Entries()
	onList := map[int]bool{}
	for _, e := range entries {
		onList[e.MediaID] = true
	}
	adult := s.app.Settings.Get().UI.ShowAdult
	seeds := recommendSeeds(entries)
	if len(seeds) == 0 {
		return rows, nil
	}
	start := queryInt(r, "n")
	if start < 0 {
		start = 0
	}
	for try := 0; try < 4 && try < len(seeds); try++ {
		at := (start + try) % len(seeds)
		e := seeds[at]
		m, err := s.app.Platform.Media(r.Context(), e.MediaID, false)
		if err != nil {
			continue
		}
		if items := recommendedFor(m, onList, adult); len(items) >= 4 {
			rows = append(rows, recommendedRow{Because: e.Media, Items: items, Next: (at + 1) % len(seeds)})
			break
		}
	}
	return rows, nil
}
