package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/sirupsen/logrus"
)

const systemAgentLogDirectory = "/var/log/cbp"

func configureAgentLogging(path, credentialPath string) error {
	if path == "" {
		path = filepath.Join(filepath.Dir(credentialPath), "agent.log")
		if runtime.GOOS == "linux" && os.Geteuid() == 0 {
			path = systemAgentLogDirectory + "/agent.log"
		}
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if path == credentialPath {
		return errors.New("agent log and credential must use different files")
	}
	if existing, err := os.Stat(path); err == nil {
		if credential, err := os.Stat(credentialPath); err == nil && os.SameFile(existing, credential) {
			return errors.New("agent log and credential must use different files")
		}
	}
	file, err := openAgentLog(path)
	if err != nil {
		return fmt.Errorf("open agent log: %w", err)
	}
	// Keep the log open for the process lifetime so the final error reaches both outputs.
	logrus.SetOutput(io.MultiWriter(file, os.Stderr))
	return nil
}

func openAgentLog(path string) (*os.File, error) {
	directory, err := openLogDirectory(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	name := filepath.Base(path)
	info, err := directory.Lstat(name)
	if err == nil {
		if !info.Mode().IsRegular() || !validLogOwner(info) || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
			return nil, fmt.Errorf("agent log must be a private regular file: %s", path)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return directory.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
}
