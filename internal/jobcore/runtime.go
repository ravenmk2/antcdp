// Package jobcore defines the execution contract independently of transport and storage.
package jobcore

import (
	"context"
	"encoding/json"
)

const MaxJSONBytes = 1 << 20

type Error struct {
	Code    string
	Message string
	CallID  string
}

func (e *Error) Error() string           { return e.Message }
func Failure(code, message string) error { return &Error{Code: code, Message: message} }

type Host interface {
	State(context.Context, string, string, json.RawMessage, json.RawMessage) (any, error)
	Log(context.Context, string, string, json.RawMessage) error
	Call(context.Context, string, []json.RawMessage) (any, error)
}
type Input struct {
	Script string
	Inputs any
	Run    any
	// OnStopping observes failure before outstanding host activities are drained.
	OnStopping func(error)
}
type Result struct {
	Value    json.RawMessage
	HasValue bool
}
type Executor interface {
	Validate(string) error
	Execute(context.Context, Input, Host) (Result, error)
}

func Code(err error) string {
	if e, ok := err.(*Error); ok {
		return e.Code
	}
	return "EXECUTION_ERROR"
}
