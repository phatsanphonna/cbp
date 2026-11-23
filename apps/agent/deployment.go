package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	rpc "cbp/agent-rpc"
	"github.com/sirupsen/logrus"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
)

type deploymentTarget struct {
	Engine          string `yaml:"engine"`
	CertificateFile string `yaml:"certificateFile"`
	KeyFile         string `yaml:"keyFile"`
	ConfigFile      string `yaml:"configFile"`
	VerifyAddress   string `yaml:"verifyAddress"`
	ServerName      string `yaml:"serverName"`
	managedDir      string
	roots           *x509.CertPool
}

const managedTLSRoot = "/etc/cbp/tls"

var managedDNSName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$`)

func validAddress(address string) bool {
	host, port, err := net.SplitHostPort(address)
	number, numberErr := strconv.Atoi(port)
	return err == nil && numberErr == nil && host != "" && number > 0 && number <= 65535
}

func (config agentConfig) deploymentEnabled() bool {
	if config.DeploymentServices != nil {
		return len(config.DeploymentServices) > 0
	}
	return len(config.Deployments) > 0
}

func canonicalDeploymentService(engine string) string {
	switch strings.ToLower(engine) {
	case "apache2":
		return "Apache2"
	case "nginx":
		return "Nginx"
	case "haproxy":
		return "HAProxy"
	default:
		return ""
	}
}

func (config agentConfig) validateDeployments() error {
	if (len(config.DeploymentServices) > 0 || len(config.Deployments) > 0) && runtime.GOOS != "linux" {
		return errors.New("certificate deployment is supported on Linux")
	}
	for _, engine := range config.DeploymentServices {
		if canonicalDeploymentService(engine) == "" {
			return fmt.Errorf("unsupported deployment service %q", engine)
		}
	}
	for endpoint, target := range config.Deployments {
		if target.Engine == "" && config.DeploymentServices != nil {
			if !validAddress(endpoint) || (target.VerifyAddress != "" && !validAddress(target.VerifyAddress)) {
				return fmt.Errorf("deployment target %s: invalid endpoint or verification address", endpoint)
			}
			continue
		}
		if _, err := configureDeploymentTarget(endpoint, target); err != nil {
			return fmt.Errorf("deployment target %s: %w", endpoint, err)
		}
	}
	return nil
}

func (config agentConfig) deploymentTarget(endpoint, engine string) (deploymentTarget, error) {
	target := config.Deployments[endpoint]
	matchesOverride := target.Engine != "" && strings.EqualFold(target.Engine, engine)
	// Older configurations authorize only their explicitly configured endpoints.
	if config.DeploymentServices == nil {
		if !matchesOverride {
			return target, errors.New("endpoint and service are not enabled for deployment")
		}
	} else if !slices.ContainsFunc(config.DeploymentServices, func(allowed string) bool { return strings.EqualFold(allowed, engine) }) ||
		(target.Engine != "" && !matchesOverride) {
		return target, errors.New("service is not enabled for deployment at this endpoint")
	}
	target.Engine = engine
	target.roots = config.deploymentRoots
	return configureDeploymentTarget(endpoint, target)
}

func configureDeploymentTarget(endpoint string, target deploymentTarget) (deploymentTarget, error) {
	target.Engine = canonicalDeploymentService(target.Engine)
	if target.Engine == "" {
		return target, errors.New("unsupported deployment engine")
	}
	if !validAddress(endpoint) || (target.VerifyAddress != "" && !validAddress(target.VerifyAddress)) {
		return target, errors.New("invalid deployment endpoint or verification address")
	}
	host, port, _ := net.SplitHostPort(endpoint)
	number, _ := strconv.Atoi(port)
	if target.ServerName == "" {
		target.ServerName = host
	}
	if target.VerifyAddress == "" {
		loopback := "127.0.0.1"
		if ip, err := netip.ParseAddr(host); err == nil && ip.Is6() && !ip.Is4In6() {
			loopback = "::1"
		}
		target.VerifyAddress = net.JoinHostPort(loopback, strconv.Itoa(number))
	}
	if target.CertificateFile == "" && target.KeyFile == "" {
		if ip, err := netip.ParseAddr(host); err == nil && ip.Zone() == "" {
			host = ip.String()
		} else {
			host = strings.ToLower(strings.TrimSuffix(host, "."))
			if len(host) > 253 || !managedDNSName.MatchString(host) {
				return target, errors.New("use a DNS name or IP address for the managed TLS directory")
			}
		}
		target.managedDir = filepath.Join(managedTLSRoot, host)
		if number != 443 {
			target.managedDir = filepath.Join(target.managedDir, strconv.Itoa(number))
		}
		if target.Engine == "HAProxy" {
			target.CertificateFile = filepath.Join(target.managedDir, "haproxy.pem")
		} else {
			target.CertificateFile = filepath.Join(target.managedDir, "fullchain.pem")
			target.KeyFile = filepath.Join(target.managedDir, "privkey.pem")
		}
	} else if !filepath.IsAbs(target.CertificateFile) ||
		(target.KeyFile != "" && (!filepath.IsAbs(target.KeyFile) ||
			filepath.Clean(target.KeyFile) == filepath.Clean(target.CertificateFile))) {
		return target, errors.New("certificate and key destinations must be distinct absolute paths")
	} else {
		target.CertificateFile = filepath.Clean(target.CertificateFile)
		if target.KeyFile != "" {
			target.KeyFile = filepath.Clean(target.KeyFile)
		}
	}
	switch target.Engine {
	case "Apache2", "Nginx":
		if target.KeyFile == "" || target.ConfigFile != "" {
			return target, errors.New("Apache2 and Nginx require a key file and use the default service configuration")
		}
	case "HAProxy":
		if target.KeyFile != "" || (target.ConfigFile != "" && !filepath.IsAbs(target.ConfigFile)) {
			return target, errors.New("HAProxy requires a combined PEM and an absolute config file path")
		}
		if target.ConfigFile == "" {
			target.ConfigFile = "/etc/haproxy/haproxy.cfg"
		} else {
			target.ConfigFile = filepath.Clean(target.ConfigFile)
		}
	}
	return target, nil
}

func loadDeploymentRoots(path string) (*x509.CertPool, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := validatePrivilegedInput(path); err != nil {
		return nil, err
	}
	pem, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return nil, err
	}
	if !roots.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("deployment CA file contains no PEM certificates: %s", path)
	}
	return roots, nil
}

func verifyDeploymentChain(chain [][]byte, target deploymentTarget) error {
	leaf, err := x509.ParseCertificate(chain[0])
	if err != nil {
		return err
	}
	intermediates := x509.NewCertPool()
	for _, raw := range chain[1:] {
		certificate, err := x509.ParseCertificate(raw)
		if err != nil {
			return err
		}
		intermediates.AddCert(certificate)
	}
	_, err = leaf.Verify(x509.VerifyOptions{DNSName: target.ServerName, Roots: target.roots, Intermediates: intermediates})
	return err
}

func certificateDiagnostic(err error, at time.Time) string {
	detail := fmt.Sprintf("%s WARN deployment certificate verification failed error=%q", at.Format("2006/01/02 15:04:05 Z07:00"), err.Error())
	if len(detail) > rpc.MaxDeploymentDiagnosticBytes {
		const ellipsis = "…"
		end := rpc.MaxDeploymentDiagnosticBytes - len(ellipsis)
		for !utf8.RuneStart(detail[end]) {
			end--
		}
		detail = detail[:end] + ellipsis
	}
	return detail
}

func deployPending(ctx context.Context, conn *grpc.ClientConn, config agentConfig) error {
	claimContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	var job structpb.Struct
	err := conn.Invoke(claimContext, rpc.ClaimDeploymentMethod, &emptypb.Empty{}, &job)
	cancel()
	if err != nil {
		return err
	}
	fields := job.GetFields()
	id := fields["id"].GetStringValue()
	if id == "" {
		return nil
	}
	endpoint := fields["endpoint"].GetStringValue()
	target, targetErr := config.deploymentTarget(endpoint, fields["engine"].GetStringValue())
	outcome := "configuration"
	var verificationErr error
	if targetErr == nil {
		installContext, stop := context.WithTimeout(ctx, 90*time.Second)
		outcome, verificationErr = installDeployment(installContext, target, fields["fullchain"].GetStringValue(), fields["privateKey"].GetStringValue())
		stop()
	} else {
		logrus.WithError(targetErr).Warn("deployment target rejected")
	}
	result := map[string]any{"jobId": id, "outcome": outcome}
	if verificationErr != nil {
		result["diagnostic"] = certificateDiagnostic(verificationErr, time.Now())
	}
	reply, _ := structpb.NewStruct(result)
	reportContext, stop := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
	defer stop()
	for attempt := 0; attempt < 3; attempt++ {
		callContext, finish := context.WithTimeout(reportContext, 7*time.Second)
		err = conn.Invoke(callContext, rpc.FinishDeploymentMethod, reply, &emptypb.Empty{})
		finish()
		if status.Code(err) != codes.Unavailable && status.Code(err) != codes.DeadlineExceeded && status.Code(err) != codes.ResourceExhausted {
			return err
		}
		if status.Code(err) == codes.ResourceExhausted {
			select {
			case <-reportContext.Done():
				return err
			case <-time.After(time.Second):
			}
		}
	}
	return err
}
