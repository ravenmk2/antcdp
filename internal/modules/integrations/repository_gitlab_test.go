package integrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRepositoryIdentityAndURLs(t *testing.T) {
	var v gitLabRepo
	if e := json.Unmarshal([]byte(`{"id":9223372036854775800,"name":"service","path_with_namespace":"org/service","namespace":{"full_path":"org"},"web_url":"https://git.example/org/service","ssh_url_to_repo":"git@git.example:org/service.git","default_branch":null}`), &v); e != nil {
		t.Fatal(e)
	}
	out, e := normalizeGitLabRepo(v)
	if e != nil || out.RepoID != "9223372036854775800" || out.Branch != nil {
		t.Fatalf("lost remote identity or empty branch: %v", e)
	}
	for _, raw := range []string{"javascript:alert(1)", "https://token@git.example/x", "https://git.example/x?token=secret", "https://git.example/x#token", "https://git.example/x\n"} {
		v.Web = &raw
		if _, e = normalizeGitLabRepo(v); e == nil {
			t.Fatalf("accepted unsafe URL %q", raw)
		}
	}
	for _, raw := range []string{"ssh://git:password@git.example/x", "git@git.example:x?token=secret"} {
		if safeRepoURL(&raw, true) {
			t.Fatal("accepted SSH authentication material")
		}
	}
	v.Web = nil
	v.ID = json.Number("1e3")
	if _, e = normalizeGitLabRepo(v); e == nil {
		t.Fatal("accepted non-canonical GitLab ID")
	}
}
func TestRepositoryBatchValidation(t *testing.T) {
	for _, ids := range [][]string{nil, {"1", "1"}, {"01"}, {"-1"}, {"1/../../secret"}, {strings.Repeat("1", 256)}, make([]string, 101)} {
		if validateRepoIDs(ids) == nil {
			t.Fatal("accepted invalid IDs")
		}
	}
	if e := validateRepoIDs([]string{"1", "9223372036854775800"}); e != nil {
		t.Fatal(e)
	}
}
func TestRepositorySnapshotFences(t *testing.T) {
	x := repoSnapshot{Connection: ServiceConnection{Version: 1, ConfigVersion: 1, CredentialsVersion: 1}, Credential: ServiceCredential{ID: 4, Version: 1, MaterialVersion: 1}}
	y := x
	y.Connection.CredentialsVersion++
	if sameRepoSnapshot(x, y) {
		t.Fatal("preferred switching must invalidate snapshot")
	}
	y = x
	y.Credential.MaterialVersion++
	if sameRepoSnapshot(x, y) {
		t.Fatal("rotation must invalidate snapshot")
	}
	y = x
	y.Connection.Version += 2
	if sameRepoSnapshot(x, y) {
		t.Fatal("disable/enable must invalidate snapshot")
	}
}
