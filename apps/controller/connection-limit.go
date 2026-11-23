package main

import (
	"net"
	"net/netip"
	"sync"
)

type agentListener struct {
	net.Listener
	totalLimit, sourceLimit int
	mu                      sync.Mutex
	total                   int
	bySource                map[netip.Prefix]int
}

func limitAgentConnections(listener net.Listener, totalLimit, sourceLimit int) net.Listener {
	return &agentListener{
		Listener: listener, totalLimit: totalLimit, sourceLimit: sourceLimit,
		bySource: make(map[netip.Prefix]int),
	}
}

func (l *agentListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		address := conn.RemoteAddr().(*net.TCPAddr).AddrPort().Addr().Unmap().WithZone("")
		bits := 32
		if address.Is6() {
			bits = 64
		}
		source := netip.PrefixFrom(address, bits).Masked()
		l.mu.Lock()
		if l.total < l.totalLimit && l.bySource[source] < l.sourceLimit {
			l.total++
			l.bySource[source]++
			l.mu.Unlock()
			return &agentConnection{Conn: conn, release: func() { l.release(source) }}, nil
		}
		l.mu.Unlock()
		_ = conn.Close()
	}
}

func (l *agentListener) release(source netip.Prefix) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.total--
	l.bySource[source]--
	if l.bySource[source] == 0 {
		delete(l.bySource, source)
	}
}

type agentConnection struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *agentConnection) Close() error {
	err := c.Conn.Close()
	c.once.Do(c.release)
	return err
}
