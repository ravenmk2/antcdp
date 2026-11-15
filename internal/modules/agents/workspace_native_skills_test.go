package agents

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

type nativeSkillProvider struct {
	sandboxcore.Provider
	sandboxcore.Filesystem
	calls        []string
	moves        int
	publishError error
}

func (p *nativeSkillProvider) StatFile(_ context.Context, _ sandboxcore.ResourceRef, name string) (sandboxcore.FileInfo, error) {
	return sandboxcore.FileInfo{Path: name, Kind: "directory"}, nil
}
func (p *nativeSkillProvider) MakeDirectory(_ context.Context, _ sandboxcore.ResourceRef, name string, _ int) error {
	p.calls = append(p.calls, "mkdir "+name)
	return nil
}
func (p *nativeSkillProvider) MoveFile(_ context.Context, _ sandboxcore.ResourceRef, from, to string) error {
	p.calls = append(p.calls, "move "+from+" -> "+to)
	p.moves++
	if p.moves == 2 {
		return p.publishError
	}
	return nil
}
func (p *nativeSkillProvider) RemoveFile(_ context.Context, _ sandboxcore.ResourceRef, name string, _ bool) error {
	p.calls = append(p.calls, "remove "+name)
	return nil
}

func TestNativeSkillPublicationRestoresOnlyAfterKnownFailure(t *testing.T) {
	var bundle bytes.Buffer
	z := zip.NewWriter(&bundle)
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"success", "rejected", "unknown"} {
		t.Run(state, func(t *testing.T) {
			p := &nativeSkillProvider{}
			if state != "success" {
				p.publishError = &sandboxcore.Error{Code: "SANDBOX_UPLOAD_FAILED", Unknown: state == "unknown"}
			}
			a := &SandboxAccess{Provider: p, WorkspaceOperationID: 42}
			result, err := installNativeSkills(context.Background(), a, workspacefs.Request{AgentID: "1", SkillSetHash: "empty", Skills: []workspacefs.SkillArchive{}}, bundle.Bytes())
			if state == "success" {
				if err != nil || !result.OK || p.moves != 2 || !strings.Contains(p.calls[len(p.calls)-1], "42-previous") {
					t.Fatal(result, err, p.calls)
				}
				return
			}
			if err == nil {
				t.Fatal("failed publish reported success")
			}
			if state == "unknown" {
				if p.moves != 2 || len(p.calls) != 3 {
					t.Fatal("uncertain publish was rolled back or cleaned", p.calls)
				}
			} else {
				if p.moves != 3 || len(p.calls) != 5 || !strings.Contains(p.calls[3], "42-previous -> /data/agents/1/skills") {
					t.Fatal("previous skill directory not restored", p.calls)
				}
			}
		})
	}
}

func TestNativeSkillsRejectCorruptBundleBeforeRemoteIO(t *testing.T) {
	p := &nativeSkillProvider{}
	a := &SandboxAccess{Provider: p, WorkspaceOperationID: 42}
	if _, err := installNativeSkills(context.Background(), a, workspacefs.Request{AgentID: "1"}, []byte("corrupt")); err == nil || len(p.calls) != 0 {
		t.Fatal("corrupt archive reached sandbox")
	}
}

func (p *nativeSkillProvider) OpenFile(context.Context, sandboxcore.ResourceRef, sandboxcore.FileRequest) (io.ReadCloser, error) {
	panic("unexpected read")
}
func (p *nativeSkillProvider) PutFile(context.Context, sandboxcore.ResourceRef, sandboxcore.FileRequest, io.Reader) error {
	panic("unexpected upload")
}
