package main

import (
	"errors"
	"os"
	"runtime"
	"strings"
	"unicode/utf8"
)

func operatingSystemName() string {
	if runtime.GOOS != "linux" {
		return runtime.GOOS
	}
	data, err := os.ReadFile("/etc/os-release")
	if errors.Is(err, os.ErrNotExist) {
		data, err = os.ReadFile("/usr/lib/os-release")
	}
	if err == nil {
		if name := prettyOSName(string(data)); name != "" {
			return name
		}
	}
	return runtime.GOOS
}

func prettyOSName(release string) string {
	lines := strings.Split(release, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		key, value, ok := strings.Cut(strings.TrimSpace(lines[i]), "=")
		if !ok || key != "PRETTY_NAME" {
			continue
		}
		value = strings.TrimSpace(value)
		if value != "" && (value[0] == '"' || value[0] == '\'') {
			if len(value) < 2 || value[0] != value[len(value)-1] {
				return ""
			}
			switch value[0] {
			case '\'':
				value = value[1 : len(value)-1]
			case '"':
				value = strings.NewReplacer("\\\\", "\\", "\\\"", "\"", "\\$", "$", "\\`", "`").
					Replace(value[1 : len(value)-1])
			}
		}
		value = strings.TrimSpace(value)
		if len(value) <= 256 && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n") {
			return value
		}
		return ""
	}
	return ""
}
