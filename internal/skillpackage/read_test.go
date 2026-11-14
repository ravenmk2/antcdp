package skillpackage

import (
	"bytes"
	"strings"
	"testing"
)

func TestReadArchiveUsesValidatedRootAndEntry(t *testing.T) {
	for _, prefix := range []string{"", "review/"} {
		t.Run(prefix, func(t *testing.T) {
			data := archiveBytes(t, testEntry{prefix + "SKILL.md", skillText("review"), 0}, testEntry{prefix + "references/check.md", "check tests", 0})
			pkg := validateBytes(t, data)
			entry := pkg.Manifest.Entries[1]
			read := func(hash string, e Entry, limit int64) ([]byte, error) {
				return ReadArchive(t.Context(), bytes.NewReader(data), hash, "review", e, limit)
			}
			got, err := read(pkg.ArchiveSHA256, entry, 256<<10)
			if err != nil || string(got) != "check tests" {
				t.Fatal(string(got), err)
			}
			if _, err = read(strings.Repeat("0", 64), entry, 256<<10); err == nil {
				t.Fatal("accepted wrong archive digest")
			}
			if _, err = read(pkg.ArchiveSHA256, entry, 1); err == nil {
				t.Fatal("accepted oversized preview")
			}
			entry.SHA256 = strings.Repeat("0", 64)
			if _, err = read(pkg.ArchiveSHA256, entry, 256<<10); err == nil {
				t.Fatal("accepted wrong entry digest")
			}
			entry.Path = "../SKILL.md"
			if _, err = read(pkg.ArchiveSHA256, entry, 256<<10); err == nil {
				t.Fatal("accepted traversal")
			}
		})
	}
}
