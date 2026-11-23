package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type agentRecord struct {
	InviteHash string    `json:"inviteHash,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt,omitzero"`
	TokenHash  string    `json:"tokenHash,omitempty"`
}

func recordPath(dir, host string) string {
	return filepath.Join(dir, "host-"+host+".json")
}

func digest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func matches(hash, token string) bool {
	return subtle.ConstantTimeCompare([]byte(hash), []byte(digest(token))) == 1
}

func readRecord(path string) (agentRecord, error) {
	var record agentRecord
	data, err := os.ReadFile(path)
	if err != nil {
		return record, err
	}
	err = json.Unmarshal(data, &record)
	return record, err
}

func writeRecord(path string, record agentRecord) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".agent-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	writeErr := json.MarshalEncode(jsontext.NewEncoder(file), record)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if err := errors.Join(writeErr, file.Close()); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
