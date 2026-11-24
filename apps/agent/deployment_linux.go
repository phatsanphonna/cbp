package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
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

func readDeploymentFile(path string) (deploymentFile, error) {
	file := deploymentFile{path: path, uid: -1, gid: -1}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return file, nil
	}
	if err != nil {
		return file, err
	}
	if !info.Mode().IsRegular() || !rootProtected(info) || info.Size() > 1024*1024 {
		return file, errors.New("deployment destination must be a protected root-owned regular file up to 1 MB")
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

// Return a diagnostic error only when it comes from verifying the public certificate chain.
func installDeployment(ctx context.Context, target deploymentTarget, chain, key string, logStep func(string)) (string, error) {
	logStep("Validating certificate and private key")
	cert, err := tls.X509KeyPair([]byte(chain), []byte(key))
	if err != nil {
		logStep("Certificate and private key validation failed: " + err.Error())
		return "certificate", nil
	}
	if err := verifyDeploymentChain(cert.Certificate, target); err != nil {
		slog.Warn("deployment certificate verification failed", "error", err)
		logStep("Certificate chain verification failed: " + err.Error())
		return "certificate", err
	}
	if ctx.Err() != nil {
		return "install", nil
	}
	if target.managedDir != "" {
		logStep("Checking managed certificate directory")
		if err := protectedDirectory(target.managedDir, true); err != nil {
			slog.Warn("managed TLS directory unavailable", "error", err)
			logStep("Managed TLS directory check failed: " + err.Error())
			return "install", nil
		}
	}
	if err := protectedDirectory(filepath.Dir(target.CertificateFile), false); err != nil {
		logStep("Certificate destination check failed: " + err.Error())
		return "configuration", nil
	}
	if target.KeyFile != "" {
		if err := protectedDirectory(filepath.Dir(target.KeyFile), false); err != nil {
			logStep("Private key destination check failed: " + err.Error())
			return "configuration", nil
		}
	}
	if target.ConfigFile != "" {
		if err := validateProtectedFile(target.ConfigFile); err != nil {
			logStep("Service configuration file check failed: " + err.Error())
			return "configuration", nil
		}
	}
	certFile, err := readDeploymentFile(target.CertificateFile)
	if err != nil {
		logStep("Could not inspect the existing certificate file: " + err.Error())
		return "install", nil
	}
	var keyFile deploymentFile
	if target.KeyFile != "" {
		keyFile, err = readDeploymentFile(target.KeyFile)
		if err != nil {
			logStep("Could not inspect the existing private key file: " + err.Error())
			return "install", nil
		}
	}
	certMode := os.FileMode(0644)
	if target.KeyFile == "" {
		chain = strings.TrimSpace(chain) + "\n" + key
		certMode = 0600
	}
	if ctx.Err() != nil {
		return "install", nil
	}
	logStep("Installing certificate files")
	if err := certFile.write([]byte(chain), certMode); err != nil {
		logStep("Could not install the certificate file: " + err.Error())
		return "install", nil
	}
	if target.KeyFile != "" {
		if err := keyFile.write([]byte(key), 0600); err != nil {
			logStep("Could not install the private key file: " + err.Error())
			if certFile.restore() != nil {
				logStep("Could not restore the previous certificate file after the key write failed")
				return "rollback", nil
			}
			return "install", nil
		}
	}

	outcome := "reload"
	logStep("Validating service configuration")
	if err := validateService(ctx, target); err != nil {
		logStep("Service configuration validation failed: " + err.Error())
	} else if err := reloadService(ctx, target.Engine); err != nil {
		logStep("Service reload failed: " + err.Error())
	} else {
		logStep("Reloaded service; verifying the served certificate")
		if verifyCertificate(ctx, target, cert.Certificate[0]) {
			return "ok", nil
		}
		logStep("TLS verification failed: the endpoint did not present the deployed certificate before the verification deadline")
		outcome = "verify"
	}
	logStep("Restoring previous certificate files")
	restoreErr := certFile.restore()
	if target.KeyFile != "" {
		restoreErr = errors.Join(restoreErr, keyFile.restore())
	}
	if restoreErr != nil {
		logStep("Could not restore the previous certificate files: " + restoreErr.Error())
		return "rollback", nil
	}
	rollbackContext, stop := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
	defer stop()
	if err := validateService(rollbackContext, target); err != nil {
		logStep("Rollback service validation failed: " + err.Error())
		return "rollback", nil
	}
	if err := reloadService(rollbackContext, target.Engine); err != nil {
		logStep("Could not reload the service after restoring previous files: " + err.Error())
		return "rollback", nil
	}
	return outcome, nil
}

func validateService(ctx context.Context, target deploymentTarget) error {
	switch target.Engine {
	case "Apache2":
		return runDeploymentCommand(ctx, "apache2ctl", "configtest")
	case "Nginx":
		return runDeploymentCommand(ctx, "nginx", "-t")
	case "HAProxy":
		return runDeploymentCommand(ctx, "haproxy", "-c", "-f", target.ConfigFile)
	default:
		return errors.New("unknown service")
	}
}

func runDeploymentCommand(ctx context.Context, name string, args ...string) error {
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err == nil {
		return nil
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 700 {
		detail = detail[:700] + "…"
	}
	if detail == "" {
		return err
	}
	return errors.Join(err, errors.New(detail))
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
			RootCAs:    target.roots,
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
