package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	rpc "cbp/agent-rpc"
	"github.com/sirupsen/logrus"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

func unregisterAgent(ctx context.Context, options agentOptions) error {
	if !rpc.ValidHostID(options.host) || options.credentialFile == "" {
		return errors.New("unregister needs the enrolled host ID and credential file from the managed service, agent YAML, or --host and --credential-file")
	}
	path, err := filepath.Abs(options.credentialFile)
	if err != nil {
		return err
	}
	if err := prepareCredentialPath(path, false); err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return errors.New("local agent credential is missing; use Reset enrollment in CBP to revoke any remaining enrollment")
	}
	if err != nil {
		return err
	}
	token := string(data)
	if !rpc.ValidToken(token) {
		return errors.New("invalid agent credential file")
	}
	conn, err := connectAgent(options, token)
	if err != nil {
		return err
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := conn.Invoke(ctx, rpc.UnregisterMethod, &emptypb.Empty{}, &emptypb.Empty{}); err != nil {
		if status.Code(err) == codes.Unimplemented {
			return errors.New("upgrade the controller before using unregister")
		}
		return fmt.Errorf("unregister agent: %w", err)
	}
	current, err := os.ReadFile(path)
	if err == nil {
		if string(current) != token {
			return errors.New("enrollment was revoked, but the local credential changed during unregister")
		}
		err = os.Remove(path)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("enrollment was revoked, but the local credential could not be removed: %w", err)
	}
	logrus.WithField("host", options.host).Info("agent unregistered")
	return nil
}
