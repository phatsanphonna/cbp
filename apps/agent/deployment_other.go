//go:build !linux

package main

import "context"

func installDeployment(context.Context, deploymentTarget, string, string) string {
	return "configuration"
}
