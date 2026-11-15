package mysql

import (
	"context"
	"fmt"
	"io"

	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// This fixture verifies SQL intent/ref/fence coordination through native APIs.
// Provider integration tests verify actual filesystem behavior separately.
type environmentMemoryProvider struct {
	*sandboxMemoryProvider
	executions       map[string]sb.ExecResult
	outputs          map[string]string
	files            map[string][]byte
	launches         int
	loseTermination  bool
	terminationCalls int
}

func (p *environmentMemoryProvider) fileKey(ref sb.ResourceRef, path string) string {
	key := ref.RemoteID
	for _, spec := range p.specs {
		if spec.Ownership == ref.Ownership && spec.Mount.VolumeID != "" {
			key = spec.Mount.VolumeID
		}
	}
	return key + ":" + path
}
func (p *environmentMemoryProvider) Exec(ctx context.Context, ref sb.ResourceRef, spec sb.ExecSpec, callbacks sb.ExecCallbacks) (sb.ExecResult, error) {
	p.launches++
	handle := sb.ExecutionHandle{Resource: ref, ID: fmt.Sprintf("environment-%d", p.launches)}
	if err := callbacks.Started(ctx, handle); err != nil {
		return sb.ExecResult{Handle: &handle}, err
	}
	if len(spec.Argv) > 0 && spec.Argv[0] == "/bin/sleep" {
		result := sb.ExecResult{Handle: &handle, Running: true}
		p.executions[handle.ID] = result
		return result, nil
	}
	zero := int32(0)
	result := sb.ExecResult{Handle: &handle, ExitCode: &zero}
	p.executions[handle.ID] = result
	return result, nil
}

func (p *environmentMemoryProvider) InspectExecution(_ context.Context, h sb.ExecutionHandle) (sb.ExecResult, error) {
	result, ok := p.executions[h.ID]
	if !ok {
		return sb.ExecResult{}, &sb.Error{Code: "SANDBOX_EXECUTION_UNCONFIRMED", Unknown: true}
	}
	return result, nil
}
func (p *environmentMemoryProvider) ReadExecutionOutput(_ context.Context, h sb.ExecutionHandle, cursor int64, maxBytes int) (sb.ExecutionOutput, error) {
	output := p.outputs[h.ID]
	start := min(cursor, int64(len(output)))
	end := min(start+int64(maxBytes), int64(len(output)))
	return sb.ExecutionOutput{Text: output[start:end], Cursor: end, Truncated: end < int64(len(output))}, nil
}
func (p *environmentMemoryProvider) CancelExecution(_ context.Context, h sb.ExecutionHandle) error {
	result := p.executions[h.ID]
	exit := int32(143)
	result.Running, result.ExitCode = false, &exit
	p.executions[h.ID] = result
	return nil
}

func (p *environmentMemoryProvider) Terminate(ctx context.Context, ref sb.ResourceRef) error {
	p.terminationCalls++
	if err := p.sandboxMemoryProvider.Terminate(ctx, ref); err != nil {
		return err
	}
	if p.loseTermination {
		p.loseTermination = false
		return &sb.Error{Code: "SANDBOX_TRANSPORT_UNKNOWN", Unknown: true}
	}
	return nil
}

type environmentMemoryFactory struct{ provider *environmentMemoryProvider }

func (f environmentMemoryFactory) Open(context.Context, sb.Connection) (sb.Provider, error) {
	return f.provider, nil
}

func (p *environmentMemoryProvider) native(ref sb.ResourceRef) nativeMemoryFS {
	return nativeMemoryFS{p.files, p.fileKey(ref, ""), func() error { p.launches++; return nil }}
}
func (p *environmentMemoryProvider) StatFile(ctx context.Context, ref sb.ResourceRef, name string) (sb.FileInfo, error) {
	return p.native(ref).StatFile(ctx, ref, name)
}
func (p *environmentMemoryProvider) ListFiles(ctx context.Context, ref sb.ResourceRef, name string) ([]sb.FileInfo, error) {
	return p.native(ref).ListFiles(ctx, ref, name)
}
func (p *environmentMemoryProvider) SearchFiles(ctx context.Context, ref sb.ResourceRef, name, pattern string) ([]sb.FileInfo, error) {
	return p.native(ref).SearchFiles(ctx, ref, name, pattern)
}
func (p *environmentMemoryProvider) MakeDirectory(ctx context.Context, ref sb.ResourceRef, name string, mode int) error {
	return p.native(ref).MakeDirectory(ctx, ref, name, mode)
}
func (p *environmentMemoryProvider) RemoveFile(ctx context.Context, ref sb.ResourceRef, name string, dir bool) error {
	return p.native(ref).RemoveFile(ctx, ref, name, dir)
}
func (p *environmentMemoryProvider) MoveFile(ctx context.Context, ref sb.ResourceRef, from, to string) error {
	return p.native(ref).MoveFile(ctx, ref, from, to)
}
func (p *environmentMemoryProvider) SetFilePermissions(ctx context.Context, ref sb.ResourceRef, name string, mode int) error {
	return p.native(ref).SetFilePermissions(ctx, ref, name, mode)
}
func (p *environmentMemoryProvider) ReplaceFile(ctx context.Context, ref sb.ResourceRef, name, old, replacement string) (int, error) {
	return p.native(ref).ReplaceFile(ctx, ref, name, old, replacement)
}
func (p *environmentMemoryProvider) OpenFile(ctx context.Context, ref sb.ResourceRef, q sb.FileRequest) (io.ReadCloser, error) {
	return p.native(ref).OpenFile(ctx, ref, q)
}
func (p *environmentMemoryProvider) PutFile(ctx context.Context, ref sb.ResourceRef, q sb.FileRequest, r io.Reader) error {
	return p.native(ref).PutFile(ctx, ref, q, r)
}
