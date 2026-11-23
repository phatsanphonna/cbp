package main

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
)

func (c *controller) ClaimDeployment(ctx context.Context, _ *emptypb.Empty) (*structpb.Struct, error) {
	host, token, err := identity(ctx)
	if err != nil {
		return nil, err
	}
	if c.web == nil {
		return nil, status.Error(codes.Unimplemented, "deployment requires the CBP web app")
	}
	var job map[string]any
	if err := c.web.request(ctx, "deployment-claim", webRequest{HostID: host, Token: token}, &job); err != nil {
		if _, ok := err.(webStatusError); ok {
			return nil, webRPCError("deployment-claim", host, err)
		}
		return nil, status.Error(codes.Unavailable, "could not claim deployment")
	}
	return structpb.NewStruct(job)
}

func (c *controller) FinishDeployment(ctx context.Context, req *structpb.Struct) (*emptypb.Empty, error) {
	host, token, err := identity(ctx)
	if err != nil {
		return nil, err
	}
	if c.web == nil {
		return nil, status.Error(codes.Unimplemented, "deployment requires the CBP web app")
	}
	fields := req.GetFields()
	jobID, outcome := fields["jobId"].GetStringValue(), fields["outcome"].GetStringValue()
	if !validField(jobID, 36) || !validField(outcome, 16) {
		return nil, status.Error(codes.InvalidArgument, "invalid deployment result")
	}
	if err := c.web.send(ctx, "deployment-result", webRequest{HostID: host, Token: token, JobID: jobID, Outcome: outcome}); err != nil {
		if err == webStatusError(404) {
			return nil, status.Error(codes.NotFound, "deployment expired or no longer exists")
		}
		return nil, webRPCError("deployment-result", host, err)
	}
	return &emptypb.Empty{}, nil
}
