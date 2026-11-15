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

func TestAgentScopePreparesWorkingDirectory(t *testing.T) {
	for _, tc := range []struct {
		scope string
		id    *uint64
		cwd   string
	}{
		{"platform", nil, "/data/platform"},
		{"team", new(uint64(12)), "/data/teams/12"},
		{"project", new(uint64(34)), "/data/projects/34"},
	} {
		t.Run(tc.scope, func(t *testing.T) {
			cwd, err := agentCWD(&Definition{ScopeKind: tc.scope, ScopeID: tc.id})
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

func TestWorkingDirectoryRejectsInvalidScopeBeforeIO(t *testing.T) {
	for _, agent := range []*Definition{nil, {}, {ScopeKind: "team"}, {ScopeKind: "project", ScopeID: new(uint64(0))}, {ScopeKind: "platform", ScopeID: new(uint64(1))}, {ScopeKind: "unknown", ScopeID: new(uint64(1))}} {
		if cwd, err := agentCWD(agent); err == nil {
			t.Fatalf("invalid scope resolved to %q", cwd)
		}
	}
	for _, path := range []string{"", ".", "platform/", "workspace", "teams/0", "teams/01", "teams/-1", "projects/18446744073709551616", "projects/1/child", "teams/1/../2", "agents/1/skills", "../etc"} {
		p := &cwdProvider{}
		if _, err := runNativeRequest(t.Context(), &SandboxAccess{Provider: p}, workspace.Request{Operation: "initialize", Path: path}); err == nil || len(p.directories) != 0 {
			t.Fatalf("invalid CWD %q touched filesystem: %v", path, err)
		}
	}
}
