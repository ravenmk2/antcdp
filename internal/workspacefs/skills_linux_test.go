//go:build linux

package workspacefs

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

func skillInstallRequest(t *testing.T, e *Engine, body string) Request {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, text := range map[string]string{"review/SKILL.md": "---\nname: review\ndescription: Review source code.\n---\n" + body, "review/references/check.md": "Check tests."} {
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(entry, text); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	pkg, err := skillpackage.Validate(t.Context(), bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var bundle bytes.Buffer
	outer := zip.NewWriter(&bundle)
	entry, err := outer.CreateHeader(&zip.FileHeader{Name: "review.zip", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = outer.Close(); err != nil {
		t.Fatal(err)
	}
	transfer, err := token()
	if err != nil {
		t.Fatal(err)
	}
	handle(t, e, Request{Operation: "transfer_begin", Token: transfer})
	if err = os.WriteFile(filepath.Join(e.TransferRoot, transfer, "payload"), bundle.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(bundle.Bytes())
	return Request{Version: Version, Operation: "skills_install", AgentID: "1", Token: transfer, ExpectedHash: hex.EncodeToString(digest[:]), SkillSetHash: strings.Repeat("a", 64), Skills: []SkillArchive{{Name: "review", ArchiveSHA: pkg.ArchiveSHA256, ContentSHA: pkg.ContentSHA256}}}
}

func TestSkillSetPublicationIsVerifiedAtomicAndProtected(t *testing.T) {
	e := engineFixture(t)
	first := skillInstallRequest(t, e, "original instructions")
	handle(t, e, first)
	name := filepath.Join(e.WorkspaceRoot, "agents", "1", "skills", "review", "SKILL.md")
	before, err := os.ReadFile(name)
	if err != nil || !bytes.Contains(before, []byte("original instructions")) {
		t.Fatal("missing published instructions", err)
	}
	stat, err := os.Stat(name)
	if err != nil || stat.Mode().Perm()&0222 != 0 {
		t.Fatal("skill file remained writable", err)
	}
	write := e.Handle(t.Context(), Request{Version: Version, Operation: "write", Path: "agents/1/skills/review/SKILL.md", Data: "Y2hhbmdlZA=="})
	if write.OK || write.Code != "WORKSPACE_PATH_PROTECTED" {
		t.Fatalf("public write reached skills: %+v", write)
	}
	corrupt := skillInstallRequest(t, e, "corrupt replacement")
	corrupt.Skills[0].ContentSHA = strings.Repeat("0", 64)
	response := e.Handle(t.Context(), corrupt)
	if response.OK {
		t.Fatal("unverified package was installed")
	}
	unchanged, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(before, unchanged) {
		t.Fatal("failed staging modified active skill files", err)
	}
	replacement := skillInstallRequest(t, e, "new instructions")
	handle(t, e, replacement)
	after, err := os.ReadFile(name)
	if err != nil || !bytes.Contains(after, []byte("new instructions")) {
		t.Fatal("replacement missing", err)
	}
	entries, err := os.ReadDir(filepath.Join(e.WorkspaceRoot, ".system", "skills"))
	if err != nil || len(entries) != 0 {
		t.Fatal("staging directories not cleaned", err)
	}
}

func TestSkillPublicationRejectsReplacingAnotherAgentOrEscaping(t *testing.T) {
	e := engineFixture(t)
	request := skillInstallRequest(t, e, "instructions")
	request.Skills[0].Name = "../outside"
	if result := e.Handle(t.Context(), request); result.OK {
		t.Fatal("accepted traversal")
	}
	request = skillInstallRequest(t, e, "instructions")
	request.AgentID = "../2"
	if result := e.Handle(t.Context(), request); result.OK {
		t.Fatal("accepted agent path injection")
	}
}
