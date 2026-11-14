package skillpackage

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
)

// Unpack revalidates an archive before delivering normalized, verified files to
// the caller. The caller decides where files are written; no archive path is
// ever passed directly to an OS filesystem API.
func Unpack(ctx context.Context, source io.ReaderAt, size int64, name, archiveSHA, contentSHA string, write func(Entry, []byte) error) error {
	pkg, err := Validate(ctx, source, size)
	if err != nil {
		return err
	}
	if pkg.Frontmatter.Name != name || pkg.ArchiveSHA256 != archiveSHA || pkg.ContentSHA256 != contentSHA {
		return fail("SKILL_INTEGRITY_FAILED", "")
	}
	archive, err := zip.NewReader(source, size)
	if err != nil {
		return err
	}
	files := map[string]*zip.File{}
	for _, file := range archive.File {
		if !file.FileInfo().IsDir() {
			name, err := NormalizePath(file.Name, false)
			if err != nil {
				return err
			}
			files[name] = file
		}
	}
	prefix := ""
	if files["SKILL.md"] == nil {
		prefix = name + "/"
	}
	for _, entry := range pkg.Manifest.Entries {
		file := files[prefix+entry.Path]
		if file == nil {
			return fail("SKILL_INTEGRITY_FAILED", entry.Path)
		}
		data, err := readFile(ctx, file)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(data)
		if uint64(len(data)) != entry.Size || hex.EncodeToString(hash[:]) != entry.SHA256 {
			return fail("SKILL_INTEGRITY_FAILED", entry.Path)
		}
		if err = write(entry, data); err != nil {
			return err
		}
	}
	return nil
}
