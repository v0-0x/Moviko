package livetv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// CheckStatus is a check of the channels, under way or the last one.
type CheckStatus struct {
	Running bool `json:"running"`
	Done    int  `json:"done"`
	Total   int  `json:"total"`
	Working int  `json:"working"`
}

func (s *Service) healthFile() string { return filepath.Join(s.dir, "health.json") }

// healthMap is what the checks found, by channel key. The map is s's own:
// read it with s.mu held, or before any check runs.
func (s *Service) healthMap() map[string]Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.health == nil {
		s.health = map[string]Health{}
		if b, err := os.ReadFile(s.healthFile()); err == nil {
			_ = json.Unmarshal(b, &s.health)
		}
	}
	return s.health
}

// saveHealth keeps results, and forgets those too old to count.
func (s *Service) saveHealth(results map[string]Health) {
	s.healthMap()
	s.mu.Lock()
	old := s.Now().Add(-2 * healthFor).Unix()
	for k, h := range results {
		s.health[k] = h
	}
	for k, h := range s.health {
		if h.At < old {
			delete(s.health, k)
		}
	}
	b, err := json.Marshal(s.health)
	s.mu.Unlock()
	if err == nil && os.MkdirAll(s.dir, 0o700) == nil {
		tmp := s.healthFile() + ".tmp"
		if os.WriteFile(tmp, b, 0o600) == nil {
			_ = os.Rename(tmp, s.healthFile())
		}
	}
}

// Report notes how a channel played: one that didn't (and whose backups
// didn't either) counts as not working, as a check would find; one that
// did, as working again.
func (s *Service) Report(key string, ok bool, why string) {
	if key == "" || len(key) > 200 {
		return
	}
	if len(why) > 120 {
		why = strings.ToValidUTF8(why[:120], "")
	}
	if ok {
		s.mu.Lock()
		h, had := s.health[key]
		s.mu.Unlock()
		if had && h.OK {
			return
		}
		why = ""
	} else if why == "" {
		why = "didn't play"
	}
	s.saveHealth(map[string]Health{key: {OK: ok, At: s.Now().Unix(), Why: why}})
	s.changed("health", nil)
}

// Check is the check under way, or the last one.
func (s *Service) Check() CheckStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.check == nil {
		return CheckStatus{}
	}
	return *s.check
}

// StopCheck stops the check under way (what it found is kept).
func (s *Service) StopCheck() {
	s.mu.Lock()
	stop := s.stop
	s.mu.Unlock()
	if stop != nil {
		stop()
	}
}

// CheckAll checks every channel of the sources that are on now, whenever
// they were checked last.
func (s *Service) CheckAll(ctx context.Context) bool {
	var list []Channel
	for _, c := range s.all(ctx) {
		if webPage(c.URL) == "" {
			list = append(list, c)
		}
	}
	return s.start(list, len(list))
}

// StartCheck checks channels in the background (the first few thousand),
// unless a check is under way. It reports whether it started one.
func (s *Service) StartCheck(list []Channel) bool { return s.start(list, maxCheck) }

func (s *Service) start(list []Channel, limit int) bool {
	if len(list) > limit {
		list = list[:limit]
	}
	if len(list) == 0 {
		return false
	}
	s.mu.Lock()
	if s.check != nil && s.check.Running {
		s.mu.Unlock()
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	st := &CheckStatus{Running: true, Total: len(list)}
	s.check, s.stop = st, cancel
	s.mu.Unlock()
	go func() {
		defer cancel()
		s.run(ctx, list, st)
	}()
	return true
}

// run opens every channel's stream (16 at a time) to see which answer:
// public playlists always carry some dead links.
func (s *Service) run(ctx context.Context, list []Channel, st *CheckStatus) {
	local := map[string]bool{}
	for _, src := range s.Sources() {
		local[src.ID] = src.Local
	}
	results := map[string]Health{}
	var rmu sync.Mutex
	var done, working atomic.Int32
	gate := make(chan struct{}, 16)
	var wg sync.WaitGroup
	lastTold := time.Now()
	tell := func(force bool) {
		s.mu.Lock()
		st.Done, st.Working = int(done.Load()), int(working.Load())
		told := time.Since(lastTold) > time.Second
		if told || force {
			lastTold = time.Now()
		}
		cp := *st
		s.mu.Unlock()
		if told || force {
			s.changed("check", cp)
		}
	}
	tell(true)
	for _, c := range list {
		if ctx.Err() != nil {
			break
		}
		gate <- struct{}{}
		wg.Add(1)
		go func(c Channel) {
			defer func() { <-gate; wg.Done() }()
			client := s.HTTP
			if local[c.Source] {
				client = s.Local
			}
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			why := probe(pctx, client, c.URL, c.Headers, 0)
			cancel()
			if ctx.Err() != nil {
				return // stopped: not a finding
			}
			rmu.Lock()
			results[c.Key] = Health{OK: why == "", At: s.Now().Unix(), Why: why}
			rmu.Unlock()
			if why == "" {
				working.Add(1)
			}
			done.Add(1)
			tell(false)
		}(c)
	}
	wg.Wait()
	// Also when stopped half-way: what was checked is kept. But when none
	// of several answered, it's this computer's connection that's down,
	// not every channel at once: nothing is noted, and they stay in sight.
	rmu.Lock()
	if working.Load() > 0 || len(results) < 5 {
		s.saveHealth(results)
	}
	rmu.Unlock()
	s.mu.Lock()
	st.Running = false
	s.mu.Unlock()
	tell(true)
	s.changed("health", nil)
}

// probe is "" when the stream answers like a stream; otherwise why not, in
// a few words. An HLS list is followed into its first quality, since a list
// often still answers when the video behind it is gone.
func probe(ctx context.Context, client *http.Client, link string, headers map[string]string, depth int) string {
	if util.Offline() {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return "a bad address"
	}
	req.Header.Set("User-Agent", util.UserAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return reason(err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == 401 || resp.StatusCode == 403 || resp.StatusCode == 451:
		return fmt.Sprintf("refused (HTTP %d): blocked here or needs a login", resp.StatusCode)
	case resp.StatusCode == 404 || resp.StatusCode == 410:
		return fmt.Sprintf("gone (HTTP %d)", resp.StatusCode)
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	buf := make([]byte, 8<<10)
	n, _ := io.ReadFull(resp.Body, buf)
	if n == 0 {
		return "an empty answer"
	}
	text := string(buf[:n])
	lower := strings.ToLower(text)
	head := strings.TrimSpace(lower)
	playlist := strings.Contains(lower[:min(len(lower), 2048)], "#extm3u")
	if !playlist && (strings.HasPrefix(head, "<!doctype html") || strings.HasPrefix(head, "<html")) {
		return "a web page, not a stream"
	}
	if !playlist || depth > 0 {
		return ""
	}
	// A master list: its first quality (or first part), one level down.
	next := ""
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") {
			next = line
			break
		}
	}
	if next == "" {
		return "an empty list"
	}
	ref, err := url.Parse(next)
	if err != nil {
		return ""
	}
	nu := resp.Request.URL.ResolveReference(ref)
	if nu.Scheme != "http" && nu.Scheme != "https" {
		return ""
	}
	if !strings.HasSuffix(strings.ToLower(nu.Path), ".m3u8") && !strings.Contains(lower, "#ext-x-stream-inf") {
		return ""
	}
	return probe(ctx, client, nu.String(), headers, depth+1)
}

func reason(err error) string {
	var dns *net.DNSError
	var op *net.OpError
	switch {
	case errors.Is(err, util.ErrPrivateAddress):
		return "an address on a private network"
	case errors.As(err, &dns):
		return "its server wasn't found"
	case errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err):
		return "no answer"
	case strings.Contains(err.Error(), "certificate") || strings.Contains(err.Error(), "tls:"):
		return "a security certificate problem"
	case errors.As(err, &op):
		return "its server refused the connection"
	}
	return "its server can't be reached"
}
