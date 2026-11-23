package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"errors"
	"math/big"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rpc "cbp/agent-rpc"
)

func TestVerifyDeploymentChainRequiresIntermediate(t *testing.T) {
	now := time.Now()
	makeCertificate := func(serial int64, isCA bool, parent *x509.Certificate, signer ed25519.PrivateKey) ([]byte, *x509.Certificate, ed25519.PrivateKey) {
		t.Helper()
		public, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		template := &x509.Certificate{
			SerialNumber: big.NewInt(serial), NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
			BasicConstraintsValid: true, IsCA: isCA, KeyUsage: x509.KeyUsageDigitalSignature,
		}
		if isCA {
			template.KeyUsage |= x509.KeyUsageCertSign
		} else {
			template.DNSNames = []string{"app.example.test"}
		}
		if parent == nil {
			parent, signer = template, key
		}
		raw, err := x509.CreateCertificate(rand.Reader, template, parent, public, signer)
		if err != nil {
			t.Fatal(err)
		}
		certificate, err := x509.ParseCertificate(raw)
		if err != nil {
			t.Fatal(err)
		}
		return raw, certificate, key
	}

	_, root, rootKey := makeCertificate(1, true, nil, nil)
	intermediateRaw, intermediate, intermediateKey := makeCertificate(2, true, root, rootKey)
	leafRaw, _, _ := makeCertificate(3, false, intermediate, intermediateKey)
	roots := x509.NewCertPool()
	roots.AddCert(root)
	target := deploymentTarget{ServerName: "app.example.test", roots: roots}
	if err := verifyDeploymentChain([][]byte{leafRaw}, target); err == nil {
		t.Fatal("chain without the intermediate was trusted")
	}
	if err := verifyDeploymentChain([][]byte{leafRaw, intermediateRaw}, target); err != nil {
		t.Fatal(err)
	}
	target.ServerName = "192.0.2.10"
	err := verifyDeploymentChain([][]byte{leafRaw, intermediateRaw}, target)
	if err == nil {
		t.Fatal("the DNS-only certificate was trusted for an IP address")
	}
	at := time.Date(2026, 11, 23, 14, 56, 29, 0, time.FixedZone("GMT+7", 7*60*60))
	diagnostic := certificateDiagnostic(err, at)
	want := `2026/11/23 14:56:29 +07:00 WARN deployment certificate verification failed error="x509: cannot validate certificate for 192.0.2.10 because it doesn't contain any IP SANs"`
	if diagnostic != want {
		t.Fatalf("diagnostic = %q, want %q", diagnostic, want)
	}
}

func TestCertificateDiagnosticBounds(t *testing.T) {
	diagnostic := certificateDiagnostic(errors.New("unexpected\n"+strings.Repeat("語", 512)), time.Now())
	if !rpc.ValidDeploymentDiagnostic(diagnostic) || !strings.HasSuffix(diagnostic, "…") {
		t.Fatalf("expected a bounded single-line diagnostic, got %q", diagnostic)
	}
}

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
