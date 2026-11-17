package agents

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type cwdProvider struct {
	nativeTestProvider
	directories []string
}

func (p *cwdProvider) MakeDirectory(_ context.Context, _ sandboxcore.ResourceRef, name string, _ int) error {
	p.directories = append(p.directories, name)
	return nil
}

func TestRootSessionPreparesWorkingDirectory(t *testing.T) {
	for _, tc := range []struct {
		name    string
		session SessionRow
		cwd     string
	}{
		{"root", SessionRow{ID: 12}, "/data/sessions/12"},
		{"child", SessionRow{ID: 34, RootSessionID: new(uint64(12))}, "/data/sessions/12"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cwd, err := sessionCWD(&tc.session)
			if err != nil || cwd != tc.cwd {
				t.Fatalf("CWD = %q: %v", cwd, err)
			}
			p := &cwdProvider{}
			result, err := runNativeRequest(t.Context(), &SandboxAccess{Provider: p}, workspace.Request{Operation: "initialize", Path: strings.TrimPrefix(cwd, "/data/"), AgentID: "9"})
			if err != nil {
				t.Fatal(err)
			}
			var initialized struct {
				CWD string `json:"cwd"`
			}
			if err = json.Unmarshal(result.Result, &initialized); err != nil || initialized.CWD != cwd {
				t.Fatalf("initialize: %s %v", result.Result, err)
			}
			if !slices.Equal(p.directories, []string{cwd, "/data/agents/9/skills"}) {
				t.Fatal(p.directories)
			}
			for _, relative := range []string{"note.md", "reports/result.txt"} {
				file, err := workspaceToolPath(cwd, relative)
				if err != nil || "/data/"+file != cwd+"/"+relative {
					t.Fatalf("relative file: %q %v", file, err)
				}
				artifact, err := fileCWDPath(cwd, relative)
				if err != nil || artifact != file {
					t.Fatalf("artifact path: %q %v", artifact, err)
				}
			}
		})
	}
}

func TestWorkingDirectoryRejectsInvalidSessionBeforeIO(t *testing.T) {
	for _, session := range []*SessionRow{nil, {}, {ID: 1, RootSessionID: new(uint64(0))}} {
		if cwd, err := sessionCWD(session); err == nil {
			t.Fatalf("invalid session resolved to %q", cwd)
		}
	}
	for _, path := range []string{"", ".", "home/", "platform", "teams/1", "projects/1", "sessions/0", "sessions/01", "sessions/-1", "sessions/18446744073709551616", "sessions/1/child", "sessions/1/../2", "agents/1/skills", "../etc"} {
		p := &cwdProvider{}
		if _, err := runNativeRequest(t.Context(), &SandboxAccess{Provider: p}, workspace.Request{Operation: "initialize", Path: path}); err == nil || len(p.directories) != 0 {
			t.Fatalf("invalid CWD %q touched filesystem: %v", path, err)
		}
	}
}

func TestSessionWorkingDirectoriesAreDistinct(t *testing.T) {
	first, err := sessionCWD(&SessionRow{ID: 12})
	if err != nil {
		t.Fatal(err)
	}
	second, err := sessionCWD(&SessionRow{ID: 13})
	if err != nil || first == second {
		t.Fatal("sessions share a working directory", err)
	}
}

type homeProvider struct {
	cwdProvider
	kind string
	err  error
}

func (p *homeProvider) StatFile(_ context.Context, _ sandboxcore.ResourceRef, name string) (sandboxcore.FileInfo, error) {
	if p.err != nil {
		return sandboxcore.FileInfo{}, p.err
	}
	if p.kind == "" {
		return sandboxcore.FileInfo{}, &sandboxcore.Error{Code: "SANDBOX_FILE_NOT_FOUND"}
	}
	return sandboxcore.FileInfo{Path: name, Kind: p.kind}, nil
}
func (p *homeProvider) MakeDirectory(ctx context.Context, ref sandboxcore.ResourceRef, name string, mode int) error {
	p.kind = "directory"
	return p.cwdProvider.MakeDirectory(ctx, ref, name, mode)
}
func TestHomePreparationChecksExistingPathAndRecreatesMissingDirectory(t *testing.T) {
	p := &homeProvider{}
	a := &SandboxAccess{Provider: p}
	check := func(operation string, changed bool) {
		t.Helper()
		result, err := runNativeRequest(t.Context(), a, workspace.Request{Operation: operation, Path: "home"})
		if err != nil || result.Changed != changed {
			t.Fatalf("%s: %+v %v", operation, result, err)
		}
	}
	check("directory_exists", false)
	if len(p.directories) != 0 {
		t.Fatal("read created directory")
	}
	check("ensure_home", true)
	check("ensure_home", false)
	p.kind = ""
	check("ensure_home", true)
	if !slices.Equal(p.directories, []string{"/data/home", "/data/home"}) {
		t.Fatal(p.directories)
	}
	p.kind = "file"
	for _, operation := range []string{"directory_exists", "ensure_home"} {
		if _, err := runNativeRequest(t.Context(), a, workspace.Request{Operation: operation, Path: "home"}); err == nil {
			t.Fatal("file accepted as home")
		}
	}
	if len(p.directories) != 2 {
		t.Fatal("conflicting file overwritten")
	}
	p.err = &sandboxcore.Error{Code: "SANDBOX_FORBIDDEN"}
	if _, err := runNativeRequest(t.Context(), a, workspace.Request{Operation: "ensure_home", Path: "home"}); err == nil || len(p.directories) != 2 {
		t.Fatal("IO failure treated as missing")
	}
}
