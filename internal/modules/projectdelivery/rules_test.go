package projectdelivery

import (
	"encoding/json"
	"testing"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func TestBranchNamesAndWholeStringRules(t *testing.T) {
	for _, name := range []string{"main", "开发/功能", "feature/a/b", "feature", "a@b"} {
		if !ValidBranch(name) {
			t.Errorf("rejected valid branch %q", name)
		}
	}
	for _, name := range []string{"", "HEAD", "@", "@{-1}", "refs/heads/main", "-main", "a..b", "a//b", "/a", "a/", "a/.b", "a/b.lock", "a.", "a b", "a\\b", "a?b", "a\x7fb"} {
		if ValidBranch(name) {
			t.Errorf("accepted invalid branch %q", name)
		}
	}
	tests := []struct {
		mode, pattern, name string
		want                bool
	}{{"glob", "feature/**", "feature/a/b", true}, {"glob", "feature/*", "feature/a/b", false}, {"glob", "a/**/b", "a/b", false}, {"glob", "a/**/b", "a/x/b", true}, {"glob", "[ab]", "a", false}, {"regex", "main|master", "main-old", false}, {"regex", "(?i)main", "MAIN", true}, {"exact", "main", "Main", false}}
	for _, tt := range tests {
		r, e := Compile(Rule{tt.mode, tt.pattern}, false)
		if e != nil || r.MatchString(tt.name) != tt.want {
			t.Errorf("%+v: %v", tt, e)
		}
	}
	for _, r := range []Rule{{"glob", "a/***"}, {"regex", "(?=main)"}, {"regex", `(a)\1`}} {
		if _, e := Compile(r, true); e == nil {
			t.Errorf("accepted invalid rule %+v", r)
		}
	}
	rules := Defaults()
	rules[1].Enabled = true
	rules[1].Rule = &Rule{"regex", "main|develop"}
	if Classify(rules, "main", "mainline", false).Reason != "branch_ambiguous" {
		t.Fatal("ambiguous match accepted")
	}
	rules[4].Enabled = true
	if Classify(rules, "feature/a", "feature", true).Reason != "environment_branch_type_forbidden" {
		t.Fatal("feature environment accepted")
	}
}
func TestDynamicScopeUnionIntersection(t *testing.T) {
	repos := []i.ProjectRepo{{ID: 1, ConnectionID: 7, RepoInfo: i.RepoInfo{FullPath: "org/a"}}, {ID: 2, ConnectionID: 8, RepoInfo: i.RepoInfo{FullPath: "org/a"}}, {ID: 3, ConnectionID: 7, RepoInfo: i.RepoInfo{FullPath: "other/b"}}}
	cid := "7"
	scope := Scope{Mode: "custom", IDs: []string{"3"}, Rules: []ScopeRule{{ConnectionID: &cid, Mode: "glob", Pattern: "org/**"}}}
	rows := Evaluate(scope, repos)
	if len(rows) != 2 || rows[0].ID != 1 || rows[1].ID != 3 {
		t.Fatalf("unexpected union %+v", rows)
	}
	child := Scope{Mode: "custom", IDs: []string{}, Rules: []ScopeRule{{Mode: "glob", Pattern: "**"}}}
	if len(Evaluate(child, plain(rows))) != 2 {
		t.Fatal("child expanded parent")
	}
	child.IDs = []string{"2"}
	if ValidateScope(child, true, plain(rows), Scope{}) == nil {
		t.Fatal("out-of-parent manual ID accepted")
	}
	repos = append(repos, i.ProjectRepo{ID: 4, ConnectionID: 7, RepoInfo: i.RepoInfo{FullPath: "org/c"}})
	if len(Evaluate(scope, repos)) != 3 {
		t.Fatal("new repository was not rematched")
	}
	if digest(map[string]any{"b": 2, "a": 1}) != digest(json.RawMessage(`{ "a": 1, "b": 2 }`)) {
		t.Fatal("database JSON normalization changes digest")
	}
}
func TestActionsRejectAmbiguousOrRepeatedInput(t *testing.T) {
	items := []CreationItem{{ID: 1, Preview: "ready"}, {ID: 2, Preview: "existing"}, {ID: 3, Preview: "error"}}
	good := ExecuteWrite{Items: []ExecutionItem{{"1", "create"}, {"2", "use_existing"}, {"3", "skip"}}}
	if _, e := validateActions(items, good); e != nil {
		t.Fatal(e)
	}
	for _, w := range []ExecuteWrite{{Items: []ExecutionItem{{"1", "create"}, {"1", "create"}, {"3", "skip"}}}, {Items: []ExecutionItem{{"1", "skip"}, {"2", "create"}, {"3", "skip"}}}, {Items: []ExecutionItem{{"1", "skip"}, {"2", "skip"}, {"3", "skip"}}}} {
		if _, e := validateActions(items, w); e == nil {
			t.Fatal("invalid action list accepted")
		}
	}
}
