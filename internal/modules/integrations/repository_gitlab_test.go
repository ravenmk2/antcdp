package integrations

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
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

func TestRemotePaginationSizes(t *testing.T) {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	var listener net.Listener
	for _, address := range addresses {
		prefix, e := netip.ParsePrefix(address.String())
		if e != nil || !prefix.Addr().Is4() || !allowedIP(prefix.Addr()) {
			continue
		}
		listener, err = net.Listen("tcp", net.JoinHostPort(prefix.Addr().String(), "0"))
		if err == nil {
			break
		}
	}
	if listener == nil {
		t.Skip("no allowed local network interface")
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") != "3" || r.URL.Query().Get("per_page") != "10" {
			t.Errorf("wrong remote pagination: %s", r.URL.RawQuery)
		}
		rows := []map[string]any{}
		for id := range 10 {
			rows = append(rows, map[string]any{"id": id + 1, "iid": id + 1, "name": "repo", "path_with_namespace": "team/repo", "full_path": "team"})
		}
		if r.URL.Query().Get("search") == "last" {
			rows = rows[:3]
		}
		if err := json.NewEncoder(w).Encode(rows); err != nil {
			t.Error(err)
		}
	}))
	if err := server.Listener.Close(); err != nil {
		t.Fatal(err)
	}
	server.Listener = listener
	server.Start()
	defer server.Close()
	config := HTTPConfig{BaseURL: server.URL}
	for _, kind := range []string{"repos", "containers"} {
		for _, search := range []string{"", "last"} {
			_, more, e := browseGitLab(context.Background(), &config, "fixture", RepoBrowseQuery{Kind: kind, Search: search, Size: 10}, 3)
			if e != nil || more != (search == "") {
				t.Fatalf("%s %s: more=%v, err=%v", kind, search, more, e)
			}
		}
	}
	git := ReleaseGit{snap: BranchSnapshot{config: config, token: "fixture"}, project: "/projects/1"}
	rows, err := git.MRs(context.Background(), "main", 3, 10)
	if err != nil || len(rows) != 10 {
		t.Fatal(rows, err)
	}
	for _, size := range []int{10, 20, 50, 100} {
		q := RepoBrowseQuery{Kind: "repos", Size: size}
		payload := repoCursorPayload(repoSnapshot{}, q, 3, 123)
		if size != 20 && !strings.HasSuffix(payload, ":size="+strconv.Itoa(size)) {
			t.Fatal("cursor does not bind page size", size)
		}
		if size == 20 && strings.Contains(payload, ":size=") {
			t.Fatal("default-size cursor compatibility changed")
		}
	}
}
