package opensandbox

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

// Opt-in real provider verification. Values must come from a private authorized
// fixture; no endpoint, credentials or image are committed to this test. The
// runtime must contain the secured execd and trusted workspace helper. Both
// access paths are exercised unless the caller explicitly narrows the modes.
// Resources are ephemeral and carry unique ownership metadata, with a bounded
// provider lifetime as a fallback. Cleanup never retries an uncertain DELETE.
func TestOpenSandboxRuntimeIntegration(t *testing.T) {
	endpoint := os.Getenv("ANTCDP_TEST_OPENSANDBOX_ENDPOINT")
	if endpoint == "" {
		t.Skip("ANTCDP_TEST_OPENSANDBOX_ENDPOINT not configured")
	}
	key, image := os.Getenv("ANTCDP_TEST_OPENSANDBOX_API_KEY"), os.Getenv("ANTCDP_TEST_OPENSANDBOX_IMAGE")
	control, err := hex.DecodeString(os.Getenv("ANTCDP_TEST_OPENSANDBOX_CONTROL_KEY_HEX"))
	if key == "" || image == "" || err != nil || len(control) < 32 {
		t.Fatal("private integration fixture is incomplete")
	}
	for _, mode := range integrationAccessModes(t) {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			provider, err := (Factory{}).Open(ctx, sandboxcore.Connection{Endpoint: endpoint, APIKey: key, ControlKey: control, AccessMode: mode, ConnectTimeout: 10 * time.Second, OperationTimeout: 90 * time.Second})
			if err != nil {
				t.Fatal("open provider:", err)
			}
			if err = provider.Health(ctx, nil); err != nil {
				t.Fatal("control-plane health:", err)
			}
			network, err := sandboxcore.SnapshotPolicy(sandboxcore.DefaultPolicy())
			if err != nil {
				t.Fatal(err)
			}
			compiled, err := sandboxcore.CompilePolicy(network, nil)
			if err != nil {
				t.Fatal(err)
			}
			owner := sandboxcore.Ownership{InstallationID: integrationToken(t), ComputerID: 1, CreationToken: integrationToken(t)}
			spec := sandboxcore.CreateSpec{BackendGeneration: 1, Ownership: owner, Config: sandboxcore.EffectiveConfig{RuntimeBackend: "docker", Environment: sandboxcore.Environment{Image: image, CPUMillicores: 1000, MemoryMiB: 1024}, Network: network}, Network: compiled, Mount: sandboxcore.MountPlan{Kind: "ephemeral", MountPath: "/data"}, Lifetime: 5 * time.Minute}
			created, createErr := provider.Create(ctx, spec)
			ref := created.Ref
			if createErr != nil && ref.RemoteID == "" {
				// Recover only the original ownership token. Never repeat Create.
				found, findErr := provider.Find(ctx, owner, 1, 100)
				if findErr == nil && !found.HasMore && len(found.Items) == 1 {
					ref = found.Items[0].Ref
					ref.BackendGeneration = 1
				}
			}
			terminated := false
			cleanup := func() {
				if terminated || ref.RemoteID == "" {
					return
				}
				terminated = true
				cleanupCtx, stop := context.WithTimeout(context.Background(), 45*time.Second)
				defer stop()
				deleteErr := provider.Terminate(cleanupCtx, ref)
				for {
					actual, inspectErr := provider.Inspect(cleanupCtx, ref)
					if inspectErr == nil && (actual.State == "terminated" || actual.State == "absent") {
						return
					}
					if !integrationWait(cleanupCtx) {
						t.Errorf("resource cleanup unconfirmed: resource=%s terminate=%v inspect=%v", ref.RemoteID, deleteErr, inspectErr)
						return
					}
				}
			}
			t.Cleanup(cleanup)
			if createErr != nil {
				t.Fatalf("create not repeated: %v; ownership=%s/%s resource=%s", createErr, owner.InstallationID, owner.CreationToken, ref.RemoteID)
			}
			if ref.RemoteID == "" {
				t.Fatal("create omitted resource identity")
			}
			t.Logf("ephemeral resource=%s", ref.RemoteID)
			for {
				actual, err := provider.Inspect(ctx, ref)
				if err != nil {
					t.Fatal("inspect:", err)
				}
				if actual.State == "ready" {
					break
				}
				if actual.State == "terminated" || actual.State == "absent" || !integrationWait(ctx) {
					t.Fatal("created resource did not become ready")
				}
			}
			if err = provider.Health(ctx, &ref); err != nil {
				t.Fatal("data-plane health:", err)
			}
			wrong := ref
			wrong.Ownership.CreationToken = integrationToken(t)
			if _, err = provider.Inspect(ctx, wrong); err == nil {
				t.Fatal("mismatched ownership accepted")
			}
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "capabilities"})
			security := integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "verify_security"})
			var checks map[string]any
			if json.Unmarshal(security.Result, &checks) != nil || checks["workload_uid"] != float64(10001) {
				t.Fatal("invalid security result")
			}
			for _, name := range []string{"command_denied", "initialization_denied", "transfer_private", "helper_immutable", "control_environment_private", "credentials_absent"} {
				if checks[name] != true {
					t.Fatal("security verification failed:", name)
				}
			}
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "initialize", AgentID: "1", ProjectID: "1"})
			content := []byte("verified sandbox bytes\n")
			path := "projects/1/verification.txt"
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "write", Path: path, Data: base64.StdEncoding.EncodeToString(content)})
			integrationRead(t, ctx, provider, ref, path, content)
			uid := uint32(10001)
			output := integrationExec(t, ctx, provider, ref, sandboxcore.ExecSpec{Argv: []string{"/usr/bin/id", "-u"}, CWD: "/data/projects/1", UID: &uid, GID: &uid, Background: true, Timeout: 10 * time.Second, MaxOutputBytes: 1024})
			if strings.TrimSpace(string(output)) != "10001" {
				t.Fatal("workload did not execute as UID 10001")
			}
			integrationCancellation(t, ctx, provider, ref)
			transfer := integrationToken(t)
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "transfer_begin", Token: transfer})
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "export", Token: transfer, Path: path})
			root := uint32(0)
			fileRequest := sandboxcore.FileRequest{Path: workspacefs.TransferDirectory + "/" + transfer + "/payload", UID: &root, GID: &root, MaxBytes: 4096}
			reader, err := provider.OpenFile(ctx, ref, fileRequest)
			if err != nil {
				t.Fatal("file download:", err)
			}
			data, readErr := io.ReadAll(io.LimitReader(reader, 4097))
			closeErr := reader.Close()
			if readErr != nil || closeErr != nil || !bytes.Equal(data, content) {
				t.Fatal("downloaded snapshot mismatch")
			}
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "transfer_cleanup", Token: transfer})
			transfer = integrationToken(t)
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "transfer_begin", Token: transfer})
			fileRequest.Path = workspacefs.TransferDirectory + "/" + transfer + "/payload"
			if err = provider.PutFile(ctx, ref, fileRequest, bytes.NewReader(content)); err != nil {
				t.Fatal("file upload:", err)
			}
			hash := sha256.Sum256(content)
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "import", Token: transfer, Path: "workspace/imported.txt", ExpectedHash: hex.EncodeToString(hash[:])})
			integrationRead(t, ctx, provider, ref, "workspace/imported.txt", content)
			integrationHelper(t, ctx, provider, ref, workspacefs.Request{Operation: "transfer_cleanup", Token: transfer})
			cleanup()
		})
	}
}

func integrationAccessModes(t *testing.T) []string {
	t.Helper()
	modes := []string{"direct", "server_proxy"}
	if configured := os.Getenv("ANTCDP_TEST_OPENSANDBOX_ACCESS_MODES"); configured != "" {
		modes = strings.Split(configured, ",")
	}
	for _, mode := range modes {
		if mode != "direct" && mode != "server_proxy" {
			t.Fatal("unsupported integration access mode")
		}
	}
	return modes
}

func integrationToken(t *testing.T) string {
	t.Helper()
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}
func integrationWait(ctx context.Context) bool {
	timer := time.NewTimer(200 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func integrationExec(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, spec sandboxcore.ExecSpec) []byte {
	t.Helper()
	var handle *sandboxcore.ExecutionHandle
	_, err := p.Exec(ctx, ref, spec, sandboxcore.ExecCallbacks{Started: func(_ context.Context, h sandboxcore.ExecutionHandle) error { handle = &h; return nil }})
	if err != nil || handle == nil {
		t.Fatal("execution not repeated:", err)
	}
	for {
		result, err := p.InspectExecution(ctx, *handle)
		if err != nil {
			t.Fatal("inspect execution:", err)
		}
		if !result.Running {
			if result.ExitCode == nil || *result.ExitCode != 0 && (len(spec.Argv) == 0 || spec.Argv[0] != workspacefs.HelperPath) {
				t.Fatal("execution did not finish successfully")
			}
			break
		}
		if !integrationWait(ctx) {
			t.Fatal("execution deadline")
		}
	}
	var data []byte
	var cursor int64
	for {
		chunk, err := p.ReadExecutionOutput(ctx, *handle, cursor, 64<<10)
		if err != nil || len(data)+len(chunk.Text) > workspacefs.MaxResponseBytes || chunk.Cursor < cursor || chunk.Cursor == cursor && chunk.Text != "" {
			t.Fatal("invalid execution output:", err)
		}
		data = append(data, chunk.Text...)
		cursor = chunk.Cursor
		if !chunk.Truncated || chunk.Text == "" {
			return data
		}
	}
}
func integrationHelper(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, request workspacefs.Request) workspacefs.Response {
	t.Helper()
	encoded, err := workspacefs.Encode(request)
	if err != nil {
		t.Fatal(err)
	}
	root := uint32(0)
	output := integrationExec(t, ctx, p, ref, sandboxcore.ExecSpec{Argv: []string{workspacefs.HelperPath, encoded}, CWD: "/data", UID: &root, GID: &root, Background: true, Timeout: 55 * time.Second, MaxOutputBytes: workspacefs.MaxResponseBytes})
	var response workspacefs.Response
	decoded := json.Unmarshal(output, &response) == nil
	if decoded && response.Code == "WORKSPACE_CONTROL_PLANE_UNSAFE" {
		var security struct {
			WorkloadUID               int  `json:"workload_uid"`
			CommandDenied             bool `json:"command_denied"`
			InitializationDenied      bool `json:"initialization_denied"`
			TransferPrivate           bool `json:"transfer_private"`
			HelperImmutable           bool `json:"helper_immutable"`
			ControlEnvironmentPrivate bool `json:"control_environment_private"`
			CredentialsAbsent         bool `json:"credentials_absent"`
		}
		if json.Unmarshal(response.Result, &security) == nil {
			t.Logf("security workload_uid=%d command_denied=%t initialization_denied=%t transfer_private=%t helper_immutable=%t control_environment_private=%t credentials_absent=%t", security.WorkloadUID, security.CommandDenied, security.InitializationDenied, security.TransferPrivate, security.HelperImmutable, security.ControlEnvironmentPrivate, security.CredentialsAbsent)
		}
	}
	if !decoded || response.Version != workspacefs.Version || !response.OK {
		t.Fatalf("helper %s failed: %s", request.Operation, response.Code)
	}
	return response
}
func integrationRead(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, path string, expected []byte) {
	t.Helper()
	response := integrationHelper(t, ctx, p, ref, workspacefs.Request{Operation: "read", Path: path})
	var read struct {
		Data string `json:"data_base64"`
	}
	if json.Unmarshal(response.Result, &read) != nil {
		t.Fatal("invalid read result")
	}
	data, err := base64.StdEncoding.DecodeString(read.Data)
	if err != nil || !bytes.Equal(data, expected) {
		t.Fatal("helper read mismatch")
	}
}
func integrationCancellation(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef) {
	t.Helper()
	uid := uint32(10001)
	var handle *sandboxcore.ExecutionHandle
	_, err := p.Exec(ctx, ref, sandboxcore.ExecSpec{Argv: []string{"/bin/sleep", "30"}, CWD: "/data", UID: &uid, GID: &uid, Background: true, Timeout: 40 * time.Second, MaxOutputBytes: 1024}, sandboxcore.ExecCallbacks{Started: func(_ context.Context, h sandboxcore.ExecutionHandle) error { handle = &h; return nil }})
	if err != nil || handle == nil {
		t.Fatal("background launch:", err)
	}
	before, err := p.InspectExecution(ctx, *handle)
	if err != nil || !before.Running {
		t.Fatal("background process was not running:", err)
	}
	if err = p.CancelExecution(ctx, *handle); err != nil {
		t.Fatal("cancellation not repeated:", err)
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for {
		result, err := p.InspectExecution(bounded, *handle)
		if err != nil {
			t.Fatal("cancel inspection:", err)
		}
		if !result.Running && result.ExitCode != nil {
			return
		}
		if !integrationWait(bounded) {
			t.Fatal("cancel acceptance never became a confirmed terminal process")
		}
	}
}
