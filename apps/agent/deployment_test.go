package main

import (
	"path/filepath"
	"testing"
)

func TestManagedTLSPaths(t *testing.T) {
	for _, test := range []struct {
		engine, endpoint, directory, certificate, key string
	}{
		{"Nginx", "app.example.com:443", "app.example.com", "fullchain.pem", "privkey.pem"},
		{"aPaChe2", "app.example.com:8443", "app.example.com/8443", "fullchain.pem", "privkey.pem"},
		{"HAProxy", "192.0.2.10:443", "192.0.2.10", "haproxy.pem", ""},
		{"Nginx", "[2001:db8::1]:443", "2001:db8::1", "fullchain.pem", "privkey.pem"},
	} {
		t.Run(test.engine+" "+test.endpoint, func(t *testing.T) {
			target := deploymentTarget{Engine: test.engine, VerifyAddress: "127.0.0.1:443"}
			if test.engine == "HAProxy" {
				target.ConfigFile = filepath.Join(t.TempDir(), "haproxy.cfg")
			}
			got, err := configureDeploymentTarget(test.endpoint, target)
			if err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(managedTLSRoot, filepath.FromSlash(test.directory))
			keyFile := ""
			if test.key != "" {
				keyFile = filepath.Join(directory, test.key)
			}
			if got.managedDir != directory || got.CertificateFile != filepath.Join(directory, test.certificate) || got.KeyFile != keyFile {
				t.Fatalf("incorrect deployment paths: %#v", got)
			}
		})
	}
}

func TestCustomTLSPathsAndInvalidManagedNames(t *testing.T) {
	directory := t.TempDir()
	target := deploymentTarget{
		Engine: "Nginx", VerifyAddress: "127.0.0.1:443", ServerName: "example.com",
		CertificateFile: filepath.Join(directory, "existing.pem"),
		KeyFile:         filepath.Join(directory, "existing.key"),
	}
	if got, err := configureDeploymentTarget("example.com:443", target); err != nil || got != target {
		t.Fatalf("custom paths changed: %#v, %v", got, err)
	}
	target.CertificateFile = ""
	if _, err := configureDeploymentTarget("example.com:443", target); err == nil {
		t.Fatal("expected a missing custom certificate path to be rejected")
	}
	target.KeyFile = ""
	for _, endpoint := range []string{"../other:443", "a/b:443", "a\\b:443", "[fe80::1%eth0]:443"} {
		if _, err := configureDeploymentTarget(endpoint, target); err == nil {
			t.Errorf("expected managed endpoint %q to be rejected", endpoint)
		}
	}
}

func TestDeploymentFromWebTarget(t *testing.T) {
	config := agentConfig{DeploymentServices: []string{"nginx", "HAPROXY"}}
	if !config.deploymentEnabled() {
		t.Fatal("an allowed service should enable claiming jobs without endpoint entries")
	}
	target, err := config.deploymentTarget("app.example.com:8443", "Nginx")
	if err != nil || target.Engine != "Nginx" || target.VerifyAddress != "127.0.0.1:8443" || target.ServerName != "app.example.com" ||
		target.CertificateFile != filepath.Join(managedTLSRoot, "app.example.com", "8443", "fullchain.pem") {
		t.Fatalf("unexpected default target: %#v, %v", target, err)
	}
	target, err = config.deploymentTarget("[2001:db8::1]:443", "HAProxy")
	if err != nil || target.VerifyAddress != "[::1]:443" || target.ConfigFile != "/etc/haproxy/haproxy.cfg" || target.KeyFile != "" {
		t.Fatalf("unexpected HAProxy target: %#v, %v", target, err)
	}
	if _, err := config.deploymentTarget("app.example.com:443", "Apache2"); err == nil {
		t.Fatal("accepted a service missing from the local allowlist")
	}
	if _, err := config.deploymentTarget("../other:443", "Nginx"); err == nil {
		t.Fatal("accepted a web endpoint that could escape the managed directory")
	}
}

func TestDeploymentLocalOverridesAndLegacyConfig(t *testing.T) {
	const endpoint = "app.example.com:443"
	config := agentConfig{
		DeploymentServices: []string{"Nginx"},
		Deployments: map[string]deploymentTarget{
			endpoint: {VerifyAddress: "127.0.0.1:9443", ServerName: "internal.example.com"},
		},
	}
	target, err := config.deploymentTarget(endpoint, "Nginx")
	if err != nil || target.VerifyAddress != "127.0.0.1:9443" || target.ServerName != "internal.example.com" {
		t.Fatalf("local overrides ignored: %#v, %v", target, err)
	}
	config.Deployments[endpoint] = deploymentTarget{Engine: "nGiNx", VerifyAddress: "127.0.0.1:9443"}
	config.DeploymentServices = nil
	if !config.deploymentEnabled() {
		t.Fatal("legacy endpoint configuration should enable claiming jobs")
	}
	if _, err := config.deploymentTarget(endpoint, "Nginx"); err != nil {
		t.Fatalf("legacy endpoint rejected: %v", err)
	}
	if _, err := config.deploymentTarget("other.example.com:443", "Nginx"); err == nil {
		t.Fatal("legacy configuration authorized a new endpoint")
	}
	config.DeploymentServices = []string{}
	if config.deploymentEnabled() {
		t.Fatal("an explicit empty allowlist should disable deployments")
	}
}
