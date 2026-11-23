package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestProbeInventoryPaginatesAndReports(t *testing.T) {
	var inventory []probeHost
	for i := range 201 {
		inventory = append(inventory, probeHost{ID: fmt.Sprintf("host-%03d", i), Name: "fe80::1%unsupported-zone"})
	}
	reported := make(map[string]bool)
	var reportedMu sync.Mutex
	token := strings.Repeat("a", 43)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("missing controller token")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var payload webRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch r.URL.Path {
		case "/api/internal/controller/probe-hosts":
			switch payload.After {
			case "":
				json.NewEncoder(w).Encode(inventory[:200])
			case inventory[199].ID:
				json.NewEncoder(w).Encode(inventory[200:])
			default:
				t.Error("unexpected cursor")
				w.WriteHeader(http.StatusBadRequest)
			}
		case "/api/internal/controller/probe-results":
			reportedMu.Lock()
			defer reportedMu.Unlock()
			if len(payload.Probes) == 0 || len(payload.Probes) > 12 {
				t.Error("unexpected result batch size")
			}
			for _, probe := range payload.Probes {
				if reported[probe.HostID] || probe.Status != "unavailable" || probe.Address != nil || probe.CheckedAt.IsZero() {
					t.Errorf("unexpected probe: %#v", probe)
				}
				reported[probe.HostID] = true
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client, err := newWebClient(server.URL, token, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.probeInventory(t.Context()); err != nil {
		t.Fatal(err)
	}
	reportedMu.Lock()
	defer reportedMu.Unlock()
	if len(reported) != len(inventory) {
		t.Fatalf("reported %d of %d hosts", len(reported), len(inventory))
	}
}
