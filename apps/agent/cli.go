package main

import (
	"context"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

type agentOptions struct {
	configPath     string
	address        string
	host           string
	ca             string
	credentialFile string
	logFile        string
	interval       time.Duration
	once           bool
	installService bool
}

func run(ctx context.Context, args []string) error {
	command := newAgentCommand()
	command.SetArgs(normalizeAgentArgs(args, command.Flags()))
	return command.ExecuteContext(ctx)
}

func newAgentCommand() *cobra.Command {
	var options agentOptions
	command := &cobra.Command{
		Use:           "cbp-agent",
		Short:         "Enroll a host, check in with the CBP controller, and deploy certificates",
		Args:          cobra.NoArgs,
		SilenceErrors: true,
		SilenceUsage:  true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runAgent(cmd.Context(), cmd.Flags(), &options)
		},
	}
	flags := command.Flags()
	addAgentRunFlags(flags, &options)
	flags.BoolVar(&options.once, "once", false, "check in once and exit")

	registerOptions := agentOptions{once: true}
	register := &cobra.Command{
		Use:   "register",
		Short: "Enroll and check in once using CBP_AGENT_ENROLLMENT_CODE",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runAgent(cmd.Context(), cmd.Flags(), &registerOptions)
		},
	}
	addAgentRunFlags(register.Flags(), &registerOptions)

	var unregisterOptions agentOptions
	unregister := &cobra.Command{
		Use:   "unregister",
		Short: "Revoke this agent's enrollment and remove its local credential",
		Long:  "Revoke this agent's enrollment and remove its local credential. With no flags, use the managed systemd service or the default agent YAML.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if runtime.GOOS == "linux" && cmd.Flags().NFlag() == 0 {
				if err := loadAgentServiceFlags(cmd.Context(), cmd.Flags()); err != nil {
					return err
				}
			}
			if _, err := loadAgentConfig(cmd.Flags(), &unregisterOptions); err != nil {
				return err
			}
			return unregisterAgent(cmd.Context(), unregisterOptions)
		},
	}
	addAgentConnectionFlags(unregister.Flags(), &unregisterOptions)
	command.AddCommand(register, unregister, &cobra.Command{
		Use:   "uninstall",
		Short: "Stop and remove the managed systemd service",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return uninstallAgentService(cmd.Context())
		},
	})
	command.InitDefaultHelpFlag()
	return command
}

func addAgentRunFlags(flags *pflag.FlagSet, options *agentOptions) {
	addAgentConnectionFlags(flags, options)
	flags.StringVar(&options.logFile, "log-file", "", "agent log file (Linux root default: /var/log/cbp/agent.log; otherwise beside the credential)")
	flags.DurationVar(&options.interval, "interval", time.Minute, "time between check-ins")
	flags.BoolVar(&options.installService, "install-service", false, "install and start the systemd service after check-in (Linux root)")
}

func addAgentConnectionFlags(flags *pflag.FlagSet, options *agentOptions) {
	flags.StringVar(&options.configPath, "config", "", "agent YAML config file (defaults to "+defaultConfig+" or "+alternateConfig+")")
	flags.StringVar(&options.address, "controller", "localhost:50051", "controller host and port")
	flags.StringVar(&options.host, "host", "", "registered host ID")
	flags.StringVar(&options.ca, "ca", "", "private controller CA certificate in PEM format")
	flags.StringVar(&options.credentialFile, "credential-file", "", "private file for the agent credential")
}

// Existing enrollment commands and systemd units use single-dash long flags.
func normalizeAgentArgs(args []string, flags *pflag.FlagSet) []string {
	normalized := append([]string{}, args...)
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			break
		}
		if !strings.HasPrefix(arg, "-") {
			continue
		}
		name, _, inline := strings.Cut(strings.TrimLeft(arg, "-"), "=")
		flag := flags.Lookup(name)
		if flag == nil {
			continue
		}
		if !strings.HasPrefix(arg, "--") {
			normalized[i] = "-" + arg
		}
		if !inline && flag.NoOptDefVal == "" {
			i++
		}
	}
	return normalized
}
