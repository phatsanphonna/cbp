package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

type probeHost struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type hostProbe struct {
	HostID    string    `json:"hostId"`
	Status    string    `json:"status"`
	Address   *string   `json:"address"`
	CheckedAt time.Time `json:"checkedAt"`
}

const windowsProbe = `
try {
  $ping = New-Object System.Net.NetworkInformation.Ping
  try {
    if ($ping.Send($env:CBP_PING_TARGET, 1500).Status -ne 'Success') { exit 1 }
  } finally { $ping.Dispose() }
} catch { exit 2 }
`

func (w *webClient) probeHosts(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		if err := w.probeInventory(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("controller host probe failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *webClient) probeInventory(ctx context.Context) error {
	var after string
	for ctx.Err() == nil {
		var hosts []probeHost
		if err := w.request(ctx, "probe-hosts", webRequest{After: after}, &hosts); err != nil {
			return err
		}
		results := make([]hostProbe, len(hosts))
		var workers sync.WaitGroup
		slots := make(chan struct{}, 24)
		for i, host := range hosts {
			slots <- struct{}{}
			workers.Go(func() {
				defer func() { <-slots }()
				results[i] = pingHost(ctx, host)
			})
		}
		workers.Wait()
		for start := 0; start < len(results); start += 12 {
			if err := w.send(ctx, "probe-results", webRequest{Probes: results[start:min(start+12, len(results))]}); err != nil {
				return err
			}
		}
		if len(hosts) < 200 {
			return nil
		}
		after = hosts[len(hosts)-1].ID
	}
	return ctx.Err()
}

func pingHost(ctx context.Context, host probeHost) hostProbe {
	result := hostProbe{HostID: host.ID, Status: "unavailable", CheckedAt: time.Now().UTC()}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	address, err := netip.ParseAddr(host.Name)
	if err != nil {
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host.Name)
		if err != nil || len(addresses) == 0 {
			return result
		}
		address = addresses[0]
	}
	if address.Zone() != "" {
		return result
	}
	target := address.Unmap().String()
	result.Address = &target
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", windowsProbe)
		command.Env = append(os.Environ(), "CBP_PING_TARGET="+target)
	case "linux":
		command = exec.CommandContext(ctx, "ping", "-n", "-c", "1", "-W", "2", target)
	default:
		return result
	}
	err = command.Run()
	var exit *exec.ExitError
	if err == nil {
		result.Status = "reachable"
	} else if errors.As(err, &exit) && exit.ExitCode() == 1 && ctx.Err() == nil {
		result.Status = "no-reply"
	}
	return result
}
