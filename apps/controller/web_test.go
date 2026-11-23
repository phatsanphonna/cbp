package main

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWebClient(t *testing.T) {
	token := strings.Repeat("a", 43)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer "+token ||
			r.Header.Get("Content-Type") != "application/json" {
			t.Error("missing controller authentication or JSON headers")
		}
		var payload webRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.HostID != "host" {
			t.Error("unexpected request payload", err)
		}
		switch r.URL.Path {
		case "/cbp/api/internal/controller/check-in":
			w.WriteHeader(http.StatusNoContent)
		case "/cbp/api/internal/controller/enroll":
			w.WriteHeader(http.StatusForbidden)
		case "/cbp/api/internal/controller/invite":
			http.Redirect(w, r, "/cbp/api/internal/controller/check-in", http.StatusTemporaryRedirect)
		default:
			t.Errorf("unexpected URL path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	client, err := newWebClient(server.URL+"/cbp", token, ca)
	if err != nil {
		t.Fatal(err)
	}
	for operation, want := range map[string]error{
		"check-in": nil,
		"enroll":   webStatusError(http.StatusForbidden),
		"invite":   webStatusError(http.StatusTemporaryRedirect),
	} {
		if err := client.send(t.Context(), operation, webRequest{HostID: "host"}); err != want {
			t.Errorf("%s: got %v, want %v", operation, err, want)
		}
	}
	if _, err := newWebClient("http://cbp.example.test", token, ""); err == nil {
		t.Error("expected plain HTTP to a remote web app to be rejected")
	}
}

func TestReportHealthSendsImmediately(t *testing.T) {
	requested := make(chan struct{}, 1)
	token := strings.Repeat("a", 43)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/internal/controller/heartbeat" ||
			r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("unexpected heartbeat request")
		}
		w.WriteHeader(http.StatusNoContent)
		requested <- struct{}{}
	}))
	defer server.Close()
	client, err := newWebClient(server.URL, token, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		client.reportHealth(ctx)
	}()
	select {
	case <-requested:
		cancel()
	case <-ctx.Done():
		t.Fatal("controller did not send the startup heartbeat")
	}
	<-done
}
