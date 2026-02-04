package logger

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

// ANSI color codes
const (
	reset   = "\033[0m"
	bold    = "\033[1m"
	dim     = "\033[2m"
	
	black   = "\033[30m"
	red     = "\033[31m"
	green   = "\033[32m"
	yellow  = "\033[33m"
	blue    = "\033[34m"
	magenta = "\033[35m"
	cyan    = "\033[36m"
	white   = "\033[37m"
	
	bgBlack = "\033[40m"
	bgRed   = "\033[41m"
	bgGreen = "\033[42m"
	bgBlue  = "\033[44m"
	bgCyan  = "\033[46m"
)

var useColors = runtime.GOOS != "windows" || os.Getenv("TERM") != ""

func init() {
	// Enable colors on Windows 10+ by setting VT mode
	if runtime.GOOS == "windows" {
		useColors = enableVT()
	}
}

// enableVT enables virtual terminal processing on Windows
func enableVT() bool {
	// Try to enable VT processing - if it works, colors are supported
	// This is a simplified check; full implementation would use Windows API
	return true
}

func colorize(color, text string) string {
	if !useColors {
		return text
	}
	return color + text + reset
}

func timestamp() string {
	t := time.Now().Format("15:04:05")
	return colorize(dim, t)
}

// Banner prints the startup banner
func Banner(version string) {
	if version == "" {
		version = "dev"
	}
	
	fmt.Println()
	fmt.Println(colorize(cyan+bold, "  ╔═══════════════════════════════════════╗"))
	fmt.Println(colorize(cyan+bold, "  ║")+colorize(yellow+bold, "         EVE FLIPPER ")+colorize(dim, version)+colorize(cyan+bold, strings.Repeat(" ", 18-len(version))+"║"))
	fmt.Println(colorize(cyan+bold, "  ║")+colorize(dim, "      Market Analysis Tool           ")+colorize(cyan+bold, "║"))
	fmt.Println(colorize(cyan+bold, "  ╚═══════════════════════════════════════╝"))
	fmt.Println()
}

// Info prints an info message
func Info(tag, msg string) {
	icon := colorize(blue, "●")
	tagStr := colorize(cyan, fmt.Sprintf("[%s]", tag))
	fmt.Printf("%s %s %s %s\n", timestamp(), icon, tagStr, msg)
}

// Success prints a success message
func Success(tag, msg string) {
	icon := colorize(green, "✓")
	tagStr := colorize(green, fmt.Sprintf("[%s]", tag))
	fmt.Printf("%s %s %s %s\n", timestamp(), icon, tagStr, msg)
}

// Warn prints a warning message
func Warn(tag, msg string) {
	icon := colorize(yellow, "⚠")
	tagStr := colorize(yellow, fmt.Sprintf("[%s]", tag))
	fmt.Printf("%s %s %s %s\n", timestamp(), icon, tagStr, msg)
}

// Error prints an error message
func Error(tag, msg string) {
	icon := colorize(red, "✗")
	tagStr := colorize(red, fmt.Sprintf("[%s]", tag))
	fmt.Printf("%s %s %s %s\n", timestamp(), icon, tagStr, msg)
}

// Loading prints a loading message (without newline initially)
func Loading(tag, msg string) {
	icon := colorize(magenta, "◐")
	tagStr := colorize(magenta, fmt.Sprintf("[%s]", tag))
	fmt.Printf("%s %s %s %s", timestamp(), icon, tagStr, msg)
}

// Done completes a loading message
func Done(details string) {
	if details != "" {
		fmt.Printf(" %s\n", colorize(dim, details))
	} else {
		fmt.Println()
	}
}

// Server prints the server listening message
func Server(addr string) {
	fmt.Println()
	icon := colorize(green+bold, "►")
	fmt.Printf("%s %s Server running at %s\n", timestamp(), icon, colorize(cyan+bold, "http://"+addr))
	fmt.Printf("%s   %s\n", strings.Repeat(" ", 8), colorize(dim, "Press Ctrl+C to stop"))
	fmt.Println()
}

// Section prints a section header
func Section(title string) {
	fmt.Printf("\n%s %s\n", colorize(dim, "───"), colorize(white+bold, title))
}

// Stats prints statistics in a nice format
func Stats(label string, value interface{}) {
	fmt.Printf("    %s %s %v\n", colorize(dim, "•"), colorize(dim, label+":"), colorize(white, fmt.Sprint(value)))
}
