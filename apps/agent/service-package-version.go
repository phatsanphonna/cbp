package main

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

var deploymentPackages = map[string][]string{
	"Apache2": {"apache2", "apache2-bin", "httpd"},
	"HAProxy": {"haproxy"},
	"Nginx":   {"nginx", "nginx-core", "nginx-full", "nginx-light", "nginx-extras"},
}

func (config agentConfig) deploymentServiceVersions(ctx context.Context) map[string]any {
	versions := make(map[string]any)
	if runtime.GOOS != "linux" {
		return versions
	}
	for _, value := range config.allowedDeploymentServices() {
		service, ok := value.(string)
		if !ok {
			continue
		}
		for _, name := range deploymentPackages[service] {
			version := packageVersion(ctx, name)
			if version != "" {
				versions[service] = version
				break
			}
		}
	}
	return versions
}

func packageVersion(ctx context.Context, name string) string {
	commands := [][]string{
		{"dpkg-query", "-W", "-f=${Version}", name},
		{"rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", name},
	}
	for _, args := range commands {
		call, cancel := context.WithTimeout(ctx, 2*time.Second)
		output, err := exec.CommandContext(call, args[0], args[1:]...).Output()
		cancel()
		if err != nil {
			continue
		}
		version := strings.TrimSpace(string(output))
		if version != "" && len(version) <= 128 && !strings.ContainsAny(version, "\x00\r\n") {
			return version
		}
	}
	return ""
}
