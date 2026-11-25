package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"net"
	"slices"
	"sync"
	"time"

	"google.golang.org/protobuf/types/known/structpb"
)

const maxListenerTargets = 12

func (config agentConfig) allowedDeploymentServices() []any {
	services := config.DeploymentServices
	if services == nil {
		for _, target := range config.Deployments {
			services = append(services, target.Engine)
		}
	}
	canonical := make([]string, 0, len(services))
	for _, name := range services {
		if engine := canonicalDeploymentService(name); engine != "" && !slices.Contains(canonical, engine) {
			canonical = append(canonical, engine)
		}
	}
	slices.Sort(canonical)
	result := make([]any, len(canonical))
	for index, name := range canonical {
		result[index] = name
	}
	return result
}

func (config agentConfig) checkListeners(ctx context.Context, targets []*structpb.Value) []any {
	targets = targets[:min(len(targets), maxListenerTargets)]
	results := make([]any, len(targets))
	var checks sync.WaitGroup
	for index, entry := range targets {
		checks.Go(func() {
			fields := entry.GetStructValue().GetFields()
			id, endpoint, engine := fields["id"].GetStringValue(), fields["endpoint"].GetStringValue(), fields["engine"].GetStringValue()
			result := map[string]any{"id": id, "endpoint": endpoint, "engine": engine, "status": "not-allowed"}
			if target, err := config.deploymentTarget(endpoint, engine); err == nil {
				result["address"] = target.VerifyAddress
				status, fingerprint, expiresAt := checkTLSListener(ctx, target)
				result["status"] = status
				if fingerprint != "" {
					result["fingerprint"] = fingerprint
					result["expiresAt"] = expiresAt.UTC().Format(time.RFC3339)
				}
			}
			results[index] = result
		})
	}
	checks.Wait()
	return results
}

func checkTLSListener(ctx context.Context, target deploymentTarget) (string, string, time.Time) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", target.VerifyAddress)
	if err != nil {
		return "unreachable", "", time.Time{}
	}
	defer connection.Close()
	client := tls.Client(connection, &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: target.ServerName,
		// Readiness checks for a TLS handshake even before the expected certificate is installed.
		InsecureSkipVerify: true,
	})
	if err := client.HandshakeContext(ctx); err != nil {
		return "tls-error", "", time.Time{}
	}
	state := client.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return "tls-error", "", time.Time{}
	}
	leaf := state.PeerCertificates[0]
	fingerprint := sha256.Sum256(leaf.Raw)
	return "ready", hex.EncodeToString(fingerprint[:]), leaf.NotAfter
}
