// Package sobek executes Job scripts on one JavaScript thread per run.
package sobek

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"sync"
	"time"
	"unicode/utf8"

	js "github.com/grafana/sobek"
	"github.com/grafana/sobek/ast"
	"github.com/grafana/sobek/parser"
	"github.com/ravenmk2/antcdp/internal/jobcore"
)

type Executor struct{}

func (Executor) Validate(source string) error {
	if len(source) == 0 || len(source) > 1<<20 {
		return jobcore.Failure("INVALID_SCRIPT", "脚本须为 1 字节至 1 MiB")
	}
	program, err := parser.ParseFile(nil, "job.js", source, 0)
	if err != nil {
		return jobcore.Failure("INVALID_SCRIPT", err.Error())
	}
	found := false
	for _, node := range program.Body {
		if fn, ok := node.(*ast.FunctionDeclaration); ok && fn.Function.Name != nil && fn.Function.Name.Name.String() == "main" {
			found = true
		}
	}
	if !found {
		return jobcore.Failure("INVALID_SCRIPT", "需要声明 function main(ctx) 或 async function main(ctx)")
	}
	_, err = js.Compile("job.js", source, true)
	if err != nil {
		return jobcore.Failure("INVALID_SCRIPT", err.Error())
	}
	return nil
}

type completion struct {
	resolve, reject func(any) error
	value           any
	err             error
}
type loop struct {
	vm         *js.Runtime
	ctx        context.Context
	host       jobcore.Host
	serialize  js.Callable
	parse      js.Callable
	errorType  js.Value
	events     chan completion
	pending    int
	workers    sync.WaitGroup
	rejected   map[*js.Promise]bool
	hostErrors map[*js.Object]string
}

func (e Executor) Execute(parent context.Context, input jobcore.Input, host jobcore.Host) (result jobcore.Result, err error) {
	if err = e.Validate(input.Script); err != nil {
		return result, err
	}
	ctx, cancel := context.WithCancel(parent)
	vm := js.New()
	vm.SetMaxCallStackSize(1024)
	l := &loop{vm: vm, ctx: ctx, host: host, events: make(chan completion, 64), rejected: map[*js.Promise]bool{}}
	l.errorType = vm.Get("Error")
	l.parse, _ = js.AssertFunction(vm.Get("JSON").ToObject(vm).Get("parse"))
	l.hostErrors = map[*js.Object]string{}
	stop := context.AfterFunc(ctx, func() { vm.Interrupt(ctx.Err()) })
	defer func() {
		stop()
		cancel()
		if recover() != nil {
			result = jobcore.Result{}
			err = jobcore.Failure("SCRIPT_ERROR", "脚本异常无法安全读取")
		}
		if err != nil && input.OnStopping != nil {
			input.OnStopping(err)
		}
		l.workers.Wait()
	}()
	vm.SetPromiseRejectionTracker(func(p *js.Promise, op js.PromiseRejectionOperation) {
		if op == js.PromiseRejectionReject {
			l.rejected[p] = true
		} else {
			delete(l.rejected, p)
		}
	})
	serializer, err := vm.RunString(`(function() {
      const stringify = JSON.stringify, finite = Number.isFinite, TypeErrorCtor = TypeError;
      const keys = Object.keys, symbols = Object.getOwnPropertySymbols, proto = Object.getPrototypeOf;
      const create = Object.create, setProto = Object.setPrototypeOf, isArray = Array.isArray;
      const objectProto = Object.prototype;
      const errorProtos = [Error.prototype, TypeError.prototype, RangeError.prototype, SyntaxError.prototype, ReferenceError.prototype, EvalError.prototype, URIError.prototype, AggregateError.prototype];
      return function(value) {
        const ancestors = [];
        function clone(v) {
          if (v === null || typeof v === "string" || typeof v === "boolean") return v;
          if (typeof v === "number" && finite(v)) return v;
          if (typeof v !== "object") throw new TypeErrorCtor("Value is not JSON representable");
          for (let i = 0; i < ancestors.length; i++) if (ancestors[i] === v) throw new TypeErrorCtor("Cyclic JSON value");
          if (symbols(v).length) throw new TypeErrorCtor("Symbol keys are not JSON representable");
          const array = isArray(v), p = proto(v);
          let allowed = array || p === null || p === objectProto;
          for (let i = 0; i < errorProtos.length; i++) if (p === errorProtos[i]) allowed = true;
          if (!allowed) throw new TypeErrorCtor("Only JSON objects and arrays are supported");
          ancestors[ancestors.length] = v;
          const out = array ? setProto([], null) : create(null);
          if (array) {
            const names = keys(v);
            // Reject extra array properties instead of silently losing them.
            if (names.length !== v.length) throw new TypeErrorCtor("Sparse or decorated array is not JSON representable");
            for (let i = 0; i < names.length; i++) {
              if (names[i] !== "" + i) throw new TypeErrorCtor("Sparse or decorated array is not JSON representable");
              out[i] = clone(v[i]);
            }
          } else {
            const names = keys(v);
            for (let i = 0; i < names.length; i++) out[names[i]] = clone(v[names[i]]);
          }
          ancestors.length--;
          return out;
        }
        return stringify(clone(value));
      };
    })()`)
	if err != nil {
		return result, err
	}
	l.serialize, _ = js.AssertFunction(serializer)
	obj, err := l.context(input)
	if err != nil {
		return result, err
	}
	if _, err = vm.RunScript("job.js", input.Script); err != nil {
		return result, l.failure(err)
	}
	main, ok := js.AssertFunction(vm.Get("main"))
	if !ok {
		return result, jobcore.Failure("INVALID_SCRIPT", "main 必须是函数")
	}
	value, err := main(js.Undefined(), obj)
	if err != nil {
		return result, l.failure(err)
	}
	var promise *js.Promise
	if value.ExportType() == reflect.TypeFor[*js.Promise]() {
		promise, _ = value.Export().(*js.Promise)
	}
	for promise != nil && promise.State() == js.PromiseStatePending {
		if len(l.rejected) > 0 {
			return result, jobcore.Failure("UNHANDLED_REJECTION", l.rejection())
		}
		if l.pending == 0 {
			return result, jobcore.Failure("UNSETTLED_PROMISE", "入口 Promise 无可推进的宿主调用")
		}
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		case event := <-l.events:
			l.pending--
			var value js.Value
			if event.err == nil {
				value, event.err = l.fromHost(event.value)
			}
			if event.err != nil {
				err = event.reject(l.errorValue(event.err))
			} else {
				err = event.resolve(value)
			}
			if err != nil {
				return result, l.failure(err)
			}
		}
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	if promise != nil {
		if promise.State() == js.PromiseStateRejected {
			return result, l.valueFailure(promise.Result())
		}
		value = promise.Result()
	}
	if len(l.rejected) > 0 {
		return result, jobcore.Failure("UNHANDLED_REJECTION", l.rejection())
	}
	if l.pending > 0 {
		return result, jobcore.Failure("UNAWAITED_HOST_CALL", "入口已结束，仍有未等待的宿主调用")
	}
	if js.IsUndefined(value) {
		return result, nil
	}
	raw, err := l.json(value)
	if err != nil {
		return result, jobcore.Failure("INVALID_RESULT", err.Error())
	}
	if l.pending > 0 {
		return result, jobcore.Failure("UNAWAITED_HOST_CALL", "结果序列化启动了未等待的宿主调用")
	}
	if len(l.rejected) > 0 {
		return result, jobcore.Failure("UNHANDLED_REJECTION", l.rejection())
	}
	return jobcore.Result{Value: raw, HasValue: true}, nil
}

func (l *loop) json(value js.Value) (json.RawMessage, error) {
	return l.encode(value, jobcore.MaxJSONBytes)
}

// Never expose Go-backed objects through the scripting boundary. Named Go
// strings (such as ETag), maps and slices must have ordinary JavaScript value
// semantics, including JSON serialization and mutation of returned copies.
func (l *loop) fromHost(value any) (js.Value, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, jobcore.Failure("INVALID_HOST_RESULT", "宿主返回了无法表示为 JSON 的值")
	}
	return l.parse(js.Undefined(), l.vm.ToValue(string(raw)))
}
func (l *loop) encode(value js.Value, limit int) (json.RawMessage, error) {
	encoded, err := l.serialize(js.Undefined(), value)
	if err != nil {
		return nil, l.failure(err)
	}
	raw := json.RawMessage(encoded.String())
	if limit > 0 && len(raw) > limit {
		return nil, jobcore.Failure("JSON_TOO_LARGE", "JSON 超过 1 MiB")
	}
	return raw, nil
}
func (l *loop) errorValue(err error) *js.Object {
	code, message, callID := "HOST_ERROR", err.Error(), ""
	var failure *jobcore.Error
	if errors.As(err, &failure) {
		code, message, callID = failure.Code, failure.Message, failure.CallID
	}
	obj, constructErr := l.vm.New(l.errorType, l.vm.ToValue(message))
	if constructErr != nil {
		obj = l.vm.NewObject()
		_ = obj.Set("message", message)
	}
	_ = obj.Set("code", code)
	l.hostErrors[obj] = code
	if callID != "" {
		_ = obj.Set("callId", callID)
	}
	return obj
}
func (l *loop) failure(err error) error {
	if l.ctx.Err() != nil {
		return l.ctx.Err()
	}
	var exception *js.Exception
	if errors.As(err, &exception) {
		return l.valueFailure(exception.Value())
	}
	return jobcore.Failure("SCRIPT_ERROR", err.Error())
}
func (l *loop) valueFailure(v js.Value) error {
	message := v.String()
	code := "SCRIPT_ERROR"
	if o, ok := v.(*js.Object); ok {
		if original, trusted := l.hostErrors[o]; trusted {
			code = original
		}
		if stack := o.Get("stack"); stack != nil && !js.IsUndefined(stack) {
			message = stack.String()
		}
	}
	if len(message) > 8192 {
		message = message[:8192]
		for !utf8.ValidString(message) {
			message = message[:len(message)-1]
		}
	}
	return jobcore.Failure(code, message)
}
func (l *loop) rejection() string {
	for p := range l.rejected {
		return p.Result().String()
	}
	return "未处理的 Promise 错误"
}
func (l *loop) async(work func(context.Context) (any, error)) js.Value {
	p, resolve, reject := l.vm.NewPromise()
	l.pending++
	l.workers.Go(func() {
		value, err := work(l.ctx)
		select {
		case l.events <- completion{resolve, reject, value, err}:
		case <-l.ctx.Done():
		}
	})
	return l.vm.ToValue(p)
}
func (l *loop) context(input jobcore.Input) (*js.Object, error) {
	obj := l.vm.NewObject()
	for name, value := range map[string]any{"inputs": input.Inputs, "run": input.Run} {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		quoted, _ := json.Marshal(string(raw))
		decoded, err := l.vm.RunString("JSON.parse(" + string(quoted) + ")")
		if err != nil {
			return nil, err
		}
		freeze, err := l.vm.RunString(`(function freeze(v) { if(v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; })`)
		if err != nil {
			return nil, err
		}
		fn, _ := js.AssertFunction(freeze)
		frozen, err := fn(js.Undefined(), decoded)
		if err != nil {
			return nil, err
		}
		if err = obj.DefineDataProperty(name, frozen, js.FLAG_FALSE, js.FLAG_FALSE, js.FLAG_TRUE); err != nil {
			return nil, err
		}
	}
	_ = obj.Set("sleep", func(call js.FunctionCall) js.Value {
		if kind := call.Argument(0).ExportType(); kind != reflect.TypeFor[int64]() && kind != reflect.TypeFor[float64]() {
			panic(l.errorValue(jobcore.Failure("INVALID_DELAY", "等待时长必须是数字")))
		}
		ms := call.Argument(0).ToFloat()
		if math.IsNaN(ms) || math.IsInf(ms, 0) || ms < 0 || math.Trunc(ms) != ms || ms > float64(math.MaxInt64/int64(time.Millisecond)) {
			panic(l.errorValue(jobcore.Failure("INVALID_DELAY", "等待时长必须是有效非负整数毫秒")))
		}
		return l.async(func(ctx context.Context) (any, error) {
			timer := time.NewTimer(time.Duration(ms) * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
				return nil, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		})
	})
	logs := l.vm.NewObject()
	for _, level := range []string{"info", "warn", "error"} {
		_ = logs.Set(level, func(call js.FunctionCall) js.Value {
			if l.ctx.Err() != nil {
				panic(l.errorValue(l.ctx.Err()))
			}
			fields := json.RawMessage(`{}`)
			if !js.IsUndefined(call.Argument(1)) {
				var err error
				// The host truncates valid log fields to its own smaller quota.
				fields, err = l.encode(call.Argument(1), 0)
				if err != nil {
					panic(l.errorValue(err))
				}
			}
			if err := l.host.Log(l.ctx, level, call.Argument(0).String(), fields); err != nil {
				panic(l.errorValue(err))
			}
			return js.Undefined()
		})
	}
	_ = obj.Set("log", logs)
	state := l.vm.NewObject()
	for _, method := range []string{"get", "put", "delete"} {
		_ = state.Set(method, func(call js.FunctionCall) js.Value {
			if l.ctx.Err() != nil {
				panic(l.errorValue(l.ctx.Err()))
			}
			if call.Argument(0).ExportType() != reflect.TypeFor[string]() {
				panic(l.errorValue(jobcore.Failure("INVALID_ARGUMENT", "状态键必须是字符串")))
			}
			var value, options json.RawMessage
			var err error
			optionIndex := 1
			if method == "put" {
				value, err = l.json(call.Argument(1))
				optionIndex = 2
				if err != nil {
					panic(l.errorValue(err))
				}
			}
			if !js.IsUndefined(call.Argument(optionIndex)) {
				options, err = l.json(call.Argument(optionIndex))
				if err != nil {
					panic(l.errorValue(err))
				}
			}
			result, err := l.host.State(l.ctx, method, call.Argument(0).String(), value, options)
			if err != nil {
				panic(l.errorValue(err))
			}
			valueResult, err := l.fromHost(result)
			if err != nil {
				panic(l.errorValue(err))
			}
			return valueResult
		})
	}
	_ = obj.Set("state", state)
	for name, method := range map[string]string{"resources": "call", "dingtalk": "send"} {
		capability := l.vm.NewObject()
		_ = capability.Set(method, func(call js.FunctionCall) js.Value {
			args := make([]json.RawMessage, len(call.Arguments))
			for i, arg := range call.Arguments {
				raw, err := l.json(arg)
				if err != nil {
					panic(l.errorValue(err))
				}
				args[i] = raw
			}
			return l.async(func(ctx context.Context) (any, error) { return l.host.Call(ctx, name, args) })
		})
		_ = obj.Set(name, capability)
	}
	return obj, nil
}

var _ jobcore.Executor = Executor{}
