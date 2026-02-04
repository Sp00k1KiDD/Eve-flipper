//go:build windows

package logger

import (
	"syscall"
	"unsafe"
)

var (
	kernel32           = syscall.NewLazyDLL("kernel32.dll")
	procGetConsoleMode = kernel32.NewProc("GetConsoleMode")
	procSetConsoleMode = kernel32.NewProc("SetConsoleMode")
)

const (
	enableVirtualTerminalProcessing = 0x0004
)

// enableWindowsVT tries to enable Virtual Terminal processing on Windows 10+
func enableWindowsVT() bool {
	handle, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	if err != nil {
		return false
	}

	var mode uint32
	r1, _, _ := procGetConsoleMode.Call(uintptr(handle), uintptr(unsafe.Pointer(&mode)))
	if r1 == 0 {
		return false
	}

	// Try to enable VT processing
	r1, _, _ = procSetConsoleMode.Call(uintptr(handle), uintptr(mode|enableVirtualTerminalProcessing))
	return r1 != 0
}
