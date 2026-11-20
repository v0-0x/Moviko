package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Live TV over the API: a source is this computer's to add, a device on
// the network watches; the app never gets a channel's own address.
func TestLiveTV(t *testing.T) {
	var base string
	mux := http.NewServeMux()
	mux.HandleFunc("/tv.m3u", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "#EXTM3U\n#EXTINF:-1 tvg-id=\"One.us\" group-title=\"News\",One\n%s/one.m3u8?token=SECRET\n#EXTINF:-1,A page\nhttps://www.youtube.com/watch?v=abcdefghijk\n", base)
	})
	mux.HandleFunc("/one.m3u8", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "#EXTM3U\n#EXTINF:4,\nseg.ts\n") })
	src := httptest.NewServer(mux)
	defer src.Close()
	base = src.URL

	s := newTestServer(t)
	cfg := s.app.Settings.Get()
	cfg.Server.AllowLAN = true
	if _, err := s.app.Settings.Save(cfg); err != nil {
		t.Fatal(err)
	}
	set := s.app.LiveTV.Settings()
	set.AutoCheck = false
	if _, err := s.app.LiveTV.SaveSettings(set); err != nil {
		t.Fatal(err)
	}
	const here, lan = "127.0.0.1:5000", "192.168.1.20:5000"
	add := `{"kind":"m3u","url":"` + base + `/tv.m3u","name":"Mine"}`
	if w := do(s, "POST", "/api/livetv/sources", lan, add, nil); w.Code != http.StatusForbidden {
		t.Fatalf("a device on the network adds a source: %d %s", w.Code, w.Body)
	}
	if w := do(s, "POST", "/api/livetv/sources", here, `{"kind":"m3u","url":"ftp://x"}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("a bad address: %d %s", w.Code, w.Body)
	}
	w := do(s, "POST", "/api/livetv/sources", here, add, nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"channels":2`) {
		t.Fatalf("add: %d %s", w.Code, w.Body)
	}

	w = do(s, "GET", "/api/livetv/channels", lan, "", nil)
	var list struct {
		Channels []struct {
			Key, Name, Web string
		}
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Channels) != 2 {
		t.Fatalf("channels: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "SECRET") || strings.Contains(w.Body.String(), "one.m3u8") {
		t.Fatalf("the channels carry their addresses: %s", w.Body)
	}
	if list.Channels[1].Web != "YouTube" {
		t.Errorf("the page: %+v", list.Channels[1])
	}

	w = do(s, "POST", "/api/livetv/play", lan, `{"key":"`+list.Channels[0].Key+`"}`, nil)
	var play map[string]any
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &play) != nil {
		t.Fatalf("play: %d %s", w.Code, w.Body)
	}
	hls, _ := play["hls"].(string)
	convert, _ := play["convert"].(string)
	if play["action"] != "play" || !strings.HasPrefix(hls, "/api/proxy?") || !strings.HasPrefix(convert, "/api/local/transcode?path=remote") {
		t.Fatalf("play = %v", play)
	}
	if w = do(s, "POST", "/api/livetv/play", lan, `{"key":"`+list.Channels[1].Key+`"}`, nil); !strings.Contains(w.Body.String(), `"action":"external"`) {
		t.Fatalf("play a page: %d %s", w.Code, w.Body)
	}
	if w = do(s, "POST", "/api/livetv/play", lan, `{"key":"nope"}`, nil); w.Code != http.StatusNotFound {
		t.Fatalf("play a channel that's gone: %d", w.Code)
	}

	// A favourite from the network; the settings and the sources stay this computer's.
	if w = do(s, "POST", "/api/livetv/favourite", lan, `{"key":"`+list.Channels[0].Key+`","on":true}`, nil); w.Code != http.StatusOK {
		t.Fatalf("favourite: %d %s", w.Code, w.Body)
	}
	if w = do(s, "GET", "/api/livetv/channels", here, "", nil); !strings.Contains(w.Body.String(), `"favourite":true`) || !strings.Contains(w.Body.String(), `"recent":["`) {
		t.Fatalf("after a favourite and a play: %s", w.Body)
	}
	if w = do(s, "PUT", "/api/livetv/settings", lan, `{"hideNotWorking":false}`, nil); w.Code != http.StatusForbidden {
		t.Fatalf("settings from the network: %d", w.Code)
	}
	w = do(s, "GET", "/api/livetv", lan, "", nil)
	var info struct {
		Sources []struct{ ID, URL, Pass string }
	}
	if json.Unmarshal(w.Body.Bytes(), &info) != nil || len(info.Sources) != 1 || info.Sources[0].Pass != "" {
		t.Fatalf("info: %s", w.Body)
	}
	if w = do(s, "DELETE", "/api/livetv/sources/"+info.Sources[0].ID, lan, "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("remove from the network: %d", w.Code)
	}
	if w = do(s, "DELETE", "/api/livetv/sources/"+info.Sources[0].ID, here, "", nil); w.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", w.Code, w.Body)
	}
}
