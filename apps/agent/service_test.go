package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestAgentServiceUnit(t *testing.T) {
	flags := newAgentCommand().Flags()
	if err := flags.Parse([]string{"--credential-file", "./agent.credential", "--ca", "./CBP CA$%i.pem", "--log-file", "./agent.log", "--install-service", "--once", "--help=false"}); err != nil {
		t.Fatal(err)
	}
	unit, err := agentServiceUnit("/usr/local/bin/cbp-agent", flags)
	if err != nil {
		t.Fatal(err)
	}
	credential, err := filepath.Abs("./agent.credential")
	if err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(filepath.Dir(credential), "agent.log")
	_, command, _ := strings.Cut(unit, "ExecStart=")
	command, _, _ = strings.Cut(command, "\n")
	if !strings.HasPrefix(command, `:"/usr/local/bin/cbp-agent"`) ||
		!strings.Contains(command, " --ca ") || !strings.Contains(command, " --credential-file ") ||
		!strings.Contains(command, "CBP CA$%%i.pem") ||
		!strings.Contains(command, strings.ReplaceAll(credential, "\\", "\\\\")) ||
		!strings.Contains(command, `--log-file `+strconv.Quote(logPath)) ||
		!strings.Contains(unit, "WantedBy=multi-user.target") ||
		strings.Contains(command, " --once") || strings.Contains(command, " --install-service") || strings.Contains(command, " --help") {
		t.Fatalf("unexpected unit:\n%s", unit)
	}
}

func TestWriteAgentServicePreservesManualUnit(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentServiceName)
	if err := writeAgentService(path, managedUnitHeader+"first unit"); err != nil {
		t.Fatal(err)
	}
	if err := writeAgentService(path, managedUnitHeader+"updated unit"); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != managedUnitHeader+"updated unit" {
		t.Fatalf("managed unit was not updated: %v", err)
	}
	if err := os.WriteFile(path, []byte("manual unit"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeAgentService(path, managedUnitHeader+"new unit"); err == nil {
		t.Fatal("expected a manually managed unit to be preserved")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "manual unit" {
		t.Fatalf("manual unit was changed: %v", err)
	}
}
