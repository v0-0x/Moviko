//go:build windows

package util

import (
	"os"
	"path/filepath"
)

// addToolsDir puts Moviko's own programs folder first on the PATH: what the
// programs setup downloads there (winsetup) is found like any program.
func addToolsDir(dir string) {
	if dir == "" {
		return
	}
	cur := os.Getenv("PATH")
	for _, d := range filepath.SplitList(cur) {
		if pathKey(d) == pathKey(dir) {
			return
		}
	}
	if cur != "" {
		dir += string(os.PathListSeparator) + cur
	}
	_ = os.Setenv("PATH", dir)
}
