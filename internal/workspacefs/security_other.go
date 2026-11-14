//go:build !linux

package workspacefs

import "context"

func WorkloadProbe(context.Context) any { return map[string]any{"supported": false} }
