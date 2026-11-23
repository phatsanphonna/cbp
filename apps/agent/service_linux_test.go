package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProtectedFileRejectsWritableParent(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0777); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "agent.yaml")
	if err := os.WriteFile(path, []byte("host: test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := validateProtectedFile(path); err == nil {
		t.Fatal("accepted an agent file below a writable directory")
	}
}

func TestSystemLogDirectoryUnderGroupWritableParent(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires root-owned test directories")
	}
	parent := t.TempDir()
	if err := os.Chmod(parent, 0775); err != nil {
		t.Fatal(err)
	}
	logs, err := openSystemLogDirectory(parent)
	if err != nil {
		t.Fatal(err)
	}
	defer logs.Close()
	info, err := logs.Stat(".")
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("expected a private CBP log directory: %v, %v", info, err)
	}
	if err := os.Chmod(filepath.Join(parent, "cbp"), 0775); err != nil {
		t.Fatal(err)
	}
	if logs, err := openSystemLogDirectory(parent); err == nil {
		logs.Close()
		t.Fatal("accepted a group-writable CBP log directory")
	}
}
