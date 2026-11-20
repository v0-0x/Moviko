//go:build !windows

package winsetup

// Only Windows has this (look_windows.go): elsewhere the package builds for
// the tests, which bring their own.
func vcRuntime() bool { return true }
