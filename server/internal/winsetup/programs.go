package winsetup

import (
	"bufio"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/v0-0x/kumobox-movies/server/internal/util"
)

// setup downloads the programs into dir. What it asks the computer and
// where it downloads from are fields, for the tests.
type setup struct {
	// dir is Moviko's programs folder.
	dir    string
	client *http.Client
	// github is where the releases are.
	github string
	// have reports whether a program is there already: in dir, or
	// anywhere on the PATH (as the rest of Moviko looks for it).
	have func(name string) bool
	// vcRuntime reports whether Microsoft's Visual C++ runtime is
	// installed (mpv's build needs it).
	vcRuntime func() bool
	// pause is the wait before a download is tried again (times the try),
	// and stall how long a download may send nothing.
	pause, stall time.Duration
}

func newSetup(dir string) *setup {
	s := &setup{
		dir:       dir,
		client:    newClient(),
		github:    "https://github.com",
		vcRuntime: vcRuntime,
		pause:     3 * time.Second,
		stall:     time.Minute,
	}
	s.have = func(name string) bool {
		if isFile(filepath.Join(dir, name+".exe")) {
			return true
		}
		_, ok := util.LookPath(name)
		return ok
	}
	return s
}

// program is one of the programs: missing reports whether it has to be
// downloaded, which get does.
type program struct {
	name    string
	missing func() bool
	get     func(ctx context.Context, t *task) error
}

// programs lists them in the order they're downloaded: what most of Moviko
// needs first.
func (s *setup) programs() []program {
	lacks := func(names ...string) func() bool {
		return func() bool {
			for _, n := range names {
				if !s.have(n) {
					return true
				}
			}
			return false
		}
	}
	return []program{
		{"ffmpeg", lacks("ffmpeg", "ffprobe"), s.ffmpeg},
		{"yt-dlp", lacks("yt-dlp"), s.ytDlp},
		{"mpv", lacks("mpv"), s.mpv},
	}
}

// task is the program being downloaded, for what the pages show of it.
type task struct {
	change func(func(*Item))
}

func (t *task) state(state string) { t.change(func(it *Item) { it.State = state }) }

func (t *task) bytes(done, total int64) {
	t.change(func(it *Item) { it.State, it.Done, it.Total = Downloading, done, total })
}

// listed checks a download against its project's list of checksums; with
// no list (see setup.sums), it isn't checked.
func (t *task) listed(sums, name string) func(path string) error {
	if sums == "" {
		return nil
	}
	return t.sha256(sumIn(sums, name))
}

// sha256 checks a download against the checksum its project publishes.
func (t *task) sha256(want string) func(path string) error {
	return func(path string) error {
		got, err := sha256File(path)
		if err != nil {
			return err
		}
		if want == "" {
			return errNoSum
		}
		if !strings.EqualFold(got, want) {
			return errChecksum
		}
		t.change(func(it *Item) { it.Verified = true })
		return nil
	}
}

// run downloads every program that is missing and returns how each went;
// report gets the same whenever something changes. One that fails doesn't
// stop the others.
func (s *setup) run(ctx context.Context, report func([]Item)) []Item {
	progs := s.programs()
	var mu sync.Mutex
	items := make([]Item, len(progs))
	for i, p := range progs {
		items[i] = Item{Name: p.name, State: Waiting}
	}
	snapshot := func() []Item { return append([]Item{}, items...) }
	change := func(i int, f func(*Item)) {
		mu.Lock()
		f(&items[i])
		now := snapshot()
		mu.Unlock()
		if report != nil {
			report(now)
		}
	}
	err := os.MkdirAll(s.dir, 0o755)
	if err == nil {
		s.sweep()
	}
	for i, p := range progs {
		if !p.missing() {
			change(i, func(it *Item) { it.State = Skipped })
			continue
		}
		change(i, func(it *Item) { it.State = Downloading })
		e := err
		if e == nil {
			e = p.get(ctx, &task{change: func(f func(*Item)) { change(i, f) }})
		}
		change(i, func(it *Item) {
			if e != nil {
				it.State, it.Error = Failed, plain(e)
			} else {
				it.State = Done
			}
		})
	}
	mu.Lock()
	defer mu.Unlock()
	return snapshot()
}

// sweep removes what a setup that was cut off (Moviko closed, the computer
// turned off) left in the folder: downloads that weren't complete.
func (s *setup) sweep() {
	entries, _ := os.ReadDir(s.dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") || strings.HasPrefix(e.Name(), "setup-") {
			_ = os.RemoveAll(filepath.Join(s.dir, e.Name()))
		}
	}
}

// zip downloads a zip and puts the files called names from it in Moviko's
// folder.
func (s *setup) zip(ctx context.Context, t *task, url string, verify func(string) error, names ...string) error {
	tmp, err := os.CreateTemp(s.dir, "setup-*.zip")
	if err != nil {
		return err
	}
	_ = tmp.Close()
	defer os.Remove(tmp.Name())
	if err := s.download(ctx, t, url, tmp.Name(), verify); err != nil {
		return err
	}
	t.state(Unpacking)
	return unzip(tmp.Name(), s.dir, names)
}

// ffmpeg and ffprobe: BtbN's builds, and Gyan's (the ones winget installs)
// when those can't be had.
func (s *setup) ffmpeg(ctx context.Context, t *task) error {
	var names []string
	for _, n := range []string{"ffmpeg", "ffprobe"} {
		if !s.have(n) {
			names = append(names, n+".exe")
		}
	}
	err := s.ffmpegBtbN(ctx, t, names)
	// Its release is replaced every day: a zip that doesn't match its
	// checksum may be the next day's.
	if errors.Is(err, errChecksum) {
		err = s.ffmpegBtbN(ctx, t, names)
	}
	if err == nil || ctx.Err() != nil {
		return err
	}
	if s.ffmpegGyan(ctx, t, names) == nil {
		return nil
	}
	return err
}

func (s *setup) ffmpegBtbN(ctx context.Context, t *task, names []string) error {
	base := s.github + "/BtbN/FFmpeg-Builds/releases/latest/download/"
	sums, err := s.sums(ctx, base+"checksums.sha256")
	if err != nil {
		return err
	}
	name := btbnBuild(sums)
	if name == "" {
		return errors.New("BtbN's release has no ffmpeg for Windows")
	}
	return s.zip(ctx, t, base+name, t.listed(sums, name), names...)
}

var btbnRelease = regexp.MustCompile(`^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-[\d.]+\.zip$`)

// btbnBuild picks the build to take from BtbN's checksums, which list every
// file of the release: the newest ffmpeg release's (ffmpeg-n8.0-latest-
// win64-gpl-8.0.zip: one program file each, nothing else needed), or else
// the build of ffmpeg's current code.
func btbnBuild(sums string) string {
	best, bestMajor, bestMinor := "", -1, -1
	master := ""
	sc := bufio.NewScanner(strings.NewReader(sums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) != 2 {
			continue
		}
		name := strings.TrimPrefix(f[1], "*")
		if name == "ffmpeg-master-latest-win64-gpl.zip" {
			master = name
		}
		m := btbnRelease.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		major, _ := strconv.Atoi(m[1])
		minor, _ := strconv.Atoi(m[2])
		if major > bestMajor || major == bestMajor && minor > bestMinor {
			best, bestMajor, bestMinor = name, major, minor
		}
	}
	switch {
	case best != "":
		return best
	case sums == "":
		// No list to pick from: this one's name never changes.
		return "ffmpeg-master-latest-win64-gpl.zip"
	}
	return master
}

// ffmpegGyan: Gyan publishes no checksum next to the zip.
func (s *setup) ffmpegGyan(ctx context.Context, t *task, names []string) error {
	base, tag, err := s.latest(ctx, "GyanD/codexffmpeg")
	if err != nil {
		return err
	}
	return s.zip(ctx, t, base+"ffmpeg-"+tag+"-essentials_build.zip", nil, names...)
}

func (s *setup) ytDlp(ctx context.Context, t *task) error {
	base := s.github + "/yt-dlp/yt-dlp/releases/latest/download/"
	sums, err := s.sums(ctx, base+"SHA2-256SUMS")
	if err != nil {
		return err
	}
	return s.download(ctx, t, base+"yt-dlp.exe", filepath.Join(s.dir, "yt-dlp.exe"), t.listed(sums, "yt-dlp.exe"))
}

// mpv, the optional external player: the build mpv releases itself, a zip
// with no checksum next to it. Its other Windows builds are 7z archives,
// which Go can't open.
func (s *setup) mpv(ctx context.Context, t *task) error {
	// Without the runtime Windows would find mpv and fail to start it.
	if !s.vcRuntime() {
		return errors.New("mpv needs Microsoft's Visual C++ runtime, which this computer lacks: install that first (aka.ms/vs/17/release/vc_redist.x64.exe), or get mpv from mpv.io")
	}
	base, tag, err := s.latest(ctx, "mpv-player/mpv")
	if err != nil {
		return err
	}
	// vulkan-1.dll comes with it for computers whose graphics driver
	// brings none.
	return s.zip(ctx, t, base+"mpv-"+tag+"-x86_64-pc-windows-msvc.zip", nil, "mpv.exe", "?vulkan-1.dll")
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}
