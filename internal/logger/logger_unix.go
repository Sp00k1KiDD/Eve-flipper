//go:build !windows

package logger

// enableWindowsVT is a no-op on non-Windows systems
func enableWindowsVT() bool {
	return true
}
