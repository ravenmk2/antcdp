package workspace

import (
	"strings"
	"testing"
)

func TestWorkspacePathBoundaries(t *testing.T) {
	for _, name := range []string{".system/staging/private", ".system/skills/1/version", "workspace/.system/private"} {
		if _, err := PublicPath(name, true); err == nil {
			t.Fatalf("exposed internal namespace %q", name)
		}
	}
	for _, value := range []string{"/data/private", "../outside", "a/../b", "a//b", "a/./b", "a\\b", "a\x00b", "a\nb", strings.Repeat("a", 256)} {
		if _, err := Normalize(value, false); err == nil {
			t.Fatalf("accepted ambiguous path %q", value)
		}
	}
	if value, err := PublicPath("projects/1/中文 文件.txt", false); err != nil || value != "projects/1/中文 文件.txt" {
		t.Fatal(value, err)
	}
}
