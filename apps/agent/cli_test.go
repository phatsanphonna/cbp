package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

func TestAgentCommandAcceptsExistingFlags(t *testing.T) {
	command := newAgentCommand()
	command.SetArgs(normalizeAgentArgs([]string{
		"-host", "host-1", "--controller=127.0.0.1:50051", "-credential-file", "-ca",
		"-ca=controller.pem", "-interval", "45s", "-once=false", "-install-service",
	}, command.Flags()))
	command.RunE = func(cmd *cobra.Command, _ []string) error {
		flags := cmd.Flags()
		for name, want := range map[string]string{
			"host": "host-1", "controller": "127.0.0.1:50051", "credential-file": "-ca", "ca": "controller.pem",
		} {
			if got, err := flags.GetString(name); got != want || err != nil {
				t.Fatalf("--%s = %q, want %q (%v)", name, got, want, err)
			}
		}
		interval, _ := flags.GetDuration("interval")
		once, _ := flags.GetBool("once")
		install, _ := flags.GetBool("install-service")
		if interval != 45*time.Second || once || !install {
			t.Fatalf("unexpected interval or mode: %v, once=%v, install=%v", interval, once, install)
		}
		return nil
	}
	if err := command.ExecuteContext(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestAgentCommandHelp(t *testing.T) {
	for _, arg := range []string{"--help", "-help", "-h"} {
		t.Run(arg, func(t *testing.T) {
			command := newAgentCommand()
			var output bytes.Buffer
			command.SetOut(&output)
			command.SetArgs(normalizeAgentArgs([]string{arg}, command.Flags()))
			if err := command.ExecuteContext(t.Context()); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(output.String(), "cbp-agent") || !strings.Contains(output.String(), "--install-service") {
				t.Fatalf("unexpected help output: %s", output.String())
			}
		})
	}
}

func TestAgentLifecycleCommandHelp(t *testing.T) {
	for _, name := range []string{"register", "unregister", "uninstall"} {
		t.Run(name, func(t *testing.T) {
			command := newAgentCommand()
			var output bytes.Buffer
			command.SetOut(&output)
			command.SetArgs([]string{name, "--help"})
			if err := command.ExecuteContext(t.Context()); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(output.String(), "cbp-agent "+name) {
				t.Fatalf("unexpected help output: %s", output.String())
			}
		})
	}
}
