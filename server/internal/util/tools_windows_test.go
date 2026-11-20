//go:build windows

package util

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// What the programs setup downloads into Moviko's folder is found like any
// program on the PATH.
func TestToolsDirIsOnThePath(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "moviko-test-tool.exe"), nil, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", os.Getenv("PATH")) // restored afterwards
	old := ToolsDir()
	t.Cleanup(func() {
		toolsMu.Lock()
		toolsDir = old
		toolsMu.Unlock()
	})

	SetToolsDir(dir)
	p, ok := LookPath("moviko-test-tool")
	if !ok || !strings.EqualFold(filepath.Dir(p), dir) {
		t.Errorf("LookPath(moviko-test-tool) = %q %v, want it in %s", p, ok, dir)
	}
	path := os.Getenv("PATH")
	if !strings.HasPrefix(path, dir+string(os.PathListSeparator)) {
		t.Errorf("PATH %q should start with Moviko's folder", path)
	}
	// Set again: not on the PATH twice.
	SetToolsDir(dir)
	if os.Getenv("PATH") != path {
		t.Error("SetToolsDir put the folder on the PATH twice")
	}
}
