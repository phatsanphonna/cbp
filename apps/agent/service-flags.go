package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/pflag"
)

func loadAgentServiceFlags(ctx context.Context, flags *pflag.FlagSet) error {
	path := agentServicePath()
	if err := validatePrivilegedInput(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	unit, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !strings.HasPrefix(string(unit), managedUnitHeader) {
		return nil
	}

	// Use the generated unit only when it matches what systemd loaded.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "systemctl", "show", "--all",
		"--property=FragmentPath", "--property=DropInPaths", "--property=NeedDaemonReload", agentServiceName).Output()
	properties := strings.Split(string(out), "\n")
	if err != nil || !slices.Contains(properties, "FragmentPath="+path) ||
		!slices.Contains(properties, "DropInPaths=") || !slices.Contains(properties, "NeedDaemonReload=no") {
		return errors.New("could not verify the managed agent service settings; pass --config or the original connection flags to unregister")
	}
	return applyAgentServiceFlags(string(unit), flags)
}

func applyAgentServiceFlags(unit string, flags *pflag.FlagSet) error {
	const prefix = "ExecStart="
	var command string
	for line := range strings.SplitSeq(unit, "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		if command != "" {
			return errors.New("managed agent service has multiple ExecStart commands; pass the connection settings explicitly")
		}
		command = line
	}

	invalid := errors.New("could not read the managed agent service command; pass the connection settings explicitly")
	args, ok := strings.CutPrefix(command, prefix+":")
	if !ok || !strings.HasPrefix(args, `"`) {
		return invalid
	}
	executable, err := strconv.QuotedPrefix(args)
	if err != nil {
		return invalid
	}
	args = strings.TrimPrefix(args, executable)
	for args != "" {
		name, value, ok := strings.Cut(strings.TrimPrefix(args, " "), " ")
		if !ok || !strings.HasPrefix(name, "-") || !strings.HasPrefix(value, `"`) {
			return invalid
		}
		quoted, err := strconv.QuotedPrefix(value)
		if err != nil {
			return invalid
		}
		text, err := strconv.Unquote(quoted)
		if err != nil || strings.Contains(strings.ReplaceAll(text, "%%", ""), "%") {
			return invalid
		}
		args = strings.TrimPrefix(value, quoted)
		if args != "" && !strings.HasPrefix(args, " ") {
			return invalid
		}
		if name = strings.TrimLeft(name, "-"); flags.Lookup(name) != nil {
			if err := flags.Set(name, strings.ReplaceAll(text, "%%", "%")); err != nil {
				return err
			}
		}
	}
	return nil
}
