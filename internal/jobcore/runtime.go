// Package jobcore defines the execution contract independently of transport and storage.
package jobcore

import (
	"context"
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/scriptcore"
)

const MaxJSONBytes = scriptcore.MaxJSONBytes

type Error = scriptcore.Error

func Failure(code, message string) error { return scriptcore.Failure(code, message) }

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
type Result = scriptcore.Result

type Executor interface {
	Validate(string) error
	Execute(context.Context, Input, Host) (Result, error)
}

func Code(err error) string { return scriptcore.Code(err) }
