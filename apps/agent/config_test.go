package main

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadYAMLConfig(t *testing.T) {
	for _, extension := range []string{".yaml", ".yml"} {
		t.Run(extension, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "agent"+extension)
			if err := os.WriteFile(path, []byte(`
controller: controller.example.com:50051
interval: 30s
deploymentServices: [Nginx, HAProxy]
deployments:
  app.example.com:443:
    engine: Nginx
    certificateFile: /etc/nginx/app.pem
    keyFile: /etc/nginx/app.key
    verifyAddress: 127.0.0.1:443
`), 0600); err != nil {
				t.Fatal(err)
			}
			cfg, err := readConfig(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(cfg.DeploymentServices) != 2 || cfg.DeploymentServices[0] != "Nginx" || cfg.DeploymentServices[1] != "HAProxy" {
				t.Fatalf("incorrect allowed services: %v", cfg.DeploymentServices)
			}
			if cfg.Deployments["app.example.com:443"].KeyFile != "/etc/nginx/app.key" {
				t.Fatal("missing deployment target")
			}
			flags := flag.NewFlagSet("test", flag.ContinueOnError)
			controller := flags.String("controller", "", "")
			interval := flags.Duration("interval", time.Minute, "")
			if err := flags.Parse([]string{"-controller", "override.example.com:50051"}); err != nil {
				t.Fatal(err)
			}
			if err := applyConfig(flags, cfg); err != nil {
				t.Fatal(err)
			}
			if *controller != "override.example.com:50051" || *interval != 30*time.Second {
				t.Fatal("CLI override or YAML interval was ignored")
			}
		})
	}
}
