package winsetup

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestRealDownloads runs the setup against the real hosts, into an empty
// folder, as on a computer with none of the programs: only with
// MOVIKO_REALNET=1 (the Windows build sets it, windows.yml). It shows when a
// project moved or renamed its downloads, or stopped publishing checksums.
// On Windows it then starts every program; elsewhere it checks that what
// came are Windows programs.
func TestRealDownloads(t *testing.T) {
	if os.Getenv("MOVIKO_REALNET") != "1" {
		t.Skip("MOVIKO_REALNET=1 downloads Moviko's programs from their real hosts")
	}
	windows := runtime.GOOS == "windows"
	dir := filepath.Join(t.TempDir(), "bin")
	s := newSetup(dir)
	s.have = func(name string) bool { return isFile(filepath.Join(dir, name+".exe")) }

	ctx, cancel := context.WithTimeout(context.Background(), 14*time.Minute)
	defer cancel()
	states := map[string]string{}
	items := s.run(ctx, func(items []Item) {
		for _, it := range items {
			if states[it.Name] != it.State {
				states[it.Name] = it.State
				t.Logf("%s: %s %s", it.Name, it.State, it.Error)
			}
		}
	})
	// As GitHub shows it on the build's page.
	fail := func(format string, args ...any) {
		t.Helper()
		msg := fmt.Sprintf(format, args...)
		if os.Getenv("GITHUB_ACTIONS") == "true" {
			fmt.Println("::error title=Moviko's programs setup::" + msg)
		}
		t.Error(msg)
	}
	checked := map[string]bool{"ffmpeg": true, "yt-dlp": true}
	for _, it := range items {
		t.Logf("%s: %s, %d bytes, checksum checked: %v", it.Name, it.State, it.Done, it.Verified)
		if it.State != Done {
			fail("%s wasn't installed: %s", it.Name, it.Error)
		} else if checked[it.Name] && !it.Verified {
			fail("%s was downloaded without its checksum being checked: its project's list of checksums is gone", it.Name)
		}
	}
	if t.Failed() {
		return
	}

	for name, min := range map[string]int64{"ffmpeg.exe": 20 << 20, "ffprobe.exe": 20 << 20, "yt-dlp.exe": 5 << 20, "mpv.exe": 10 << 20} {
		if err := windowsProgram(filepath.Join(dir, name), min); err != nil {
			fail("%s: %v", name, err)
		}
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") || strings.HasPrefix(e.Name(), "setup-") {
			fail("%s was left in the folder", e.Name())
		}
	}
	if !windows {
		t.Log("not on Windows: the programs were downloaded and checked, not started")
		return
	}

	// Started as Moviko starts them: its folder first on the PATH
	// (util.SetToolsDir).
	env := append(os.Environ(), "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	run := func(want string, name string, args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, name, args...)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0])
		what := filepath.Base(name) + " " + strings.Join(args, " ")
		if err != nil {
			fail("%s doesn't run: %v: %s", what, err, strings.TrimSpace(string(out)))
			return
		}
		if ok, _ := regexp.MatchString(want, string(out)); !ok {
			fail("%s says %q, want %s", what, line, want)
			return
		}
		t.Logf("%s: %s", what, line)
	}
	run(`ffmpeg version`, filepath.Join(dir, "ffmpeg.exe"), "-version")
	run(`ffprobe version`, filepath.Join(dir, "ffprobe.exe"), "-version")
	run(`\d{4}\.\d+\.\d+`, filepath.Join(dir, "yt-dlp.exe"), "--version")
	// mpv is a window program: what counts is that it starts and ends well.
	run(``, filepath.Join(dir, "mpv.exe"), "--version")
}

// windowsProgram checks that a file is a Windows program (they start with
// "MZ") of at least min bytes, and not an error page.
func windowsProgram(path string, min int64) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, 2)
	if _, err := f.Read(head); err != nil || string(head) != "MZ" {
		return errors.New("not a Windows program")
	}
	if st, err := f.Stat(); err != nil || st.Size() < min {
		return fmt.Errorf("too small for the program (%d bytes)", st.Size())
	}
	return nil
}
