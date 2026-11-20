//go:build !darwin && !windows

package util

// addToolsDir: only macOS and Windows have Moviko put programs in its own
// folder.
func addToolsDir(string) {}
