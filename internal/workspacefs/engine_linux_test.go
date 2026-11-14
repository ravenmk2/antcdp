//go:build linux

package workspacefs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func engineFixture(t *testing.T) *Engine {
	t.Helper()
	data, transfers := t.TempDir(), t.TempDir()
	if err := os.Chmod(transfers, 0700); err != nil {
		t.Fatal(err)
	}
	e := &Engine{WorkspaceRoot: data, TransferRoot: transfers, UID: os.Getuid(), GID: os.Getgid()}
	response := e.Handle(context.Background(), Request{Version: Version, Operation: "initialize", AgentID: "1", ProjectID: "2"})
	if !response.OK {
		t.Fatalf("initialize: %+v", response)
	}
	return e
}
func handle(t *testing.T, e *Engine, q Request) Response {
	t.Helper()
	q.Version = Version
	r := e.Handle(context.Background(), q)
	if !r.OK {
		t.Fatalf("%s: %+v", q.Operation, r)
	}
	return r
}
func TestSafeFilesAndConditionalRemoval(t *testing.T) {
	e := engineFixture(t)
	name := "projects/2/report.txt"
	encoded := base64.StdEncoding.EncodeToString([]byte("hello world"))
	handle(t, e, Request{Operation: "write", Path: name, Data: encoded})
	r := handle(t, e, Request{Operation: "read", Path: name})
	var read struct {
		Data     string `json:"data_base64"`
		Identity string `json:"identity"`
	}
	if json.Unmarshal(r.Result, &read) != nil || read.Data != encoded {
		t.Fatalf("read: %s", r.Result)
	}
	handle(t, e, Request{Operation: "edit", Path: name, Pattern: "world", Data: base64.StdEncoding.EncodeToString([]byte("reader"))})
	r = e.Handle(context.Background(), Request{Version: Version, Operation: "remove", Path: name, Identity: read.Identity})
	if r.OK || r.Code != "WORKSPACE_ENTRY_CHANGED" || r.Changed {
		t.Fatalf("stale removal: %+v", r)
	}
	r = handle(t, e, Request{Operation: "read", Path: name})
	if json.Unmarshal(r.Result, &read) != nil {
		t.Fatal("decode")
	}
	handle(t, e, Request{Operation: "remove", Path: name, Identity: read.Identity})
	if _, err := os.Stat(filepath.Join(e.WorkspaceRoot, name)); !os.IsNotExist(err) {
		t.Fatal("file was not removed")
	}
}

func TestSymlinksAndHardLinksNeverAuthorizeIO(t *testing.T) {
	e := engineFixture(t)
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret")
	if err := os.WriteFile(secret, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(e.WorkspaceRoot, "workspace", "link")); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"read", "write", "export", "mkdir"} {
		r := e.Handle(context.Background(), Request{Version: Version, Operation: op, Path: "workspace/link/secret", Token: strings.Repeat("a", 32), Data: base64.StdEncoding.EncodeToString([]byte("changed"))})
		if r.OK {
			t.Fatalf("followed link for %s", op)
		}
	}
	data, err := os.ReadFile(secret)
	if err != nil || string(data) != "private" {
		t.Fatal("escaped write")
	}
	if err = os.Link(secret, filepath.Join(e.WorkspaceRoot, "workspace", "hard")); err != nil {
		t.Fatal(err)
	}
	r := e.Handle(context.Background(), Request{Version: Version, Operation: "read", Path: "workspace/hard"})
	if r.OK || r.Code != "WORKSPACE_NOT_REGULAR_FILE" {
		t.Fatalf("hard link: %+v", r)
	}
}

func TestExportIsStableAndImportNeverOverwrites(t *testing.T) {
	e := engineFixture(t)
	name := "workspace/source.txt"
	handle(t, e, Request{Operation: "write", Path: name, Data: base64.StdEncoding.EncodeToString([]byte("stable snapshot"))})
	tokenID := strings.Repeat("b", 32)
	handle(t, e, Request{Operation: "transfer_begin", Token: tokenID})
	r := handle(t, e, Request{Operation: "export", Token: tokenID, Path: name})
	var saved struct {
		SHA string `json:"sha256"`
	}
	if json.Unmarshal(r.Result, &saved) != nil {
		t.Fatal("decode")
	}
	if err := os.WriteFile(filepath.Join(e.WorkspaceRoot, name), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(e.TransferRoot, tokenID, "payload"))
	if err != nil || string(b) != "stable snapshot" {
		t.Fatal("snapshot was mutable")
	}
	handle(t, e, Request{Operation: "import", Token: tokenID, Path: "workspace/imported.txt", ExpectedHash: saved.SHA})
	r = e.Handle(context.Background(), Request{Version: Version, Operation: "import", Token: tokenID, Path: "workspace/imported.txt", ExpectedHash: saved.SHA})
	if r.OK || r.Code != "WORKSPACE_PATH_EXISTS" {
		t.Fatalf("import overwrite: %+v", r)
	}
	handle(t, e, Request{Operation: "transfer_cleanup", Token: tokenID})
}
