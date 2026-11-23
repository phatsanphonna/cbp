package main

import (
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/spf13/pflag"
	"go.yaml.in/yaml/v3"
)

const defaultConfig = "/etc/cbp/cbp.yaml"
const alternateConfig = "/etc/cbp/cbp.yml"

type agentConfig struct {
	Controller         string                      `yaml:"controller"`
	Host               string                      `yaml:"host"`
	CA                 string                      `yaml:"ca"`
	CredentialFile     string                      `yaml:"credentialFile"`
	LogFile            string                      `yaml:"logFile"`
	Interval           string                      `yaml:"interval"`
	DeploymentServices []string                    `yaml:"deploymentServices"`
	DeploymentCAFile   string                      `yaml:"deploymentCAFile"`
	Deployments        map[string]deploymentTarget `yaml:"deployments"`
	deploymentRoots    *x509.CertPool
}

func readConfig(path string) (agentConfig, error) {
	if path != "" {
		return readConfigFile(path)
	}
	config, err := readConfigFile(defaultConfig)
	if errors.Is(err, os.ErrNotExist) {
		config, err = readConfigFile(alternateConfig)
	}
	if errors.Is(err, os.ErrNotExist) {
		return agentConfig{}, nil
	}
	return config, err
}

func readConfigFile(path string) (agentConfig, error) {
	var config agentConfig
	path, err := filepath.Abs(path)
	if err != nil {
		return config, err
	}
	if err := validatePrivilegedInput(path); err != nil {
		return config, err
	}
	file, err := os.Open(path)
	if err != nil {
		return config, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return config, err
	}
	if !info.Mode().IsRegular() || info.Size() > 65536 || (runtime.GOOS == "linux" && info.Mode().Perm()&0022 != 0) {
		return config, errors.New("agent config must be a regular file up to 64 KB and protected from writes by other users")
	}
	return decodeConfig(file, path)
}

func decodeConfig(file io.Reader, path string) (agentConfig, error) {
	var config agentConfig
	decoder := yaml.NewDecoder(io.LimitReader(file, 65536))
	decoder.KnownFields(true)
	if err := decoder.Decode(&config); err != nil {
		return config, fmt.Errorf("invalid agent YAML config %s: %w", path, err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return config, errors.New("agent config must contain a single YAML document")
	}
	return config, nil
}

func applyConfig(flags *pflag.FlagSet, config agentConfig) error {
	for name, value := range map[string]string{
		"controller": config.Controller, "host": config.Host, "ca": config.CA,
		"credential-file": config.CredentialFile, "log-file": config.LogFile, "interval": config.Interval,
	} {
		if flag := flags.Lookup(name); value != "" && flag != nil && !flag.Changed {
			if err := flags.Set(name, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func loadAgentConfig(flags *pflag.FlagSet, options *agentOptions) (agentConfig, error) {
	config, err := readConfig(options.configPath)
	if err != nil {
		return config, err
	}
	return config, applyConfig(flags, config)
}
