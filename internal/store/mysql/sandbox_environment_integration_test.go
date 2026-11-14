package mysql

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

// This fixture verifies SQL intent/ref/fence coordination. The trusted helper's
// actual filesystem and security guarantees are covered by Linux helper tests
// and deployment verification; these deterministic responses do not prove them.
type environmentMemoryProvider struct {
	*sandboxMemoryProvider
	executions       map[string]sb.ExecResult
	outputs          map[string]string
	files            map[string][]byte
	transfers        map[string][]byte
	launches         int
	unsafe           bool
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
	if spec.Argv[0] == "/bin/sleep" {
		if spec.UID == nil || *spec.UID != 10001 {
			return sb.ExecResult{}, fmt.Errorf("probe process needs workload identity")
		}
		result := sb.ExecResult{Handle: &handle, Running: true}
		p.executions[handle.ID] = result
		return result, nil
	}
	if len(spec.Argv) != 2 || spec.Argv[0] != workspacefs.HelperPath || spec.UID == nil || *spec.UID != 0 {
		return sb.ExecResult{}, fmt.Errorf("invalid helper execution")
	}
	request, err := workspacefs.Decode(spec.Argv[1])
	if err != nil {
		return sb.ExecResult{}, err
	}
	var value any
	switch request.Operation {
	case "capabilities":
		value = map[string]any{"protocol": workspacefs.Version, "safe_io": "openat2", "uid": 0, "workspace_uid": 10001}
	case "verify_security":
		value = map[string]any{"workload_uid": 10001, "command_denied": !p.unsafe, "initialization_denied": true, "transfer_private": true, "helper_immutable": true, "control_environment_private": true, "credentials_absent": true}
	case "initialize":
		cwd := "/data/workspace"
		if request.ProjectID != "" {
			cwd = "/data/projects/" + request.ProjectID
		}
		value = map[string]any{"cwd": cwd}
	case "transfer_begin":
		value = map[string]any{"token": request.Token}
	case "transfer_cleanup":
		delete(p.transfers, ref.RemoteID+":"+request.Token)
		value = map[string]any{"removed": true}
	case "import":
		data := p.transfers[ref.RemoteID+":"+request.Token]
		hash := sha256.Sum256(data)
		if hex.EncodeToString(hash[:]) != request.ExpectedHash {
			return sb.ExecResult{}, fmt.Errorf("fixture import hash mismatch")
		}
		p.files[p.fileKey(ref, request.Path)] = bytes.Clone(data)
		value = map[string]any{"imported": true}
	case "export":
		p.transfers[ref.RemoteID+":"+request.Token] = bytes.Clone(p.files[p.fileKey(ref, request.Path)])
		value = map[string]any{"exported": true}
	case "read":
		value = map[string]any{"data_base64": base64.StdEncoding.EncodeToString(p.files[p.fileKey(ref, request.Path)]), "has_more": false}
	case "skill_prepare", "skill_publish":
		value = map[string]any{"published": true}
	case "skill_check":
		value = map[string]any{"matches": true}
	case "skills_install":
		value = map[string]any{"installed": true, "skill_set_hash": request.SkillSetHash}
	default:
		return sb.ExecResult{}, fmt.Errorf("unsupported fixture request %s", request.Operation)
	}
	encoded, err := json.Marshal(workspacefs.Result(value, false, nil))
	if err != nil {
		return sb.ExecResult{}, err
	}
	zero := int32(0)
	result := sb.ExecResult{Handle: &handle, ExitCode: &zero}
	p.executions[handle.ID], p.outputs[handle.ID] = result, string(encoded)
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
func (p *environmentMemoryProvider) OpenFile(_ context.Context, ref sb.ResourceRef, q sb.FileRequest) (io.ReadCloser, error) {
	token := strings.TrimSuffix(strings.TrimPrefix(q.Path, workspacefs.TransferDirectory+"/"), "/payload")
	return io.NopCloser(bytes.NewReader(p.transfers[ref.RemoteID+":"+token])), nil
}
func (p *environmentMemoryProvider) PutFile(_ context.Context, ref sb.ResourceRef, q sb.FileRequest, r io.Reader) error {
	token := strings.TrimSuffix(strings.TrimPrefix(q.Path, workspacefs.TransferDirectory+"/"), "/payload")
	data, err := io.ReadAll(r)
	p.transfers[ref.RemoteID+":"+token] = data
	return err
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
