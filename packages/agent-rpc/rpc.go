package rpc

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"regexp"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

const (
	serviceName   = "cbp.agent.v1.Controller"
	EnrollMethod  = "/" + serviceName + "/Enroll"
	CheckInMethod = "/" + serviceName + "/CheckIn"
	HostHeader    = "cbp-host-id"
)

var hostIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func ValidHostID(value string) bool { return hostIDPattern.MatchString(value) }

func NewToken() string {
	var data [32]byte
	rand.Read(data[:])
	return base64.RawURLEncoding.EncodeToString(data[:])
}

func ValidToken(value string) bool {
	if len(value) != 43 {
		return false
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(value)
	return err == nil && len(data) == 32
}

type Controller interface {
	Enroll(context.Context, *wrapperspb.StringValue) (*emptypb.Empty, error)
	CheckIn(context.Context, *structpb.Struct) (*emptypb.Empty, error)
}

// The contract uses standard protobuf messages, so only service registration is needed.
func RegisterController(server *grpc.Server, controller Controller) {
	server.RegisterService(&grpc.ServiceDesc{
		ServiceName: serviceName,
		HandlerType: (*Controller)(nil),
		Methods: []grpc.MethodDesc{
			method("Enroll", EnrollMethod, Controller.Enroll),
			method("CheckIn", CheckInMethod, Controller.CheckIn),
		},
	}, controller)
}

func method[T any](name, fullName string, call func(Controller, context.Context, *T) (*emptypb.Empty, error)) grpc.MethodDesc {
	return grpc.MethodDesc{
		MethodName: name,
		Handler: func(server any, ctx context.Context, decode func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
			request := new(T)
			if err := decode(request); err != nil {
				return nil, err
			}
			if interceptor == nil {
				return call(server.(Controller), ctx, request)
			}
			info := &grpc.UnaryServerInfo{Server: server, FullMethod: fullName}
			return interceptor(ctx, request, info, func(ctx context.Context, request any) (any, error) {
				return call(server.(Controller), ctx, request.(*T))
			})
		},
	}
}
