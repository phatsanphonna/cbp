package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"time"

	rpc "cbp/agent-rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("controller stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("expected serve, invite or revoke")
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	stateDir := flags.String("state", "controller-state", "private directory for enrollment and agent credentials")
	switch args[0] {
	case "serve":
		address := flags.String("listen", "127.0.0.1:50051", "gRPC address")
		certFile := flags.String("tls-cert", "", "controller TLS certificate chain in PEM format")
		keyFile := flags.String("tls-key", "", "controller TLS private key in PEM format")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *certFile == "" || *keyFile == "" {
			return errors.New("-tls-cert and -tls-key are required")
		}
		cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
		if err != nil {
			return err
		}
		web, err := webFromEnv()
		if err != nil {
			return err
		}
		if web == nil {
			if err := os.MkdirAll(*stateDir, 0700); err != nil {
				return err
			}
		}
		listener, err := net.Listen("tcp", *address)
		if err != nil {
			return err
		}
		server := grpc.NewServer(
			grpc.Creds(credentials.NewTLS(&tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			})),
			grpc.MaxRecvMsgSize(16*1024),
		)
		rpc.RegisterController(server, &controller{stateDir: *stateDir, web: web})
		if web != nil {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			go web.reportHealth(ctx)
		}
		slog.Info("controller listening", "address", listener.Addr(), "webConnectedMode", web != nil)
		return server.Serve(listener)

	case "invite", "revoke":
		host := flags.String("host", "", "registered host ID")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if !rpc.ValidHostID(*host) {
			return errors.New("-host must be a lower-case host ID, up to 64 characters")
		}
		web, err := webFromEnv()
		if err != nil {
			return err
		}
		if web != nil {
			payload := webRequest{HostID: *host}
			if args[0] == "invite" {
				payload.Code = rpc.NewToken()
			}
			if err := web.send(context.Background(), args[0], payload); err != nil {
				return err
			}
			if payload.Code != "" {
				fmt.Println(payload.Code)
			}
			return nil
		}
		path := recordPath(*stateDir, *host)
		if args[0] == "revoke" {
			return os.Remove(path)
		}

		record, err := readRecord(path)
		if err == nil && (record.TokenHash != "" || time.Now().Before(record.ExpiresAt)) {
			return errors.New("host already has an active enrollment code or agent credential")
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := os.MkdirAll(*stateDir, 0700); err != nil {
			return err
		}
		token := rpc.NewToken()
		if err := writeRecord(path, agentRecord{
			InviteHash: digest(token),
			ExpiresAt:  time.Now().Add(15 * time.Minute),
		}); err != nil {
			return err
		}
		fmt.Println(token)
		return nil
	default:
		return errors.New("expected serve, invite or revoke")
	}
}
