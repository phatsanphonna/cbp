package main

import (
	"os"
	"testing"
	"time"
)

func TestReplaceEnrollmentRecord(t *testing.T) {
	path := recordPath(t.TempDir(), "test")
	invited := agentRecord{InviteHash: digest("invite"), ExpiresAt: time.Now().Add(time.Minute)}
	if err := writeRecord(path, invited); err != nil {
		t.Fatal(err)
	}
	record, err := readRecord(path)
	if err != nil || !matches(record.InviteHash, "invite") || !record.ExpiresAt.Equal(invited.ExpiresAt) {
		t.Fatal("could not read back invitation", err)
	}

	if err := writeRecord(path, agentRecord{TokenHash: digest("agent")}); err != nil {
		t.Fatal(err)
	}
	record, err = readRecord(path)
	if err != nil || record.InviteHash != "" || !record.ExpiresAt.IsZero() || !matches(record.TokenHash, "agent") {
		t.Fatal("could not replace invitation with agent credential", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := readRecord(path); !os.IsNotExist(err) {
		t.Fatal("expected revoked credential to be absent", err)
	}
}
