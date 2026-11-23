package main

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentServiceUnit(t *testing.T) {
	flags := flag.NewFlagSet("agent", flag.ContinueOnError)
	flags.String("credential-file", "", "")
	flags.String("ca", "", "")
	flags.Bool("install-service", false, "")
	flags.Bool("once", false, "")
	if err := flags.Parse([]string{"-credential-file", "./agent.credential", "-ca", "./CBP CA$%i.pem", "-install-service", "-once"}); err != nil {
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
	_, command, _ := strings.Cut(unit, "ExecStart=")
	command, _, _ = strings.Cut(command, "\n")
	if !strings.HasPrefix(command, `:"/usr/local/bin/cbp-agent"`) ||
		!strings.Contains(command, "CBP CA$%%i.pem") ||
		!strings.Contains(command, strings.ReplaceAll(credential, "\\", "\\\\")) ||
		!strings.Contains(unit, "WantedBy=multi-user.target") ||
		strings.Contains(command, " -once") || strings.Contains(command, " -install-service") {
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
