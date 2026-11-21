package opensandbox

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestOpenSandboxNativeRuntimeIntegration(t *testing.T) {
	for _, mode := range integrationAccessModes(t) {
		t.Run(mode, func(t *testing.T) {
			connection, image := integrationConnection(t, mode)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			p, err := testFactory(t).Open(ctx, connection)
			if err != nil {
				t.Fatal(err)
			}
			ref, stop := integrationResource(t, ctx, p, integrationSpec(t, image, sandboxcore.DefaultPolicy()))
			fs := p.(sandboxcore.Filesystem)
			dir := "/data/native/中文 空格"
			name := dir + "/测试.txt"
			if err = fs.MakeDirectory(ctx, ref, dir, 755); err != nil {
				t.Fatal("mkdir", err)
			}
			data := []byte("native\n原生文件\n")
			if err = fs.PutFile(ctx, ref, sandboxcore.FileRequest{Path: name, MaxBytes: 100}, bytes.NewReader(data)); err != nil {
				t.Fatal("upload", err)
			}
			info, err := fs.StatFile(ctx, ref, name)
			if err != nil || info.Size != int64(len(data)) {
				t.Fatal("stat", info, err)
			}
			entries, err := fs.ListFiles(ctx, ref, dir)
			if err != nil || len(entries) != 1 || entries[0].Path != name {
				t.Fatal("list", entries, err)
			}
			found, err := fs.SearchFiles(ctx, ref, "/data/native", "**/*.txt")
			if err != nil || len(found) != 1 {
				t.Fatal("search", found, err)
			}
			r, err := fs.OpenFile(ctx, ref, sandboxcore.FileRequest{Path: name, Offset: 1, Length: 4, MaxBytes: 4})
			if err != nil {
				t.Fatal(err)
			}
			portion, err := io.ReadAll(r)
			closeErr := r.Close()
			if err != nil || closeErr != nil || string(portion) != "ativ" {
				t.Fatal("range", string(portion), err, closeErr)
			}
			n, err := fs.ReplaceFile(ctx, ref, name, "native", "official")
			if err != nil || n != 1 {
				t.Fatal("replace", n, err)
			}
			if err = fs.SetFilePermissions(ctx, ref, name, 600); err != nil {
				t.Fatal("permissions", err)
			}
			moved := dir + "/moved.txt"
			if err = fs.MoveFile(ctx, ref, name, moved); err != nil {
				t.Fatal("move", err)
			}
			integrationNativeRead(t, ctx, p, ref, moved, []byte("official\n原生文件\n"))
			output := integrationExec(t, ctx, p, ref, sandboxcore.ExecSpec{Argv: []string{"/bin/sh", "-c", "printf native-ok"}, CWD: dir, Background: true, Timeout: 10 * time.Second, MaxOutputBytes: 1024})
			if string(output) != "native-ok" {
				t.Fatalf("command output %q", output)
			}
			integrationCommandLog(t, ctx, p, ref, dir)
			integrationCancellation(t, ctx, p, ref)
			if err = fs.RemoveFile(ctx, ref, moved, false); err != nil {
				t.Fatal("remove file", err)
			}
			if err = fs.RemoveFile(ctx, ref, "/data/native", true); err != nil {
				t.Fatal("remove dir", err)
			}
			if !stop() {
				t.Fatal("cleanup unconfirmed")
			}
		})
	}
}

func integrationNativeRead(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, name string, want []byte) {
	t.Helper()
	r, err := p.OpenFile(ctx, ref, sandboxcore.FileRequest{Path: name, MaxBytes: int64(len(want) + 1)})
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(r)
	closeErr := r.Close()
	if err != nil || closeErr != nil || !bytes.Equal(got, want) {
		t.Fatal("native content mismatch", err, closeErr)
	}
}

func integrationCommandLog(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, cwd string) {
	t.Helper()
	settled := make(chan error, 1)
	result, err := p.Exec(ctx, ref, sandboxcore.ExecSpec{Command: "head -c 72000 /dev/zero | tr '\\000' x; printf TAIL; printf 'last diagnostic' >&2; exit 7", CWD: cwd, Background: true, Timeout: 20 * time.Second, MaxOutputBytes: 4096}, sandboxcore.ExecCallbacks{Started: func(context.Context, sandboxcore.ExecutionHandle) error { return nil }, Finished: func(_ context.Context, r sandboxcore.ExecResult, err error) {
		if err == nil && (r.ExitCode == nil || *r.ExitCode != 7) {
			err = fmt.Errorf("missing nonzero exit: %v", r)
		}
		settled <- err
	}})
	if err != nil || result.Handle == nil {
		t.Fatal("launch", err)
	}
	select {
	case err = <-settled:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	preview, err := p.ReadExecutionOutput(ctx, *result.Handle, sandboxcore.PreviewCursor, 4096)
	if err != nil || preview.Incomplete || preview.Pending || !preview.Truncated || preview.Stderr != "last diagnostic" || !strings.HasSuffix(preview.Stdout, "TAIL") {
		t.Fatal("invalid preview", preview.Stderr, err)
	}
	var cursor int64
	var out, stderr strings.Builder
	for {
		page, e := p.ReadExecutionOutput(ctx, *result.Handle, cursor, 8192)
		if e != nil {
			t.Fatal(e)
		}
		out.WriteString(page.Stdout)
		stderr.WriteString(page.Stderr)
		if !page.Truncated {
			break
		}
		if page.Cursor <= cursor {
			t.Fatal("cursor did not advance")
		}
		cursor = page.Cursor
	}
	if out.String() != strings.Repeat("x", 72000)+"TAIL" || stderr.String() != "last diagnostic" {
		t.Fatalf("retained log mismatch: stdout bytes=%d, stderr=%q", out.Len(), stderr.String())
	}
}
