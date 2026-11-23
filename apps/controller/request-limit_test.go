package main

import (
	"context"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

func TestAgentRequestLimit(t *testing.T) {
	now := time.Now()
	limit := limitAgentRequests(func() time.Time { return now })
	ctx := peer.NewContext(t.Context(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.10"), Port: 1000}})
	other := peer.NewContext(t.Context(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.11"), Port: 1000}})
	handler := func(context.Context, any) (any, error) { return nil, nil }
	for range 30 {
		if _, err := limit(ctx, nil, nil, handler); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := limit(ctx, nil, nil, handler); status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected throttled request, got %v", err)
	}
	if _, err := limit(other, nil, nil, handler); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	if _, err := limit(ctx, nil, nil, handler); err != nil {
		t.Fatal(err)
	}
}
