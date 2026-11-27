package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/spf13/pflag"
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
		!strings.Contains(unit, "RestartPreventExitStatus=3\n") ||
		strings.Contains(command, " --once") || strings.Contains(command, " --install-service") || strings.Contains(command, " --help") {
		t.Fatalf("unexpected unit:\n%s", unit)
	}
}

func TestUnregisterUsesManagedServiceFlags(t *testing.T) {
	const host = "fe381beb-604b-43a7-868d-f46429eba21a"
	const controller = "controller.example.test:50051"
	const ca = "CBP CA \"quoted\" $%i.pem"
	const credential = "agent credentials/agent.token"
	flags := newAgentCommand().Flags()
	if err := flags.Parse([]string{"--host", host, "--controller", controller, "--ca", ca, "--credential-file", credential, "--interval", "45s"}); err != nil {
		t.Fatal(err)
	}
	unit, err := agentServiceUnit("/usr/local/bin/cbp-agent", flags)
	if err != nil {
		t.Fatal(err)
	}
	caPath, err := filepath.Abs(ca)
	if err != nil {
		t.Fatal(err)
	}
	credentialPath, err := filepath.Abs(credential)
	if err != nil {
		t.Fatal(err)
	}

	for name, unit := range map[string]string{
		"current": unit,
		"legacy":  strings.ReplaceAll(unit, " --", " -"),
	} {
		t.Run(name, func(t *testing.T) {
			var options agentOptions
			flags := pflag.NewFlagSet("unregister", pflag.ContinueOnError)
			addAgentConnectionFlags(flags, &options)
			if err := applyAgentServiceFlags(unit, flags); err != nil {
				t.Fatal(err)
			}
			// The service's explicit arguments still take precedence over YAML.
			if err := applyConfig(flags, agentConfig{Host: "another-host"}); err != nil {
				t.Fatal(err)
			}
			if options.host != host || options.address != controller || options.ca != caPath || options.credentialFile != credentialPath {
				t.Fatalf("incorrect unregister settings: %+v", options)
			}
		})
	}
}

func TestUnregisterRejectsAmbiguousServiceCommand(t *testing.T) {
	var options agentOptions
	flags := pflag.NewFlagSet("unregister", pflag.ContinueOnError)
	addAgentConnectionFlags(flags, &options)
	for _, unit := range []string{
		"ExecStart=:\"/usr/local/bin/cbp-agent\" --host \"missing closing quote",
		"ExecStart=:\"/usr/local/bin/cbp-agent\"\nExecStart=:\"/other\"",
		"ExecStart=:\"/usr/local/bin/cbp-agent\" --ca \"/etc/cbp/%i.pem\"",
	} {
		if err := applyAgentServiceFlags(unit, flags); err == nil {
			t.Fatalf("accepted ambiguous service command %q", unit)
		}
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
