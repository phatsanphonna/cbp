package main

import (
	"errors"
	"net"
	"testing"
	"time"
)

func TestAgentConnectionLimitsReleaseCapacity(t *testing.T) {
	for _, limits := range []struct {
		name          string
		total, source int
	}{
		{name: "global", total: 1, source: 2},
		{name: "source", total: 2, source: 1},
	} {
		t.Run(limits.name, func(t *testing.T) {
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			limited := limitAgentConnections(listener, limits.total, limits.source)
			dial := func() net.Conn {
				t.Helper()
				conn, err := net.DialTimeout("tcp4", listener.Addr().String(), 2*time.Second)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = conn.Close() })
				return conn
			}

			dial()
			first, err := limited.Accept()
			if err != nil {
				t.Fatal(err)
			}
			defer first.Close()

			rejected := dial()
			accepted := make(chan net.Conn, 1)
			go func() {
				conn, err := limited.Accept()
				if err == nil {
					accepted <- conn
				}
			}()
			if err := rejected.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			var timeout net.Error
			if _, err := rejected.Read(make([]byte, 1)); err == nil || (errors.As(err, &timeout) && timeout.Timeout()) {
				t.Fatalf("expected the excess connection to close, got %v", err)
			}

			_ = first.Close()
			_ = first.Close()
			replacement := dial()
			select {
			case conn := <-accepted:
				defer conn.Close()
				if got := conn.RemoteAddr().String(); got != replacement.LocalAddr().String() {
					t.Fatalf("accepted %s, expected %s", got, replacement.LocalAddr())
				}
			case <-time.After(2 * time.Second):
				t.Fatal("closing the first connection did not release capacity")
			}
		})
	}
}
