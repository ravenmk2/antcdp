package opensandbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func testOwner() sandboxcore.Ownership {
	return sandboxcore.Ownership{InstallationID: strings.Repeat("a", 32), ComputerID: 7, CreationToken: strings.Repeat("b", 32)}
}
func testRef() sandboxcore.ResourceRef {
	return sandboxcore.ResourceRef{BackendGeneration: 1, RemoteID: "sandbox-1", Ownership: testOwner()}
}
func testInfo() sdk.SandboxInfo {
	return sdk.SandboxInfo{ID: "sandbox-1", Metadata: metadata(testOwner()), Status: sdk.SandboxStatus{State: sdk.StateRunning}}
}
func testSpec(t *testing.T) sandboxcore.CreateSpec {
	t.Helper()
	snapshot, err := sandboxcore.SnapshotPolicy(sandboxcore.DefaultPolicy())
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := sandboxcore.CompilePolicy(snapshot, nil)
	if err != nil {
		t.Fatal(err)
	}
	return sandboxcore.CreateSpec{BackendGeneration: 1, Ownership: testOwner(), Config: sandboxcore.EffectiveConfig{RuntimeBackend: "docker", Environment: sandboxcore.Environment{Image: "example/runtime:v1", CPUMillicores: 2000, MemoryMiB: 4096}, Network: snapshot}, Network: compiled, Mount: sandboxcore.MountPlan{Kind: "named_volume", MountPath: "/data", VolumeID: strings.Repeat("c", 32), VolumeName: "acdp-aaaaaaaa-" + strings.Repeat("c", 32), CreateIfMissing: true}}
}
func jsonReply(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Error(err)
	}
}
func providerFor(t *testing.T, server *httptest.Server, mode string) sandboxcore.Provider {
	t.Helper()
	p, err := (Factory{}).Open(context.Background(), sandboxcore.Connection{Endpoint: server.URL, AccessMode: mode, APIKey: "private-test-key", ControlKey: []byte(strings.Repeat("k", 32))})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCreateReturnsIDWithoutReadinessOrHiddenCleanup(t *testing.T) {
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/sandboxes" {
			t.Errorf("unexpected readiness/cleanup request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		posts.Add(1)
		if r.Header.Get("OPEN-SANDBOX-API-KEY") != "private-test-key" {
			t.Error("control authentication missing")
		}
		var req sdk.CreateSandboxRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if req.Timeout != nil || req.SecureAccess || len(req.Volumes) != 1 || req.Volumes[0].PVC == nil {
			t.Fatalf("unexpected create config %+v", req)
		}
		if req.Env["EXECD_ACCESS_TOKEN"] != testControlToken(t) || len(req.Env) != 1 {
			t.Error("missing sandbox-scoped daemon token")
		}
		volume := req.Volumes[0]
		if volume.MountPath != "/data" || volume.Host != nil || volume.SubPath != "" || volume.PVC.DeleteOnSandboxTermination == nil || *volume.PVC.DeleteOnSandboxTermination {
			t.Error("unsafe volume mapping")
		}
		if got := *volume.PVC.CreateIfNotExists; got != (posts.Load() == 1) {
			t.Errorf("create flag %v", got)
		}
		jsonReply(t, w, testInfo())
	}))
	defer server.Close()
	p := providerFor(t, server, "direct")
	spec := testSpec(t)
	for range 2 {
		out, err := p.Create(context.Background(), spec)
		if err != nil || out.Ref.RemoteID != "sandbox-1" {
			t.Fatalf("create: %+v %v", out, err)
		}
		spec.Mount.CreateIfMissing = false
	}
	if posts.Load() != 2 {
		t.Fatal("create repeated")
	}
}

func TestUnknownCreateNeverRetriesOrDeletes(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "POST" {
			t.Error("unexpected cleanup")
		}
		w.WriteHeader(503)
		_, _ = io.WriteString(w, `{"code":"fail","message":"private-secret remote body"}`)
	}))
	defer server.Close()
	_, err := providerFor(t, server, "direct").Create(context.Background(), testSpec(t))
	var detail *sandboxcore.Error
	if !errors.As(err, &detail) || !detail.Unknown || strings.Contains(err.Error(), "private-secret") || requests.Load() != 1 {
		t.Fatalf("unexpected error/count: %v %d", err, requests.Load())
	}
}

func TestCreatePreservesIDOnUntrustedOwnershipResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := testInfo()
		info.Metadata = nil
		jsonReply(t, w, info)
	}))
	defer server.Close()
	out, err := providerFor(t, server, "direct").Create(context.Background(), testSpec(t))
	var detail *sandboxcore.Error
	if out.Ref.RemoteID != "sandbox-1" || !errors.As(err, &detail) || !detail.Unknown {
		t.Fatalf("lost known id: %+v %v", out, err)
	}
}

func TestOwnershipMismatchNeverDeletes(t *testing.T) {
	var deletes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			deletes.Add(1)
		}
		info := testInfo()
		info.Metadata[installationKey] = strings.Repeat("f", 32)
		jsonReply(t, w, info)
	}))
	defer server.Close()
	err := providerFor(t, server, "direct").Terminate(context.Background(), testRef())
	if err == nil || deletes.Load() != 0 {
		t.Fatalf("foreign resource touched: %v", err)
	}
}

func TestFindRequiresTrustworthyPaginationAndOwnership(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		t.Run(fmt.Sprint(foreign), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.URL.Query().Get("metadata"), creationKey+"=") {
					t.Error("missing creation filter")
				}
				info := testInfo()
				if foreign {
					info.Metadata[creationKey] = "foreign"
				}
				jsonReply(t, w, sdk.ListSandboxesResponse{Items: []sdk.SandboxInfo{info}, Pagination: sdk.PaginationInfo{Page: 1, PageSize: 2, TotalItems: 3, TotalPages: 2, HasNextPage: true}})
			}))
			defer server.Close()
			out, err := providerFor(t, server, "direct").Find(context.Background(), testOwner(), 1, 2)
			if foreign {
				if err == nil {
					t.Fatal("foreign match accepted")
				}
			} else if err != nil || !out.HasMore || len(out.Items) != 1 {
				t.Fatalf("page lost: %+v %v", out, err)
			}
		})
	}
}

type execFixture struct {
	server                      *httptest.Server
	commands, statuses, cancels atomic.Int32
	stream                      string
	background                  bool
	proxy                       bool
	statusRunning               bool
	exit                        *int32
}

func newExecFixture(t *testing.T, stream string, proxy bool) *execFixture {
	t.Helper()
	f := &execFixture{stream: stream, proxy: proxy}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/sandboxes/") && !strings.Contains(r.URL.Path, "/proxy/") {
			if r.Header.Get("OPEN-SANDBOX-API-KEY") != "private-test-key" {
				t.Error("missing control key")
			}
			if strings.Contains(r.URL.Path, "/endpoints/") {
				if r.URL.Query().Get("use_server_proxy") != fmt.Sprint(proxy) {
					t.Error("wrong access mode")
				}
				endpoint := f.server.URL + "/data"
				if proxy {
					endpoint = f.server.URL + "/v1/sandboxes/sandbox-1/proxy/44772"
				}
				jsonReply(t, w, sdk.Endpoint{Endpoint: endpoint})
			} else {
				jsonReply(t, w, testInfo())
			}
			return
		}
		if r.Header.Get("X-EXECD-ACCESS-TOKEN") != testControlToken(t) {
			t.Error("missing scoped token")
		}
		if (r.Header.Get("OPEN-SANDBOX-API-KEY") != "") != proxy {
			t.Error("server key crossed direct endpoint boundary")
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/command") && r.Method == "POST":
			f.commands.Add(1)
			var req sdk.RunCommandRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Error(err)
			}
			if req.Timeout != 1000 {
				t.Errorf("timeout not milliseconds: %d", req.Timeout)
			}
			f.background = req.Background
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, f.stream)
		case strings.HasSuffix(r.URL.Path, "/command") && r.Method == "DELETE":
			f.cancels.Add(1)
			w.WriteHeader(204)
		case strings.Contains(r.URL.Path, "/command/status/"):
			f.statuses.Add(1)
			jsonReply(t, w, sdk.CommandStatusResponse{ID: "exec-1", Running: f.statusRunning, ExitCode: f.exit})
		case strings.HasSuffix(r.URL.Path, "/ping"):
			w.WriteHeader(200)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}
func execSpec() sandboxcore.ExecSpec {
	return sandboxcore.ExecSpec{Argv: []string{"/bin/echo", "ok"}, CWD: "/data", Timeout: time.Second, MaxOutputBytes: 4096}
}

const initFrame = "data: {\"type\":\"init\",\"text\":\"exec-1\"}\n\n"

func TestExecPersistsHandleBeforeOutputAndAuthenticatesBothPaths(t *testing.T) {
	for _, proxy := range []bool{false, true} {
		t.Run(fmt.Sprint(proxy), func(t *testing.T) {
			f := newExecFixture(t, initFrame+"data: {\"type\":\"stdout\",\"text\":\"ok\"}\n\ndata: {\"type\":\"execution_complete\",\"exit_code\":0}\n\n", proxy)
			mode := "direct"
			if proxy {
				mode = "server_proxy"
			}
			saved := false
			text := ""
			out, err := providerFor(t, f.server, mode).Exec(context.Background(), testRef(), execSpec(), sandboxcore.ExecCallbacks{Started: func(_ context.Context, h sandboxcore.ExecutionHandle) error { saved = h.ID == "exec-1"; return nil }, Output: func(_ context.Context, o sandboxcore.Output) error {
				if !saved {
					t.Error("output preceded durable handle")
				}
				text += o.Text
				return nil
			}})
			if err != nil || out.Running || out.ExitCode == nil || *out.ExitCode != 0 || text != "ok" || f.commands.Load() != 1 {
				t.Fatalf("exec %+v %v text=%q", out, err, text)
			}
		})
	}
}

func TestExecPersistenceFailureRetainsUncertainHandle(t *testing.T) {
	f := newExecFixture(t, initFrame+"data: {\"type\":\"stdout\",\"text\":\"must not deliver\"}\n\n", false)
	out, err := providerFor(t, f.server, "direct").Exec(context.Background(), testRef(), execSpec(), sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return errors.New("database failed") }, Output: func(context.Context, sandboxcore.Output) error { t.Error("output delivered"); return nil }})
	var detail *sandboxcore.Error
	if !errors.As(err, &detail) || !detail.Unknown || out.Handle == nil || out.Handle.ID != "exec-1" || f.commands.Load() != 1 || f.cancels.Load() != 0 {
		t.Fatalf("unknown execution lost: %+v %v", out, err)
	}
}

func TestBackgroundAckAndCancelAreNotProcessCompletion(t *testing.T) {
	f := newExecFixture(t, initFrame+"data: {\"type\":\"execution_complete\",\"exit_code\":0}\n\n", false)
	p := providerFor(t, f.server, "direct")
	spec := execSpec()
	spec.Background = true
	out, err := p.Exec(context.Background(), testRef(), spec, sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }})
	if err != nil || !out.Running || out.ExitCode != nil {
		t.Fatalf("launch misclassified: %+v %v", out, err)
	}
	if err = p.CancelExecution(context.Background(), *out.Handle); err != nil {
		t.Fatal(err)
	}
	if f.cancels.Load() != 1 || f.statuses.Load() != 0 {
		t.Fatal("cancel implied completion")
	}
}

func TestForegroundMissingExitUsesStatus(t *testing.T) {
	f := newExecFixture(t, initFrame+"{\"type\":\"execution_complete\"}\n\n", false)
	exit := int32(7)
	f.exit = &exit
	out, err := providerFor(t, f.server, "direct").Exec(context.Background(), testRef(), execSpec(), sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }})
	if err != nil || out.ExitCode == nil || *out.ExitCode != 7 || f.statuses.Load() != 1 {
		t.Fatalf("missing exit invented: %+v %v", out, err)
	}
}

func TestTruncatedStreamIsUnknownAndNeverReplayed(t *testing.T) {
	f := newExecFixture(t, initFrame, false)
	out, err := providerFor(t, f.server, "direct").Exec(context.Background(), testRef(), execSpec(), sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }})
	var detail *sandboxcore.Error
	if !errors.As(err, &detail) || !detail.Unknown || out.Handle == nil || f.commands.Load() != 1 {
		t.Fatalf("truncated stream: %+v %v", out, err)
	}
}

func TestForegroundTerminalErrorAndLateOutput(t *testing.T) {
	for _, terminal := range []string{
		`{"type":"error","error":{"ename":"CommandExecError","evalue":"7"}}`,
		`{"type":"error","error":{"exit_code":7}}`,
		`{"type":"execution_complete","exit_code":7}`,
	} {
		t.Run(terminal, func(t *testing.T) {
			f := newExecFixture(t, initFrame+"data: "+terminal+"\n\ndata: {\"type\":\"stdout\",\"text\":\"last output\"}\n\ndata: {\"type\":\"stderr\",\"text\":\"last error\"}\n\n", false)
			code := int32(7)
			f.exit = &code
			var output []sandboxcore.Output
			out, err := providerFor(t, f.server, "direct").Exec(context.Background(), testRef(), execSpec(), sandboxcore.ExecCallbacks{
				Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil },
				Output:  func(_ context.Context, value sandboxcore.Output) error { output = append(output, value); return nil },
			})
			if err != nil || out.Running || out.ExitCode == nil || *out.ExitCode != 7 || len(output) != 2 || output[0].Text != "last output" || output[1].Stream != "stderr" || f.commands.Load() != 1 {
				t.Fatalf("terminal result or trailing output lost: %+v %v output=%+v", out, err, output)
			}
		})
	}
}

func TestEventWireBoundAndOutputTruncation(t *testing.T) {
	reader := &eventBoundReader{ReadCloser: io.NopCloser(strings.NewReader(strings.Repeat("x", 2<<20)))}
	if _, err := io.ReadAll(reader); err == nil {
		t.Fatal("unbounded wire line accepted")
	}
	f := newExecFixture(t, initFrame+"data: {\"type\":\"stdout\",\"text\":\"中文a\"}\n\ndata: {\"type\":\"execution_complete\",\"exit_code\":0}\n\n", false)
	spec := execSpec()
	spec.MaxOutputBytes = 4
	output := ""
	out, err := providerFor(t, f.server, "direct").Exec(context.Background(), testRef(), spec, sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }, Output: func(_ context.Context, o sandboxcore.Output) error { output += o.Text; return nil }})
	if err != nil || !out.OutputTruncated || output != "中" {
		t.Fatalf("unsafe truncation %q %+v %v", output, out, err)
	}
}

func TestRawFileTransportRejectsWorkloadPaths(t *testing.T) {
	for _, p := range []string{"/data/user-secret", "/run/antcdp-transfers/../secret", "/run/antcdp-transfers/", "/run/antcdp-transfers//file"} {
		if err := validateFile(sandboxcore.FileRequest{Path: p, MaxBytes: 10}); err == nil {
			t.Errorf("unsafe raw path accepted %q", p)
		}
	}
	if err := validateFile(sandboxcore.FileRequest{Path: "/run/antcdp-transfers/token/upload", MaxBytes: 10}); err != nil {
		t.Fatal(err)
	}
}
