package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

var serviceTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)

type webClient struct {
	baseURL *url.URL
	token   string
	client  *http.Client
}

type webRequest struct {
	HostID     string      `json:"hostId,omitempty"`
	Code       string      `json:"code,omitempty"`
	Address    string      `json:"address,omitempty"`
	Token      string      `json:"token,omitempty"`
	Report     *hostReport `json:"report,omitempty"`
	JobID      string      `json:"jobId,omitempty"`
	Outcome    string      `json:"outcome,omitempty"`
	Diagnostic string      `json:"diagnostic,omitempty"`
	Message    string      `json:"message,omitempty"`
	After      string      `json:"after,omitempty"`
	Probes     []hostProbe `json:"probes,omitempty"`
}

type hostReport struct {
	Hostname        string    `json:"hostname"`
	OperatingSystem string    `json:"operatingSystem"`
	Architecture    string    `json:"architecture"`
	CollectedAt     time.Time `json:"collectedAt"`
	// An explicit empty list clears readiness data. An omitted field means a legacy report.
	AllowedServices any    `json:"allowedServices,omitzero"`
	ListenerResults any    `json:"listenerResults,omitzero"`
	ListenerCursor  string `json:"listenerCursor,omitempty"`
}

func webFromEnv() (*webClient, error) {
	address := os.Getenv("CBP_WEB_URL")
	token := os.Getenv("CBP_CONTROLLER_TOKEN")
	ca := os.Getenv("CBP_WEB_CA_FILE")
	if address == "" && token == "" && ca == "" {
		return nil, nil
	}
	return newWebClient(address, token, ca)
}

func newWebClient(address, token, caFile string) (*webClient, error) {
	base, err := url.Parse(address)
	if err != nil || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("CBP_WEB_URL must be the web app's base URL")
	}
	host := base.Hostname()
	ip := net.ParseIP(host)
	loopback := strings.EqualFold(host, "localhost") || ip.IsLoopback()
	if base.Scheme != "https" && !(base.Scheme == "http" && loopback && caFile == "") {
		return nil, errors.New("CBP_WEB_URL requires HTTPS outside local development")
	}
	if !serviceTokenPattern.MatchString(token) {
		return nil, errors.New("CBP_CONTROLLER_TOKEN must be a 43 to 128 character URL-safe token")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CBP_WEB_CA_FILE: %w", err)
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return nil, errors.New("CBP_WEB_CA_FILE contains no trust certificates")
		}
		transport.TLSClientConfig.RootCAs = roots
	}
	return &webClient{
		baseURL: base,
		token:   token,
		client: &http.Client{
			Transport: transport,
			Timeout:   7 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

type webStatusError int

func (e webStatusError) Error() string {
	switch int(e) {
	case http.StatusUnauthorized:
		return "web API rejected CBP_CONTROLLER_TOKEN"
	case http.StatusForbidden:
		return "web API rejected the agent credential or enrollment code"
	case http.StatusNotFound:
		return "agent-managed host or controller endpoint not found"
	case http.StatusConflict:
		return "host already has an active enrollment code or agent credential"
	default:
		return fmt.Sprintf("web API returned HTTP %d", e)
	}
}

func (w *webClient) send(ctx context.Context, operation string, payload webRequest) error {
	return w.request(ctx, operation, payload, nil)
}

func (w *webClient) request(ctx context.Context, operation string, payload webRequest, reply any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := w.baseURL.JoinPath("api", "internal", "controller", operation)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+w.token)
	response, err := w.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK && reply != nil {
		return json.UnmarshalRead(io.LimitReader(response.Body, 128*1024), reply)
	}
	if response.StatusCode != http.StatusNoContent {
		return webStatusError(response.StatusCode)
	}
	return nil
}

func (w *webClient) reportHealth(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		if err := w.send(ctx, "heartbeat", webRequest{}); err != nil && ctx.Err() == nil {
			slog.Warn("controller heartbeat failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
