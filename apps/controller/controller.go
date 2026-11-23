package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	rpc "cbp/agent-rpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type controller struct {
	stateDir string
	enrollMu sync.Mutex
	web      *webClient
}

func (c *controller) Enroll(ctx context.Context, req *wrapperspb.StringValue) (*emptypb.Empty, error) {
	host, token, err := identity(ctx)
	if err != nil {
		return nil, err
	}
	code := req.GetValue()
	if !rpc.ValidToken(code) {
		return nil, status.Error(codes.Unauthenticated, "invalid enrollment code")
	}

	if c.web != nil {
		if err := c.web.send(ctx, "enroll", webRequest{HostID: host, Code: code, Token: token}); err != nil {
			return nil, webRPCError("enroll", host, err)
		}
		slog.Info("agent enrolled", "host", host)
		return &emptypb.Empty{}, nil
	}

	c.enrollMu.Lock()
	defer c.enrollMu.Unlock()
	path := recordPath(c.stateDir, host)
	record, err := readAgent(path)
	if err != nil {
		return nil, err
	}
	if record.TokenHash != "" || !time.Now().Before(record.ExpiresAt) || !matches(record.InviteHash, code) {
		return nil, status.Error(codes.Unauthenticated, "invalid or expired enrollment code")
	}
	if err := writeRecord(path, agentRecord{TokenHash: digest(token)}); err != nil {
		slog.Error("store enrollment", "host", host, "error", err)
		return nil, status.Error(codes.Unavailable, "agent store unavailable")
	}
	slog.Info("agent enrolled", "host", host)
	return &emptypb.Empty{}, nil
}

func (c *controller) CheckIn(ctx context.Context, req *structpb.Struct) (*emptypb.Empty, error) {
	host, token, err := identity(ctx)
	if err != nil {
		return nil, err
	}
	fields := req.GetFields()
	hostname := fields["hostname"].GetStringValue()
	osName := fields["operatingSystem"].GetStringValue()
	arch := fields["architecture"].GetStringValue()
	collected, err := time.Parse(time.RFC3339Nano, fields["collectedAt"].GetStringValue())
	if !validField(hostname, 253) || !validField(osName, 256) || !validField(arch, 80) ||
		err != nil || collected.Before(time.Unix(0, 0)) || collected.After(time.Now().Add(5*time.Minute)) {
		return nil, status.Error(codes.InvalidArgument, "invalid host report")
	}
	if c.web != nil {
		report := hostReport{Hostname: hostname, OperatingSystem: osName, Architecture: arch,
			CollectedAt: collected.UTC().Truncate(time.Millisecond)}
		if err := c.web.send(ctx, "check-in", webRequest{HostID: host, Token: token, Report: &report}); err != nil {
			return nil, webRPCError("check-in", host, err)
		}
	} else {
		record, err := readAgent(recordPath(c.stateDir, host))
		if err != nil {
			return nil, err
		}
		if !matches(record.TokenHash, token) {
			return nil, status.Error(codes.Unauthenticated, "invalid agent credential")
		}
	}
	slog.Info("agent check-in", "host", host, "hostname", hostname, "os", osName,
		"architecture", arch, "collectedAt", collected)
	return &emptypb.Empty{}, nil
}

func webRPCError(operation, host string, err error) error {
	switch err {
	case webStatusError(http.StatusForbidden):
		return status.Error(codes.Unauthenticated, "invalid agent credential or enrollment code")
	case webStatusError(http.StatusBadRequest):
		return status.Error(codes.InvalidArgument, "invalid host ID or report")
	default:
		slog.Warn("web API request failed", "operation", operation, "host", host, "error", err)
		return status.Error(codes.Unavailable, "web API unavailable")
	}
}

func validField(value string, limit int) bool {
	return len(value) <= limit && strings.TrimSpace(value) != "" && !strings.ContainsRune(value, 0)
}

func identity(ctx context.Context) (string, string, error) {
	hosts := metadata.ValueFromIncomingContext(ctx, rpc.HostHeader)
	headers := metadata.ValueFromIncomingContext(ctx, "authorization")
	if len(hosts) == 1 && len(headers) == 1 && rpc.ValidHostID(hosts[0]) {
		if token, ok := strings.CutPrefix(headers[0], "Bearer "); ok && rpc.ValidToken(token) {
			return hosts[0], token, nil
		}
	}
	return "", "", status.Error(codes.Unauthenticated, "agent credential required")
}

func readAgent(path string) (agentRecord, error) {
	record, err := readRecord(path)
	if errors.Is(err, os.ErrNotExist) {
		return record, status.Error(codes.Unauthenticated, "unknown agent")
	}
	if err != nil {
		slog.Error("read agent state", "error", err)
		return record, status.Error(codes.Unavailable, "agent store unavailable")
	}
	return record, nil
}
