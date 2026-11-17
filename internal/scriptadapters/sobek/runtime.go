// Package sobek implements a business-independent, single-threaded JavaScript runtime.
package sobek

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"unicode/utf8"

	js "github.com/grafana/sobek"
	"github.com/grafana/sobek/ast"
	"github.com/grafana/sobek/parser"
	"github.com/ravenmk2/antcdp/internal/scriptcore"
)

type Executor struct{}

func (Executor) Validate(source, sourceName, entryPoint string) error {
	if len(source) == 0 || len(source) > 1<<20 {
		return scriptcore.Failure("INVALID_SCRIPT", "脚本须为 1 字节至 1 MiB")
	}
	program, err := parser.ParseFile(nil, sourceName, source, 0)
	if err != nil {
		return scriptcore.Failure("INVALID_SCRIPT", err.Error())
	}
	found := false
	for _, node := range program.Body {
		if fn, ok := node.(*ast.FunctionDeclaration); ok && fn.Function.Name != nil && fn.Function.Name.Name.String() == entryPoint {
			found = true
		}
	}
	if !found {
		return scriptcore.Failure("INVALID_SCRIPT", "需要声明入口函数")
	}
	_, err = js.Compile(sourceName, source, true)
	if err != nil {
		return scriptcore.Failure("INVALID_SCRIPT", err.Error())
	}
	return nil
}

type completion struct {
	resolve, reject func(any) error
	value           any
	err             error
}
type loop struct {
	vm           *js.Runtime
	ctx          context.Context
	maxJSONBytes int
	serialize    js.Callable
	parse        js.Callable
	errorType    js.Value
	events       chan completion
	pending      int
	workers      sync.WaitGroup
	rejected     map[*js.Promise]bool
	hostErrors   map[*js.Object]string
}

func (e Executor) Execute(parent context.Context, input scriptcore.Input) (result scriptcore.Result, err error) {
	if input.SourceName == "" {
		input.SourceName = "script.js"
	}
	if input.EntryPoint == "" {
		input.EntryPoint = "main"
	}
	if input.MaxJSONBytes <= 0 {
		input.MaxJSONBytes = scriptcore.MaxJSONBytes
	}
	if err = e.Validate(input.Script, input.SourceName, input.EntryPoint); err != nil {
		return result, err
	}
	ctx, cancel := context.WithCancel(parent)
	vm := js.New()
	vm.SetMaxCallStackSize(1024)
	l := &loop{vm: vm, ctx: ctx, maxJSONBytes: input.MaxJSONBytes, events: make(chan completion, 64), rejected: map[*js.Promise]bool{}}
	l.errorType = vm.Get("Error")
	l.parse, _ = js.AssertFunction(vm.Get("JSON").ToObject(vm).Get("parse"))
	l.hostErrors = map[*js.Object]string{}
	stop := context.AfterFunc(ctx, func() { vm.Interrupt(ctx.Err()) })
	defer func() {
		stop()
		cancel()
		if recover() != nil {
			result = scriptcore.Result{}
			err = scriptcore.Failure("SCRIPT_ERROR", "脚本异常无法安全读取")
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
	if _, err = vm.RunScript(input.SourceName, input.Script); err != nil {
		return result, l.failure(err)
	}
	main, ok := js.AssertFunction(vm.Get(input.EntryPoint))
	if !ok {
		return result, scriptcore.Failure("INVALID_SCRIPT", "main 必须是函数")
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
			return result, scriptcore.Failure("UNHANDLED_REJECTION", l.rejection())
		}
		if l.pending == 0 {
			return result, scriptcore.Failure("UNSETTLED_PROMISE", "入口 Promise 无可推进的宿主调用")
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
		return result, scriptcore.Failure("UNHANDLED_REJECTION", l.rejection())
	}
	if l.pending > 0 {
		return result, scriptcore.Failure("UNAWAITED_HOST_CALL", "入口已结束，仍有未等待的宿主调用")
	}
	if js.IsUndefined(value) {
		return result, nil
	}
	raw, err := l.json(value)
	if err != nil {
		return result, scriptcore.Failure("INVALID_RESULT", err.Error())
	}
	if l.pending > 0 {
		return result, scriptcore.Failure("UNAWAITED_HOST_CALL", "结果序列化启动了未等待的宿主调用")
	}
	if len(l.rejected) > 0 {
		return result, scriptcore.Failure("UNHANDLED_REJECTION", l.rejection())
	}
	return scriptcore.Result{Value: raw, HasValue: true}, nil
}

func (l *loop) json(value js.Value) (json.RawMessage, error) {
	return l.encode(value, l.maxJSONBytes)
}

// Never expose Go-backed objects through the scripting boundary. Named Go
// strings (such as ETag), maps and slices must have ordinary JavaScript value
// semantics, including JSON serialization and mutation of returned copies.
func (l *loop) fromHost(value any) (js.Value, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, scriptcore.Failure("INVALID_HOST_RESULT", "宿主返回了无法表示为 JSON 的值")
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
		return nil, scriptcore.Failure("JSON_TOO_LARGE", "JSON 超过 1 MiB")
	}
	return raw, nil
}
func (l *loop) errorValue(err error) *js.Object {
	code, message, callID := "HOST_ERROR", err.Error(), ""
	var failure *scriptcore.Error
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
	return scriptcore.Failure("SCRIPT_ERROR", err.Error())
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
	return scriptcore.Failure(code, message)
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
func (l *loop) context(input scriptcore.Input) (*js.Object, error) {
	values, err := l.fromHost(input.Values)
	if err != nil {
		return nil, err
	}
	freezeValue, err := l.vm.RunString(`(function freeze(v) { if(v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; })`)
	if err != nil {
		return nil, err
	}
	freeze, _ := js.AssertFunction(freezeValue)
	if _, err = freeze(js.Undefined(), values); err != nil {
		return nil, err
	}
	functions := l.vm.NewObject()
	for name, function := range input.Functions {
		if function.Call == nil {
			return nil, scriptcore.Failure("INVALID_HOST_FUNCTION", "宿主函数未配置")
		}
		if err = functions.Set(name, func(call js.FunctionCall) js.Value {
			if l.ctx.Err() != nil {
				panic(l.errorValue(l.ctx.Err()))
			}
			limit := function.MaxArgumentBytes
			if limit == 0 {
				limit = l.maxJSONBytes
			}
			args := make([]json.RawMessage, len(call.Arguments))
			for i, arg := range call.Arguments {
				raw, encodeErr := l.encode(arg, limit)
				if encodeErr != nil {
					panic(l.errorValue(encodeErr))
				}
				args[i] = raw
			}
			if function.Async {
				return l.async(func(ctx context.Context) (any, error) { return function.Call(ctx, args) })
			}
			result, callErr := function.Call(l.ctx, args)
			if callErr != nil {
				panic(l.errorValue(callErr))
			}
			value, convertErr := l.fromHost(result)
			if convertErr != nil {
				panic(l.errorValue(convertErr))
			}
			return value
		}); err != nil {
			return nil, err
		}
	}
	if _, err = freeze(js.Undefined(), functions); err != nil {
		return nil, err
	}
	bootstrap, err := l.vm.RunScript("host-bindings.js", input.Bootstrap)
	if err != nil {
		return nil, err
	}
	build, ok := js.AssertFunction(bootstrap)
	if !ok {
		return nil, scriptcore.Failure("INVALID_HOST_BINDINGS", "宿主上下文工厂必须为函数")
	}
	result, err := build(js.Undefined(), values, functions)
	if err != nil {
		return nil, err
	}
	object, ok := result.(*js.Object)
	if !ok {
		return nil, scriptcore.Failure("INVALID_HOST_BINDINGS", "宿主上下文必须为对象")
	}
	return object, nil
}

var _ scriptcore.Executor = Executor{}
