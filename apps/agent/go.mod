module cbp/agent

go 1.27.4

require (
	cbp/agent-rpc v0.0.0
	go.yaml.in/yaml/v3 v3.0.4
	google.golang.org/grpc v1.85.0
	google.golang.org/protobuf v1.36.12
)

replace cbp/agent-rpc => ../../packages/agent-rpc
