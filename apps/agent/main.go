package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	rpc "cbp/agent-rpc"
	"github.com/spf13/pflag"
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

const deploymentPollInterval = 5 * time.Second

func (c agentCredential) GetRequestMetadata(context.Context, ...string) (map[string]string, error) {
	return map[string]string{
		rpc.HostHeader:  c.host,
		"authorization": "Bearer " + c.token,
	}, nil
}

func (agentCredential) RequireTransportSecurity() bool { return true }

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		slog.Error("agent stopped", "error", err)
		if status.Code(err) == codes.Unauthenticated {
			// The credential was revoked or never enrolled; restarting cannot fix it.
			os.Exit(unauthenticatedExitCode)
		}
		os.Exit(1)
	}
}

const unauthenticatedExitCode = 3

func runAgent(ctx context.Context, flags *pflag.FlagSet, options *agentOptions) error {
	config, err := loadAgentConfig(flags, options)
	if err != nil {
		return err
	}
	if err := config.validateDeployments(); err != nil {
		return err
	}
	if config.DeploymentCAFile != "" {
		config.deploymentRoots, err = loadDeploymentRoots(config.DeploymentCAFile)
		if err != nil {
			return err
		}
	}
	if !rpc.ValidHostID(options.host) || options.credentialFile == "" || options.interval <= 0 {
		return errors.New("provide a valid --host, --credential-file and positive --interval")
	}
	if options.installService {
		if err := checkAgentServiceSupport(); err != nil {
			return err
		}
	}
	once := options.once || options.installService
	code := os.Getenv("CBP_AGENT_ENROLLMENT_CODE")
	if code != "" && !rpc.ValidToken(code) {
		return errors.New("CBP_AGENT_ENROLLMENT_CODE is malformed")
	}
	credentialPath, err := filepath.Abs(options.credentialFile)
	if err != nil {
		return err
	}
	if err := prepareCredentialPath(credentialPath, code != ""); err != nil {
		return err
	}
	if err := configureAgentLogging(options.logFile, credentialPath); err != nil {
		return err
	}
	token, err := loadCredential(credentialPath, code != "")
	if err != nil {
		return err
	}
	conn, err := connectAgent(*options, token)
	if err != nil {
		return err
	}
	defer conn.Close()

	hostname, err := os.Hostname()
	if err != nil {
		return err
	}
	var listenerTargets *structpb.Struct
	deploymentPolling := false
	for ctx.Err() == nil {
		reply, err := checkIn(ctx, conn, hostname, config, listenerTargets)
		if status.Code(err) == codes.Unauthenticated && code != "" {
			err = enroll(ctx, conn, code)
			if err == nil {
				reply, err = checkIn(ctx, conn, hostname, config, listenerTargets)
			}
		}
		if err == nil {
			listenerTargets = reply
			code = ""
			slog.Info("check-in accepted")
			if options.once && config.deploymentEnabled() {
				if err := deployPending(ctx, conn, config); err != nil && ctx.Err() == nil {
					slog.Warn("deployment RPC failed", "code", status.Code(err))
				}
			} else if !once && !deploymentPolling && config.deploymentEnabled() {
				deploymentPolling = true
				go pollDeployments(ctx, conn, config)
			}
		}
		if ctx.Err() != nil {
			return nil
		}
		if options.installService && err == nil {
			return installAgentService(ctx, flags)
		}
		switch status.Code(err) {
		case codes.Unauthenticated, codes.InvalidArgument, codes.FailedPrecondition:
			return err
		}
		if once {
			return err
		}
		if err != nil {
			slog.Warn("check-in failed", "error", err)
		}
		timer := time.NewTimer(options.interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}

func pollDeployments(ctx context.Context, conn *grpc.ClientConn, config agentConfig) {
	poll := func() {
		if err := deployPending(ctx, conn, config); err != nil && ctx.Err() == nil {
			slog.Warn("deployment RPC failed", "code", status.Code(err))
		}
	}
	poll()
	ticker := time.NewTicker(deploymentPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll()
		}
	}
}

func connectAgent(options agentOptions, token string) (*grpc.ClientConn, error) {
	transport := credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	if options.ca != "" {
		caPath, err := filepath.Abs(options.ca)
		if err != nil {
			return nil, err
		}
		if err := validatePrivilegedInput(caPath); err != nil {
			return nil, err
		}
		transport, err = credentials.NewClientTLSFromFile(caPath, "")
		if err != nil {
			return nil, err
		}
	}
	return grpc.NewClient(options.address, grpc.WithTransportCredentials(transport),
		grpc.WithPerRPCCredentials(agentCredential{host: options.host, token: token}))
}

func enroll(ctx context.Context, conn *grpc.ClientConn, code string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Invoke(ctx, rpc.EnrollMethod, wrapperspb.String(code), &emptypb.Empty{})
}

func checkIn(ctx context.Context, conn *grpc.ClientConn, hostname string, config agentConfig, targets *structpb.Struct) (*structpb.Struct, error) {
	listeners := config.checkListeners(ctx, targets.GetFields()["listenerTargets"].GetListValue().GetValues())
	report, err := structpb.NewStruct(map[string]any{
		"hostname":        hostname,
		"operatingSystem": operatingSystemName(),
		"architecture":    runtime.GOARCH,
		"collectedAt":     time.Now().UTC().Format(time.RFC3339Nano),
		"allowedServices": config.allowedDeploymentServices(),
		"serviceVersions": config.deploymentServiceVersions(ctx),
		"listenerResults": listeners,
		"listenerCursor":  targets.GetFields()["nextListenerCursor"].GetStringValue(),
	})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var reply structpb.Struct
	if err := conn.Invoke(ctx, rpc.CheckInMethod, report, &reply); err != nil {
		return nil, err
	}
	return &reply, nil
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
