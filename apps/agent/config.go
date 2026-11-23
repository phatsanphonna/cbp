package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"

	"go.yaml.in/yaml/v3"
)

const defaultConfig = "/etc/cbp/cbp.yaml"
const alternateConfig = "/etc/cbp/cbp.yml"

type agentConfig struct {
	Controller         string                      `yaml:"controller"`
	Host               string                      `yaml:"host"`
	CA                 string                      `yaml:"ca"`
	CredentialFile     string                      `yaml:"credentialFile"`
	Interval           string                      `yaml:"interval"`
	DeploymentServices []string                    `yaml:"deploymentServices"`
	Deployments        map[string]deploymentTarget `yaml:"deployments"`
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

func applyConfig(flags *flag.FlagSet, config agentConfig) error {
	explicit := make(map[string]bool)
	flags.Visit(func(f *flag.Flag) { explicit[f.Name] = true })
	for name, value := range map[string]string{
		"controller": config.Controller, "host": config.Host, "ca": config.CA,
		"credential-file": config.CredentialFile, "interval": config.Interval,
	} {
		if value != "" && !explicit[name] {
			if err := flags.Set(name, value); err != nil {
				return err
			}
		}
	}
	return nil
}
