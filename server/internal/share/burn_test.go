package share

import (
	"net"
	"testing"
	"time"
)

// A shared file's image subtitles are drawn by its host from Moviko 3.0.0
// on; an older host is named, an unknown version (a build from source) and
// mediaserver are taken as able.
func TestBurnsSubtitles(t *testing.T) {
	s := hostWithSharing(t)
	now := time.Now()
	add := func(id, name, version, platform string) {
		s.peers[id] = &peer{id: id, name: name, version: version, platform: platform, shares: true, seen: now, addr: net.ParseIP("192.168.1.40"), port: 43311}
	}
	s.mu.Lock()
	add("aaaaaaaaaaaaaaaa", "Old PC", "2.0.12", "")
	add("bbbbbbbbbbbbbbbb", "New PC", "3.0.0", "")
	add("cccccccccccccccc", "Old TV", "2.0.9", "android")
	add("dddddddddddddddd", "Pi", "1.0.22", PlatformServer)
	add("eeeeeeeeeeeeeeee", "Source", "1.0.0", "")
	s.mu.Unlock()
	for _, tc := range []struct {
		id   string
		want bool
	}{{"aaaaaaaaaaaaaaaa", false}, {"bbbbbbbbbbbbbbbb", true}, {"cccccccccccccccc", false}, {"dddddddddddddddd", true}, {"eeeeeeeeeeeeeeee", true}} {
		ok, name := s.BurnsSubtitles(RemotePath(tc.id, "/a/x.mkv"))
		if ok != tc.want || name == "" {
			t.Errorf("%s: %v %q, want %v", tc.id, ok, name, tc.want)
		}
	}
}
