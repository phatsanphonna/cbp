module cbp/agent

go 1.27.4

require (
	cbp/agent-rpc v0.0.0
	github.com/spf13/cobra v1.10.2
	github.com/spf13/pflag v1.0.9
	go.yaml.in/yaml/v3 v3.0.4
	google.golang.org/grpc v1.85.0
	google.golang.org/protobuf v1.36.12
)

replace cbp/agent-rpc => ../../packages/agent-rpc
