package opensandbox

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

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
			if result.ExitCode == nil || *result.ExitCode != 0 {
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
		if err != nil || len(data)+len(chunk.Stdout) > 1<<20 || chunk.Cursor < cursor || chunk.Cursor == cursor && chunk.Stdout != "" {
			t.Fatal("invalid execution output:", err)
		}
		data = append(data, chunk.Stdout...)
		cursor = chunk.Cursor
		if !chunk.Truncated {
			if !chunk.Pending {
				return data
			}
			if !integrationWait(ctx) {
				t.Fatal("output drain deadline")
			}
		}
	}
}
func integrationCancellation(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef) {
	t.Helper()
	var handle *sandboxcore.ExecutionHandle
	_, err := p.Exec(ctx, ref, sandboxcore.ExecSpec{Argv: []string{"/bin/sleep", "30"}, CWD: "/data", Background: true, Timeout: 40 * time.Second, MaxOutputBytes: 1024}, sandboxcore.ExecCallbacks{Started: func(_ context.Context, h sandboxcore.ExecutionHandle) error { handle = &h; return nil }})
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
