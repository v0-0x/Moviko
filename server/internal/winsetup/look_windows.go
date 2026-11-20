//go:build windows

package winsetup

import (
	"os"
	"path/filepath"
)

// vcRuntime reports whether Microsoft's Visual C++ runtime is installed: it
// isn't part of Windows, though most computers have it from another program.
func vcRuntime() bool {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	for _, dll := range []string{"vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"} {
		if !isFile(filepath.Join(root, "System32", dll)) {
			return false
		}
	}
	return true
}
