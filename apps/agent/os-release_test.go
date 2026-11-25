package main

import (
	"strings"
	"testing"
)

func TestPrettyOSName(t *testing.T) {
	for _, tc := range []struct {
		name, release, want string
	}{
		{"Ubuntu", "ID=ubuntu\nPRETTY_NAME=\"Ubuntu 26.04\"\n", "Ubuntu 26.04"},
		{"single quotes", "PRETTY_NAME='Debian GNU/Linux 13'", "Debian GNU/Linux 13"},
		{"escaped characters", "PRETTY_NAME=\"Example \\\"Linux\\\" \\$1\"", "Example \"Linux\" $1"},
		{"last entry wins", "PRETTY_NAME=old\nPRETTY_NAME=new", "new"},
		{"unclosed quote", "PRETTY_NAME=\"incomplete", ""},
		{"missing name", "NAME=Linux", ""},
		{"too long", "PRETTY_NAME=" + strings.Repeat("x", 257), ""},
		{"invalid UTF-8", "PRETTY_NAME=\xff", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := prettyOSName(tc.release); got != tc.want {
				t.Fatalf("prettyOSName() = %q, want %q", got, tc.want)
			}
		})
	}
}
