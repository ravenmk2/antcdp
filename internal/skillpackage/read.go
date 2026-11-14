package skillpackage

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
)

// ReadArchive reads one entry from a previously validated immutable ZIP. The
// archive digest authenticates the original validation; only the selected file
// is decompressed. Root-directory normalization matches Validate.
func ReadArchive(ctx context.Context, source io.Reader, archiveSHA, skillName string, entry Entry, limit int64) ([]byte, error) {
	if limit < 0 || entry.Size > uint64(limit) || entry.Size > MaxFileBytes || !ValidName(skillName) {
		return nil, fail("SKILL_FILE_TOO_LARGE", entry.Path)
	}
	name, err := NormalizePath(entry.Path, false)
	if err != nil || name != entry.Path {
		return nil, fail("SKILL_PATH_INVALID", entry.Path)
	}
	ctx, cancel := context.WithTimeout(ctx, ParseTimeout)
	defer cancel()
	data, err := io.ReadAll(io.LimitReader(contextReader{ctx, source}, MaxArchiveBytes+1))
	if err != nil || len(data) == 0 || int64(len(data)) > MaxArchiveBytes {
		return nil, fail("SKILL_ARCHIVE_INVALID", "")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != archiveSHA {
		return nil, fail("SKILL_INTEGRITY_FAILED", "")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(reader.File) > MaxFiles*2 {
		return nil, fail("SKILL_ARCHIVE_INVALID", "")
	}
	files := make(map[string]*zip.File, len(reader.File))
	for _, f := range reader.File {
		if f.FileInfo().IsDir() {
			continue
		}
		path, err := NormalizePath(f.Name, false)
		if err != nil || files[path] != nil || !f.Mode().IsRegular() {
			return nil, fail("SKILL_ARCHIVE_INVALID", "")
		}
		files[path] = f
	}
	if files["SKILL.md"] == nil {
		name = skillName + "/" + name
	}
	f := files[name]
	if f == nil || f.UncompressedSize64 != entry.Size {
		return nil, fail("SKILL_INTEGRITY_FAILED", entry.Path)
	}
	content, err := readFile(ctx, f)
	if err != nil {
		return nil, err
	}
	digest = sha256.Sum256(content)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), entry.SHA256) {
		return nil, fail("SKILL_INTEGRITY_FAILED", entry.Path)
	}
	return content, nil
}
