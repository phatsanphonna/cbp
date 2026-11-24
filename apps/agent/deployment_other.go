//go:build !linux

package main

import "context"

func installDeployment(context.Context, deploymentTarget, string, string, func(string)) (string, error) {
	return "configuration", nil
}
