package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func validateServiceExecutable(path string) error {
	if err := validateProtectedFile(path); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err == nil && info.Mode().Perm()&0100 == 0 {
		return fmt.Errorf("agent service executable lacks owner execute permission: %s", path)
	}
	return err
}

func validatePrivilegedInput(path string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	return validateProtectedFile(path)
}

func openLogDirectory(path string) (*os.Root, error) {
	if os.Geteuid() != 0 {
		if err := os.MkdirAll(path, 0700); err != nil {
			return nil, err
		}
		return os.OpenRoot(path)
	}
	if path == systemAgentLogDirectory {
		if err := protectedDirectory("/var", false); err != nil {
			return nil, err
		}
		return openSystemLogDirectory("/var/log")
	}
	if err := protectedDirectory(path, true); err != nil {
		return nil, err
	}
	return os.OpenRoot(path)
}

func openSystemLogDirectory(path string) (*os.Root, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	// Distribution logging groups may write into /var/log. Pin a protected child before opening the log.
	if !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0002 != 0 {
		return nil, fmt.Errorf("system log directory must be root-owned and protected from public writes: %s", path)
	}
	parent, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	if err := parent.Mkdir("cbp", 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err = parent.Lstat("cbp")
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || !rootProtected(info) {
		return nil, fmt.Errorf("agent log directory must be root-owned and protected from other writes: %s", filepath.Join(path, "cbp"))
	}
	child, err := parent.OpenRoot("cbp")
	if err != nil {
		return nil, err
	}
	openedInfo, err := child.Stat(".")
	if err != nil || !rootProtected(openedInfo) || !os.SameFile(info, openedInfo) {
		child.Close()
		return nil, errors.New("agent log directory changed while opening it")
	}
	return child, nil
}

func validLogOwner(info os.FileInfo) bool {
	return os.Geteuid() != 0 || rootProtected(info)
}

func prepareCredentialPath(path string, enrolling bool) error {
	if os.Geteuid() != 0 {
		return nil
	}
	if err := protectedDirectory(filepath.Dir(path), enrolling); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || !rootProtected(info) || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("agent credential must be a private root-owned regular file: %s", path)
	}
	return nil
}

func validateProtectedFile(path string) error {
	if err := protectedDirectory(filepath.Dir(path), false); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || !rootProtected(info) {
		return fmt.Errorf("agent file must be a root-owned regular file protected from other writes: %s", path)
	}
	return nil
}

func protectedDirectory(path string, create bool) error {
	if parent := filepath.Dir(path); parent != path {
		if err := protectedDirectory(parent, create); err != nil {
			return err
		}
		if create {
			if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		}
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || !rootProtected(info) {
		return fmt.Errorf("agent directory must be root-owned and protected from other writes: %s", path)
	}
	return nil
}

func rootProtected(info os.FileInfo) bool {
	return info.Sys().(*syscall.Stat_t).Uid == 0 && info.Mode().Perm()&0022 == 0
}
