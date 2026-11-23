package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"google.golang.org/protobuf/types/known/structpb"
)

func TestListenerReadinessUsesLocalVerificationAddress(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	tlsServer := httptest.NewTLSServer(handler)
	defer tlsServer.Close()
	plainServer := httptest.NewServer(handler)
	defer plainServer.Close()

	const endpoint = "app.example.com:443"
	const plainEndpoint = "plain.example.com:443"
	config := agentConfig{
		DeploymentServices: []string{"nginx", "Nginx"},
		Deployments: map[string]deploymentTarget{
			endpoint:      {VerifyAddress: tlsServer.Listener.Addr().String()},
			plainEndpoint: {VerifyAddress: plainServer.Listener.Addr().String()},
		},
	}
	if want := []any{"Nginx"}; !reflect.DeepEqual(config.allowedDeploymentServices(), want) {
		t.Fatalf("expected canonical, unique allowed services")
	}
	targets, err := structpb.NewList([]any{
		map[string]any{"id": "tls", "endpoint": endpoint, "engine": "Nginx"},
		map[string]any{"id": "plain", "endpoint": plainEndpoint, "engine": "Nginx"},
		map[string]any{"id": "disallowed", "endpoint": endpoint, "engine": "Apache2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	results := config.checkListeners(context.Background(), targets.GetValues())
	for i, want := range []string{"ready", "tls-error", "not-allowed"} {
		result := results[i].(map[string]any)
		if result["status"] != want {
			t.Errorf("probe %d = %#v, want %s", i, result, want)
		}
	}
	if got := results[0].(map[string]any)["address"]; got != tlsServer.Listener.Addr().String() {
		t.Errorf("probe used %v instead of the configured verification address", got)
	}
}
