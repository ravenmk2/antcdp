package app

import (
	"errors"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitRepoInitIdentity(t *testing.T) {
	for _, tool := range []string{"sh", "git", "flock"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("sandbox Git test needs %s", tool)
		}
	}
	ctx := t.Context()
	target := filepath.Join(t.TempDir(), "repo with spaces")
	const origin = "https://git.example.test/team/project.git"
	initRepo := func(origin, name, email string, wantStatus int) {
		t.Helper()
		out, err := exec.CommandContext(ctx, "sh", "-c", initGitScript, "git-init", target, origin, "https://git.example.test", "1", name, email).CombinedOutput()
		if wantStatus == 0 {
			resolved := strings.TrimSpace(string(out))
			if err != nil || !path.IsAbs(resolved) || path.Base(resolved) != filepath.Base(target) {
				t.Fatalf("git init: %v, %s", err, out)
			}
			return
		}
		var status *exec.ExitError
		if !errors.As(err, &status) || status.ExitCode() != wantStatus {
			t.Fatalf("git init expected exit %d: %v, %s", wantStatus, err, out)
		}
	}
	gitConfig := func(args ...string) string {
		t.Helper()
		out, err := exec.CommandContext(ctx, "git", append([]string{"-C", target, "config", "--local"}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("reading repository config: %v, %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	assertIdentity := func(name, email string) {
		t.Helper()
		if gitConfig("--get-all", "user.name") != name || gitConfig("--get-all", "user.email") != email {
			t.Fatal("repository identity is missing or duplicated")
		}
	}
	initRepo(origin, "李明 O'Neil", "first@example.test", 0)
	assertIdentity("李明 O'Neil", "first@example.test")
	gitConfig("--unset", "user.email") // Simulate a repository initialized by the old version.
	gitConfig("core.autocrlf", "false")
	initRepo(origin, "New Name", "updated@example.test", 0)
	initRepo(origin, "New Name", "updated@example.test", 0)
	assertIdentity("New Name", "updated@example.test")
	if gitConfig("--get", "core.autocrlf") != "false" || gitConfig("--get", "remote.origin.url") != origin {
		t.Fatal("reinitialization changed unrelated config")
	}
	initRepo("https://git.example.test/other.git", "Wrong Name", "wrong@example.test", 41)
	lock := filepath.Join(target, ".git", "config.lock")
	if err := os.WriteFile(lock, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	initRepo(origin, "Wrong Name", "wrong@example.test", 47)
	assertIdentity("New Name", "updated@example.test")
	if _, err := os.Stat(lock); err != nil {
		t.Fatal("reinitialization removed another writer's lock", err)
	}
}
