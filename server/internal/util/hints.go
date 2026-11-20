package util

import "runtime"

// InstallHint says how to install a program Moviko uses, for messages.
func InstallHint(tool string) string {
	if runtime.GOOS == "android" {
		return tool + " doesn't run on Android: play from a computer's shared library"
	}
	if runtime.GOOS == "windows" {
		// Moviko downloads them itself (winsetup).
		switch tool {
		case "ffmpeg", "yt-dlp":
			return "Settings › App & data › Install downloads it"
		case "mpv":
			return "Settings › App & data › Install downloads it, or get it from mpv.io"
		}
		return "install " + tool
	}
	if runtime.GOOS == "darwin" {
		switch tool {
		case "ffmpeg", "yt-dlp":
			return "Settings › App & data › Install downloads it"
		case "mpv":
			return "get it from mpv.io, or brew install mpv on an Apple silicon Mac"
		}
		return "install " + tool
	}
	switch tool {
	case "ffmpeg", "mpv", "yt-dlp":
		return "sudo pacman -S " + tool
	}
	return "install " + tool
}
