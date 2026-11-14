//go:build linux

package workspacefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHelperAncestorsPreventExecutableReplacement(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "usr", "local", "libexec")
	if err := os.MkdirAll(parent, 0755); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(parent, "helper")
	owner := uint32(os.Geteuid())
	if !immutableHelperParents(root, helper, owner) {
		t.Fatal("immutable ancestor chain rejected")
	}
	if err := os.Chmod(filepath.Join(root, "usr", "local"), 0777); err != nil {
		t.Fatal(err)
	}
	if immutableHelperParents(root, helper, owner) {
		t.Fatal("writable ancestor allowed executable replacement")
	}
	if err := os.Chmod(filepath.Join(root, "usr", "local"), 0755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "alias")
	if err := os.Symlink(parent, link); err != nil {
		t.Fatal(err)
	}
	if immutableHelperParents(root, filepath.Join(link, "helper"), owner) {
		t.Fatal("symlink ancestor trusted")
	}
	if immutableHelperParents(root, helper, owner+1) || immutableHelperParents(root, filepath.Join(t.TempDir(), "helper"), owner) {
		t.Fatal("wrong owner or path outside trusted root accepted")
	}
}
