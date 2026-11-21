package opensandbox

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Kill the local reader process after its first durable output, leaving execd
// and the command alive. A fresh factory must identify the log gap and
// observe the original exit without launching another command.
func TestCommandStreamReaderCrashIntegration(t *testing.T) {
	const refEnv = "ANTCDP_TEST_STREAM_RESOURCE"
	conn, image := integrationConnection(t, "server_proxy")
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	dir := os.Getenv("ANTCDP_TEST_STREAM_DIR")
	if raw := os.Getenv(refEnv); raw != "" {
		var ref sandboxcore.ResourceRef
		if err := json.Unmarshal([]byte(raw), &ref); err != nil {
			t.Fatal(err)
		}
		factory := NewFactory(dir)
		defer factory.Close()
		p, err := factory.Open(ctx, conn)
		if err != nil {
			t.Fatal(err)
		}
		result, err := p.Exec(ctx, ref, sandboxcore.ExecSpec{Command: "echo prefix; sleep 4; echo missing-tail >&2; exit 17", CWD: "/tmp", Background: true, Timeout: 15 * time.Second, MaxOutputBytes: 4096}, sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }})
		if err != nil {
			t.Fatal(err)
		}
		for {
			o, err := p.ReadExecutionOutput(ctx, *result.Handle, 0, 4096)
			if err != nil {
				t.Fatal(err)
			}
			if o.Stdout == "prefix\n" {
				break
			}
			if !integrationWait(ctx) {
				t.Fatal("missing prefix")
			}
		}
		if err = os.WriteFile(filepath.Join(dir, "handle"), []byte(result.Handle.ID), 0600); err != nil {
			t.Fatal(err)
		}
		<-ctx.Done()
		t.Fatal("reader was not interrupted")
	}
	dir = t.TempDir()
	factory := NewFactory(dir)
	defer factory.Close()
	p, err := factory.Open(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	ref, stop := integrationResource(t, ctx, p, integrationSpec(t, image, sandboxcore.DefaultPolicy()))
	raw, err := json.Marshal(ref)
	if err != nil {
		t.Fatal(err)
	}
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCommandStreamReaderCrashIntegration$")
	child.Env = append(os.Environ(), refEnv+"="+string(raw), "ANTCDP_TEST_STREAM_DIR="+dir)
	if err = child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if child.ProcessState == nil {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}()
	var id []byte
	for {
		id, err = os.ReadFile(filepath.Join(dir, "handle"))
		if err == nil && len(id) > 0 {
			break
		}
		if !integrationWait(ctx) {
			t.Fatal("no durable output and handle")
		}
	}
	handle := sandboxcore.ExecutionHandle{Resource: ref, ID: string(id)}
	before, err := p.InspectExecution(ctx, handle)
	if err != nil || !before.Running {
		t.Fatal("command not running before crash", before, err)
	}
	if err = child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	for {
		st, err := p.InspectExecution(ctx, handle)
		if err != nil {
			t.Fatal(err)
		}
		if !st.Running {
			if st.ExitCode == nil || *st.ExitCode != 17 {
				t.Fatal("exit not recovered", st)
			}
			break
		}
		if !integrationWait(ctx) {
			t.Fatal("command did not finish")
		}
	}
	o, err := p.ReadExecutionOutput(ctx, handle, 0, 4096)
	if err != nil || o.Stdout != "prefix\n" || o.Stderr != "" || o.Pending || !o.Incomplete {
		t.Fatal("lost stream not identified", o, err)
	}
	if !stop() {
		t.Fatal("cleanup unconfirmed")
	}
}
