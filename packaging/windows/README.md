# Moviko for Windows

Moviko, the movies and TV shows app, runs on Windows 10 and 11 (64-bit). The
Windows build is released on its own, as GitHub Releases named **Moviko X.Y.Z
for Windows** (tag `windows-vX.Y.Z`). None of it is for Linux: on Arch,
install Moviko from source with [`packaging/arch`](../arch/PKGBUILD) as the
[main README](../../README.md#install-arch-linux) says.

## Install

Open the [releases](https://github.com/v0-0x/kumobox-movies/releases), take the
newest **Moviko X.Y.Z for Windows** and download one of:

| File | What it is |
|---|---|
| `Moviko-Setup-X.Y.Z-windows-x64.exe` | **Installer** (recommended). Installs Moviko for your Windows user, without admin rights, in `%LOCALAPPDATA%\Programs\Moviko` (you can pick another folder). Adds Start menu and desktop shortcuts. Uninstall it from **Settings › Apps**. Moviko then [updates itself](#updates). |
| `Moviko-X.Y.Z-windows-x64-portable.zip` | **Portable** build. Unzip it anywhere and run `Moviko.exe`; nothing gets installed. Your data still goes to the folders [below](#where-moviko-keeps-its-files). To update, download the newer zip. |

The builds aren't code-signed, so SmartScreen may show "Windows protected your
PC": click **More info**, then **Run anyway**.

Movie and show details (posters, seasons, episodes, cast) come from
[TMDB](https://www.themoviedb.org): the first time, Moviko asks for your free
TMDB API key (**Settings › Accounts**). Letterboxd tracking needs only your
Letterboxd username.

## Programs Moviko uses

| Program | For |
|---|---|
| ffmpeg (with ffprobe) | The in-app player, for most files (MKV, HEVC, AC3/DTS, several tracks…), stream downloads, and reading a file's audio and subtitle tracks |
| mpv | The external player (optional: Moviko has its own) |
| yt-dlp | Faster, more reliable stream downloads |
| qBittorrent or Transmission | Torrents (optional) |

**Moviko downloads ffmpeg, yt-dlp and mpv for you**: click **Install** on the
Home page (it shows while ffmpeg is missing), or **Settings › App & data ›
Install missing programs**. Moviko then downloads their ready-made Windows
builds from their projects' release pages into its own folder
(`%APPDATA%\Moviko\bin`), for your Windows user only: no package manager, no
administrator rights, no window to follow. The page says which program is
downloading and how far it is.

| Program | Downloaded from | Checked against |
|---|---|---|
| ffmpeg and ffprobe | [BtbN's builds](https://github.com/BtbN/FFmpeg-Builds/releases) of the newest ffmpeg release ([Gyan's](https://github.com/GyanD/codexffmpeg/releases) when those can't be had) | BtbN's `checksums.sha256` |
| yt-dlp | [its releases](https://github.com/yt-dlp/yt-dlp/releases) | its `SHA2-256SUMS` |
| mpv, the optional external player | [mpv's releases](https://github.com/mpv-player/mpv/releases) | nothing published |

That's about 250 MB to download on a computer with none of them (over
400 MB once unpacked: ffmpeg is large). Programs you already have (anywhere
on your `PATH`) are skipped, so you can run it again whenever something is
missing. A download that fails is named with the reason, and the others are
installed all the same. mpv's own build needs Microsoft's Visual C++ runtime,
which most computers have from another program: without it the setup says so
and leaves mpv out. The code is
[`server/internal/winsetup`](../../server/internal/winsetup).

To install them yourself instead: **Settings** shows what Moviko found; for a
program that isn't on your `PATH`, enter its full path there.

| For | Install |
|---|---|
| ffmpeg | `winget install Gyan.FFmpeg` |
| yt-dlp | `winget install yt-dlp.yt-dlp` |
| mpv | [mpv.io](https://mpv.io/installation/); then choose it in **Settings › Playback** |
| Torrents | qBittorrent: `winget install qBittorrent.qBittorrent`, [then turn on its Web UI](#qbittorrent); or Transmission: `winget install Transmission.Transmission` |

Hardware encoding for the in-app player (**Settings › Players & conversion**):
NVENC (NVIDIA) and Quick Sync (Intel) work on Windows; VA-API is
Linux only.

### qBittorrent

Moviko talks to qBittorrent through its Web UI, which is off by default. In
qBittorrent: **Tools › Options › Web UI**, tick **Web User Interface (Remote
control)**, and set a username and password. Then in Moviko, **Settings ›
Torrents**: host `127.0.0.1`, the same port as qBittorrent's (8080
unless you changed it), the same username and password. Moviko can start
qBittorrent when it's needed: the path (`C:\Program Files\qBittorrent\qbittorrent.exe`)
is found by itself. Transmission works the same way through its remote
access (**Edit › Preferences › Remote**).

## Where Moviko keeps its files

| Folder | What's in it |
|---|---|
| `%APPDATA%\Moviko` | Your data: the database (your list, diary, library matches, settings, watch progress), downloaded artwork, extension storage; in `bin`, the [programs Moviko downloaded](#programs-moviko-uses) |
| `%LOCALAPPDATA%\Moviko` | Cache and temporary files: the in-app player's segments (`hls`), the running server's address and token (`run`), the app window's browser data (`electron`), the last downloaded update (`update`) |
| `%LOCALAPPDATA%\Programs\Moviko` | The app, when installed with the installer |
| `%USERPROFILE%\Videos` | The library folder, until you pick yours in **Settings › Library** |

Uninstalling keeps your data; delete the first two folders to remove it too.

The installer offers to add a **Windows Firewall rule** for `moviko.exe` on
private networks (TCP 43311 for the apps and devices, UDP 43312 for the
announcements the Movikos find each other by); Windows asks for an
administrator's permission once. Without the rule, Windows Firewall asks
whether `moviko.exe` may accept connections when **Allow devices on my
network** is turned on (allow it on **private** networks), and it keeps
dropping the other devices' announcements, so a media server or another
Moviko shows as offline now and then between its answers (Settings › Devices
says "its announcements aren't getting through"). Add the rule by hand in
an administrator PowerShell:

```powershell
netsh advfirewall firewall add rule name="Moviko" dir=in action=allow program="$env:LOCALAPPDATA\Programs\Moviko\resources\moviko.exe" protocol=TCP localport=43311 profile=private
netsh advfirewall firewall add rule name="Moviko" dir=in action=allow program="$env:LOCALAPPDATA\Programs\Moviko\resources\moviko.exe" protocol=UDP localport=43312 profile=private
```

`moviko.exe --web-ui` (in the app's `resources` folder) runs the server alone,
without the window: the web UI is then at `http://127.0.0.1:43311`. The app
window uses that server when it's already running.

## Updates

Moviko looks for a newer release on GitHub each time it opens, and every
6 hours (**Settings › Updates & about** shows the last check and checks right
away). When there is one, the **Home** page shows it, with what changed:

- **Installed** with the installer: click **Update**. Moviko downloads the new
  installer, checks it against GitHub's checksum, then closes; the installer
  updates Moviko where it's installed, without asking anything, and opens it
  again. Your data stays as it is.
- **Portable**: Moviko can't update a folder you unzipped yourself. The Home
  page links the new release: download the new zip and use it instead of the
  old folder (your data is in `%APPDATA%\Moviko`, not in that folder).

Update checks need no GitHub account. (If you're signed in with the GitHub
CLI, `gh`, or have a token in `MOVIKO_GITHUB_TOKEN`, `GH_TOKEN` or
`GITHUB_TOKEN`, Moviko uses it, which raises GitHub's limit on requests.)

## Build it yourself

On Windows, with Go, Node.js and Git:

```powershell
winget install GoLang.Go
winget install OpenJS.NodeJS.LTS
winget install Git.Git
git clone https://github.com/v0-0x/kumobox-movies moviko
cd moviko
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
```

[`build.ps1`](build.ps1) does what the release workflow does: builds the web
UI, embeds it into the server, runs `go vet` and `go test` (`-SkipTests`
skips them), builds `dist\windows\moviko.exe`, then packages the app with
electron-builder ([`desktop/electron-builder.yml`](../../desktop/electron-builder.yml)).
The installer and the zip land in `dist\windows\release`. Unlike a release, a
build of your own keeps the version in `desktop/package.json` (3.0.0), so
Moviko offers it the newest release as an update.

For development, `cd desktop; npm ci; npx electron .` starts the window with
`dist\windows\moviko.exe`. On Linux, `make windows` cross-compiles that
`moviko.exe` (the installer is built on Windows).

## How releases are made

The [Windows release](../../.github/workflows/windows.yml) workflow builds,
tests and packages everything on a Windows machine for every push, on any
branch, and for every pull request: each run keeps the installer and the
portable zip as downloadable workflow artifacts (the run's **Summary** page),
so a branch can be tried before it's merged. Only pushes to the default
branch (pushes that only change docs or the Arch or macOS packaging aside)
publish the release `windows-v<version>` on the commit they built, so
installed copies get every change as an update a few minutes later. It also
runs from the repository's **Actions** tab (**Windows release**): with
**publish** ticked it creates the release (running it again on the same
commit updates it, replacing files of the same name); untick it to only get
the files as workflow artifacts.

The version is `3.0.<commits since 3.0.0's>`: the first two numbers come from
`desktop/package.json`, the last one grows with every commit (counted from
the commit its `movikoVersionBase` names, 3.0.0's), so there's nothing to bump
by hand. Releases before 2.0 were `1.0.<number of commits>`. The workflow builds it into `moviko.exe` with the
commit, and installed copies of Moviko offer the release with the highest
version as their update. The Arch package gets the same version from its
PKGBUILD.

Each build is published as a **beta** first: a pre-release titled
"Moviko <version> beta for Windows", which installed copies offer only with
Settings › Updates & about › Beta updates on. A build becomes a **stable**
release (for everyone, and the repository's latest) when the pushed commit's
message has `[stable]` in it, or when the workflow is run by hand from the
Actions tab with channel "stable" (on a beta's commit, that turns the beta
into a stable release). The newest 10 stable releases and the newest 10 betas
are kept: the workflow deletes older ones, and their tags.
