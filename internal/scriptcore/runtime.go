// Package scriptcore defines execution mechanics without business capabilities.
package scriptcore

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"
)

const MaxJSONBytes = 1 << 20

type Error struct {
	Code    string
	Message string
	CallID  string
}

func (e *Error) Error() string           { return e.Message }
func Failure(code, message string) error { return &Error{Code: code, Message: message} }
func Code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return "EXECUTION_ERROR"
}

// Function is a host-owned capability. Arguments and results cross a JSON boundary.
// A negative argument limit permits the host to apply its own bounded projection.
type Function struct {
	Async            bool
	MaxArgumentBytes int
	Call             func(context.Context, []json.RawMessage) (any, error)
}

type Input struct {
	Script     string
	SourceName string
	EntryPoint string
	Values     map[string]any
	Functions  map[string]Function
	// Bootstrap is trusted host code: (readonlyValues, functions) => context.
	// Business SDK construction belongs to the host, not the execution adapter.
	Bootstrap    string
	MaxJSONBytes int
	OnStopping   func(error)
}

type Result struct {
	Value    json.RawMessage
	HasValue bool
}

type Executor interface {
	Validate(source, sourceName, entryPoint string) error
	Execute(context.Context, Input) (Result, error)
}

// Sleep is a cancellable technical primitive; hosts choose whether to expose it.
func Sleep(ctx context.Context, args []json.RawMessage) (any, error) {
	var ms float64
	if len(args) != 1 || string(args[0]) == "null" || json.Unmarshal(args[0], &ms) != nil || math.IsNaN(ms) || math.IsInf(ms, 0) || ms < 0 || math.Trunc(ms) != ms || ms > float64(math.MaxInt64/int64(time.Millisecond)) {
		return nil, Failure("INVALID_DELAY", "等待时长必须是有效非负整数毫秒")
	}
	timer := time.NewTimer(time.Duration(ms) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
