//go:build !linux

package main

import (
	"errors"
	"os"
)

func validateServiceExecutable(string) error {
	return errors.New("agent service installation requires Linux")
}

func validatePrivilegedInput(string) error { return nil }

func prepareCredentialPath(string, bool) error { return nil }

func openLogDirectory(path string) (*os.Root, error) {
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	return os.OpenRoot(path)
}

func validLogOwner(os.FileInfo) bool { return true }
