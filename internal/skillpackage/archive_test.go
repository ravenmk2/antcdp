package skillpackage

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

type testEntry struct {
	name, body string
	mode       os.FileMode
}

func archiveBytes(t *testing.T, entries ...testEntry) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for _, entry := range entries {
		h := &zip.FileHeader{Name: entry.name, Method: zip.Store}
		if entry.mode != 0 {
			h.SetMode(entry.mode)
		}
		f, e := writer.CreateHeader(h)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Write([]byte(entry.body)); e != nil {
			t.Fatal(e)
		}
	}
	if e := writer.Close(); e != nil {
		t.Fatal(e)
	}
	return out.Bytes()
}
func skillText(name string) string {
	return "---\nname: " + name + "\ndescription: Use when reviewing source files.\nallowed-tools: shell\n---\n# Instructions\nRead the files.\n"
}
func validateBytes(t *testing.T, b []byte) *Package {
	t.Helper()
	p, e := Validate(t.Context(), bytes.NewReader(b), int64(len(b)))
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func TestArchiveNormalizationAndContentIdentity(t *testing.T) {
	root := archiveBytes(t, testEntry{"SKILL.md", skillText("code-review"), 0}, testEntry{"scripts/check.py", "print('ok')", 0755})
	wrapped := archiveBytes(t, testEntry{"code-review/scripts/check.py", "print('ok')", 0755}, testEntry{"code-review/SKILL.md", skillText("code-review"), 0})
	a, b := validateBytes(t, root), validateBytes(t, wrapped)
	if a.ContentSHA256 != b.ContentSHA256 || a.ArchiveSHA256 == b.ArchiveSHA256 {
		t.Fatal("normalized content and archive identity confused")
	}
	if a.Manifest.FileCount != 2 || a.Frontmatter.Name != "code-review" || a.Manifest.Entries[0].Path != "SKILL.md" {
		t.Fatal("manifest", a.Manifest)
	}
	body, e := ReadArchive(t.Context(), bytes.NewReader(root), a.ArchiveSHA256, a.Frontmatter.Name, a.Manifest.Entries[1], 1024)
	if e != nil || string(body) != "print('ok')" {
		t.Fatal("package entry", e)
	}
	wire, _ := json.Marshal(a.Manifest)
	if !bytes.Contains(wire, []byte(`"size_bytes":"`)) {
		t.Fatal("byte counts not string encoded")
	}
}
func TestArchiveRejectsUnsafeEntries(t *testing.T) {
	for _, tc := range []struct {
		name  string
		extra []testEntry
	}{
		{"traversal", []testEntry{{"../escape", "x", 0}}},
		{"absolute", []testEntry{{"/tmp/escape", "x", 0}}},
		{"windows separator", []testEntry{{"refs\\escape", "x", 0}}},
		{"alternate stream", []testEntry{{"refs:secret", "x", 0}}},
		{"device", []testEntry{{"NUL.txt", "x", 0}}},
		{"dot component", []testEntry{{"refs/./file", "x", 0}}},
		{"normalized duplicate", []testEntry{{"refs/cafe\u0301.md", "a", 0}, {"refs/café.md", "b", 0}}},
		{"case duplicate", []testEntry{{"refs/A.md", "a", 0}, {"refs/a.md", "b", 0}}},
		{"implicit directory alias", []testEntry{{"Refs/a.md", "a", 0}, {"refs/b.md", "b", 0}}},
		{"parent file", []testEntry{{"refs", "x", 0}, {"refs/child", "y", 0}}},
		{"symlink", []testEntry{{"link", "../../private", os.ModeSymlink | 0777}}},
		{"fifo", []testEntry{{"pipe", "", os.ModeNamedPipe | 0600}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entries := append([]testEntry{{"SKILL.md", skillText("review"), 0}}, tc.extra...)
			b := archiveBytes(t, entries...)
			_, e := Validate(t.Context(), bytes.NewReader(b), int64(len(b)))
			var problem *Error
			if !errors.As(e, &problem) {
				t.Fatalf("unsafe archive accepted: %v", e)
			}
		})
	}
}
func TestArchiveRejectsMalformedSkillAndLimits(t *testing.T) {
	for _, body := range []string{
		"no frontmatter",
		"---\nname: bad--name\ndescription: x\n---\n",
		"---\nname: 123\ndescription: x\n---\n",
		"---\nname: okay\ndescription: x\ndescription: y\n---\n",
		"---\nname: okay\ndescription: ''\n---\n",
		"---\nname: &name okay\ndescription: *name\n---\n",
		"---\nname: okay\ndescription: x\nmetadata:\n  tries: 2\n---\n",
		"---\nname: okay\ndescription: " + strings.Repeat("界", 1025) + "\n---\n",
	} {
		b := archiveBytes(t, testEntry{"SKILL.md", body, 0})
		if _, e := Validate(t.Context(), bytes.NewReader(b), int64(len(b))); e == nil {
			t.Fatal("malformed manifest accepted")
		}
	}
	wrong := archiveBytes(t, testEntry{"wrong/SKILL.md", skillText("right"), 0})
	if _, e := Validate(t.Context(), bytes.NewReader(wrong), int64(len(wrong))); e == nil {
		t.Fatal("wrong parent identity accepted")
	}
	many := make([]testEntry, MaxFiles+1)
	for i := range many {
		many[i] = testEntry{name: fmt.Sprintf("%04d.txt", i)}
	}
	b := archiveBytes(t, many...)
	if _, e := Validate(t.Context(), bytes.NewReader(b), int64(len(b))); e == nil {
		t.Fatal("too many files accepted")
	}
	var bomb bytes.Buffer
	writer := zip.NewWriter(&bomb)
	f, e := writer.Create("SKILL.md")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.Write([]byte(skillText("review") + strings.Repeat("a", 1<<20))); e != nil {
		t.Fatal(e)
	}
	if e = writer.Close(); e != nil {
		t.Fatal(e)
	}
	if _, e = Validate(t.Context(), bytes.NewReader(bomb.Bytes()), int64(bomb.Len())); e == nil {
		t.Fatal("compression bomb accepted")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	valid := archiveBytes(t, testEntry{"SKILL.md", skillText("review"), 0})
	if _, e = Validate(ctx, bytes.NewReader(valid), int64(len(valid))); e == nil {
		t.Fatal("cancelled validation accepted")
	}
}
