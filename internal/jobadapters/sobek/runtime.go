// Package sobek provides the Job-owned SDK over the shared JavaScript execution adapter.
package sobek

import (
	"context"
	_ "embed"
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/jobcore"
	runtime "github.com/ravenmk2/antcdp/internal/scriptadapters/sobek"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
)

//go:embed bindings.js
var bootstrap string

type Executor struct{}

func (Executor) Validate(source string) error {
	return (runtime.Executor{}).Validate(source, "job.js", "main")
}

func (Executor) Execute(ctx context.Context, input jobcore.Input, host jobcore.Host) (jobcore.Result, error) {
	functions := map[string]scriptcore.Function{"sleep": {Async: true, Call: scriptcore.Sleep}}
	for name, method := range map[string]string{"stateGet": "get", "statePut": "put", "stateDelete": "delete"} {
		functions[name] = scriptcore.Function{Call: func(ctx context.Context, args []json.RawMessage) (any, error) {
			var key string
			if len(args) < 2 || string(args[0]) == "null" || json.Unmarshal(args[0], &key) != nil {
				return nil, jobcore.Failure("INVALID_ARGUMENT", "状态键必须是字符串")
			}
			var value json.RawMessage
			options := args[1]
			if method == "put" {
				if len(args) != 3 {
					return nil, jobcore.Failure("INVALID_ARGUMENT", "状态参数不正确")
				}
				value, options = args[1], args[2]
			}
			if string(options) == "null" {
				options = nil
			}
			return host.State(ctx, method, key, value, options)
		}}
	}
	for name, level := range map[string]string{"logInfo": "info", "logWarn": "warn", "logError": "error"} {
		functions[name] = scriptcore.Function{MaxArgumentBytes: -1, Call: func(ctx context.Context, args []json.RawMessage) (any, error) {
			var message string
			if len(args) != 2 || json.Unmarshal(args[0], &message) != nil {
				return nil, jobcore.Failure("INVALID_ARGUMENT", "日志参数不正确")
			}
			return nil, host.Log(ctx, level, message, args[1])
		}}
	}
	for _, name := range []string{"resources", "dingtalk", "agentChat"} {
		functions[name] = scriptcore.Function{Async: true, Call: func(ctx context.Context, args []json.RawMessage) (any, error) { return host.Call(ctx, name, args) }}
	}
	return (runtime.Executor{}).Execute(ctx, scriptcore.Input{Script: input.Script, SourceName: "job.js", EntryPoint: "main", Values: map[string]any{"inputs": input.Inputs, "run": input.Run}, Functions: functions, Bootstrap: bootstrap, OnStopping: input.OnStopping})
}

var _ jobcore.Executor = Executor{}
