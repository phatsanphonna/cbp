package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type deploymentFile struct {
	path    string
	old     []byte
	mode    os.FileMode
	uid     int
	gid     int
	existed bool
}

func prepareManagedTLSDirectory(path string) error {
	if parent := filepath.Dir(path); parent != path {
		if err := prepareManagedTLSDirectory(parent); err != nil {
			return err
		}
		if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("managed TLS path %s must be a root-owned directory protected from other writes", path)
	}
	return nil
}

func readDeploymentFile(path string) (deploymentFile, error) {
	file := deploymentFile{path: path, uid: -1, gid: -1}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return file, nil
	}
	if err != nil {
		return file, err
	}
	if !info.Mode().IsRegular() || info.Size() > 1024*1024 {
		return file, errors.New("deployment destination must be a regular file up to 1 MB")
	}
	file.old, err = os.ReadFile(path)
	file.mode, file.existed = info.Mode().Perm(), true
	stat := info.Sys().(*syscall.Stat_t)
	file.uid, file.gid = int(stat.Uid), int(stat.Gid)
	return file, err
}

func (f deploymentFile) write(data []byte, mode os.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(f.path), ".cbp-deploy-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	err = temp.Chown(f.uid, f.gid)
	if err == nil {
		err = temp.Chmod(mode)
	}
	if err == nil {
		_, err = temp.Write(data)
	}
	if err == nil {
		err = temp.Sync()
	}
	if err = errors.Join(err, temp.Close()); err != nil {
		return err
	}
	return os.Rename(temp.Name(), f.path)
}

func (f deploymentFile) restore() error {
	if f.existed {
		return f.write(f.old, f.mode)
	}
	return os.Remove(f.path)
}

func installDeployment(ctx context.Context, target deploymentTarget, chain, key string) string {
	cert, err := tls.X509KeyPair([]byte(chain), []byte(key))
	if err != nil {
		return "certificate"
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	now := time.Now()
	if err != nil || now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return "certificate"
	}
	if ctx.Err() != nil {
		return "install"
	}
	if target.managedDir != "" {
		if err := prepareManagedTLSDirectory(target.managedDir); err != nil {
			slog.Warn("managed TLS directory unavailable", "error", err)
			return "install"
		}
	}
	certFile, err := readDeploymentFile(target.CertificateFile)
	if err != nil {
		return "install"
	}
	var keyFile deploymentFile
	if target.KeyFile != "" {
		keyFile, err = readDeploymentFile(target.KeyFile)
		if err != nil {
			return "install"
		}
	}
	certMode := os.FileMode(0644)
	if target.KeyFile == "" {
		chain = strings.TrimSpace(chain) + "\n" + key
		certMode = 0600
	}
	if ctx.Err() != nil {
		return "install"
	}
	if err := certFile.write([]byte(chain), certMode); err != nil {
		return "install"
	}
	if target.KeyFile != "" {
		if err := keyFile.write([]byte(key), 0600); err != nil {
			if certFile.restore() != nil {
				return "rollback"
			}
			return "install"
		}
	}

	outcome := "reload"
	if validateService(ctx, target) == nil && reloadService(ctx, target.Engine) == nil {
		if verifyCertificate(ctx, target, cert.Certificate[0]) {
			return "ok"
		}
		outcome = "verify"
	}
	restoreErr := certFile.restore()
	if target.KeyFile != "" {
		restoreErr = errors.Join(restoreErr, keyFile.restore())
	}
	if restoreErr != nil {
		return "rollback"
	}
	rollbackContext, stop := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
	defer stop()
	if validateService(rollbackContext, target) != nil || reloadService(rollbackContext, target.Engine) != nil {
		return "rollback"
	}
	return outcome
}

func validateService(ctx context.Context, target deploymentTarget) error {
	switch target.Engine {
	case "Apache2":
		return exec.CommandContext(ctx, "apache2ctl", "configtest").Run()
	case "Nginx":
		return exec.CommandContext(ctx, "nginx", "-t").Run()
	case "HAProxy":
		return exec.CommandContext(ctx, "haproxy", "-c", "-f", target.ConfigFile).Run()
	default:
		return errors.New("unknown service")
	}
}

func reloadService(ctx context.Context, engine string) error {
	return exec.CommandContext(ctx, "systemctl", "reload", strings.ToLower(engine)).Run()
}

func verifyCertificate(ctx context.Context, target deploymentTarget, leaf []byte) bool {
	ctx, stop := context.WithTimeout(ctx, 15*time.Second)
	defer stop()
	dialer := tls.Dialer{
		NetDialer: &net.Dialer{Timeout: 2 * time.Second},
		Config: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: target.ServerName,
			// Pin the certificate from the authenticated job, including for private CAs.
			InsecureSkipVerify: true,
			VerifyConnection: func(state tls.ConnectionState) error {
				if len(state.PeerCertificates) == 0 || !bytes.Equal(state.PeerCertificates[0].Raw, leaf) {
					return errors.New("endpoint did not present the deployed certificate")
				}
				return nil
			},
		},
	}
	for ctx.Err() == nil {
		conn, err := dialer.DialContext(ctx, "tcp", target.VerifyAddress)
		if err == nil {
			conn.Close()
			return true
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
	return false
}
