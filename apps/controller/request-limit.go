package main

import (
	"context"
	"net"
	"net/netip"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

func limitAgentRequests(clock func() time.Time) grpc.UnaryServerInterceptor {
	var lock sync.Mutex
	var resetAt time.Time
	var admitted int
	byAddress := make(map[netip.Addr]int)
	inFlight := make(chan struct{}, 16)

	return func(ctx context.Context, request any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		var address netip.Addr
		if remote, ok := peer.FromContext(ctx); ok {
			if tcp, ok := remote.Addr.(*net.TCPAddr); ok {
				address = tcp.AddrPort().Addr().Unmap().WithZone("")
			}
		}

		select {
		case inFlight <- struct{}{}:
			defer func() { <-inFlight }()
		default:
			return nil, status.Error(codes.ResourceExhausted, "controller is busy")
		}

		lock.Lock()
		now := clock()
		if !now.Before(resetAt) {
			clear(byAddress)
			admitted = 0
			resetAt = now.Add(time.Second)
		}
		allowed := admitted < 120 && byAddress[address] < 30
		if allowed {
			admitted++
			byAddress[address]++
		}
		lock.Unlock()
		if !allowed {
			return nil, status.Error(codes.ResourceExhausted, "controller request rate exceeded")
		}
		return handler(ctx, request)
	}
}
