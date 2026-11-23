package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"time"

	rpc "cbp/agent-rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type agentCredential struct {
	host  string
	token string
}

func (c agentCredential) GetRequestMetadata(context.Context, ...string) (map[string]string, error) {
	return map[string]string{
		rpc.HostHeader:  c.host,
		"authorization": "Bearer " + c.token,
	}, nil
}

func (agentCredential) RequireTransportSecurity() bool { return true }

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		slog.Error("agent stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("agent", flag.ContinueOnError)
	address := flags.String("controller", "localhost:50051", "controller host and port")
	host := flags.String("host", "", "registered host ID")
	ca := flags.String("ca", "", "private controller CA certificate in PEM format")
	credentialFile := flags.String("credential-file", "", "private file for the agent credential")
	interval := flags.Duration("interval", time.Minute, "time between check-ins")
	once := flags.Bool("once", false, "check in once and exit")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if !rpc.ValidHostID(*host) || *credentialFile == "" || *interval <= 0 {
		return errors.New("provide a valid -host, -credential-file and positive -interval")
	}
	code := os.Getenv("CBP_AGENT_ENROLLMENT_CODE")
	if code != "" && !rpc.ValidToken(code) {
		return errors.New("CBP_AGENT_ENROLLMENT_CODE is malformed")
	}
	token, err := loadCredential(*credentialFile, code != "")
	if err != nil {
		return err
	}
	tlsCreds := credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	if *ca != "" {
		tlsCreds, err = credentials.NewClientTLSFromFile(*ca, "")
		if err != nil {
			return err
		}
	}
	conn, err := grpc.NewClient(*address, grpc.WithTransportCredentials(tlsCreds),
		grpc.WithPerRPCCredentials(agentCredential{host: *host, token: token}))
	if err != nil {
		return err
	}
	defer conn.Close()

	hostname, err := os.Hostname()
	if err != nil {
		return err
	}
	for ctx.Err() == nil {
		err := checkIn(ctx, conn, hostname)
		if status.Code(err) == codes.Unauthenticated && code != "" {
			err = enroll(ctx, conn, code)
			if err == nil {
				err = checkIn(ctx, conn, hostname)
			}
		}
		if err == nil {
			code = ""
			slog.Info("check-in accepted")
		}
		if ctx.Err() != nil {
			return nil
		}
		if *once || status.Code(err) == codes.Unauthenticated || status.Code(err) == codes.InvalidArgument {
			return err
		}
		if err != nil {
			slog.Warn("check-in failed", "error", err)
		}
		timer := time.NewTimer(*interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}

func enroll(ctx context.Context, conn *grpc.ClientConn, code string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Invoke(ctx, rpc.EnrollMethod, wrapperspb.String(code), &emptypb.Empty{})
}

func checkIn(ctx context.Context, conn *grpc.ClientConn, hostname string) error {
	report, err := structpb.NewStruct(map[string]any{
		"hostname":        hostname,
		"operatingSystem": runtime.GOOS,
		"architecture":    runtime.GOARCH,
		"collectedAt":     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Invoke(ctx, rpc.CheckInMethod, report, &emptypb.Empty{})
}

func loadCredential(path string, enrolling bool) (string, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		if !rpc.ValidToken(string(data)) {
			return "", errors.New("invalid agent credential file")
		}
		return string(data), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if !enrolling {
		return "", errors.New("credential file missing; set CBP_AGENT_ENROLLMENT_CODE to enroll")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	token := rpc.NewToken()
	_, writeErr := file.WriteString(token)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if err := errors.Join(writeErr, file.Close()); err != nil {
		os.Remove(path)
		return "", err
	}
	return token, nil
}
