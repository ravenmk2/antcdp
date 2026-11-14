// Package skillpackage validates immutable skill archives without executing them.
package skillpackage

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

const MaxArchiveBytes int64 = 20 << 20
const MaxExpandedBytes uint64 = 100 << 20
const MaxFileBytes uint64 = 10 << 20
const MaxFiles = 2000
const MaxRatio uint64 = 100
const ParseTimeout = 30 * time.Second

type Issue struct {
	Code string `json:"code"`
	Path string `json:"path,omitempty"`
}
type Error struct{ Issue Issue }

func (e *Error) Error() string  { return e.Issue.Code }
func fail(code, p string) error { return &Error{Issue{code, p}} }

type Entry struct {
	Path      string `json:"path"`
	Size      uint64 `json:"size_bytes,string"`
	SHA256    string `json:"sha256"`
	MediaType string `json:"media_type"`
}
type Manifest struct {
	FileCount  int     `json:"file_count"`
	TotalBytes uint64  `json:"total_bytes,string"`
	Entries    []Entry `json:"entries"`
}
type Frontmatter struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
type Package struct {
	Manifest      Manifest
	Frontmatter   Frontmatter
	ContentSHA256 string
	ArchiveSHA256 string
}

var namePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)

func ValidName(v string) bool { return namePattern.MatchString(v) && !strings.Contains(v, "--") }

// NormalizePath is shared by archive validation and controlled library reads.
// Reject ambiguous names before filesystem IO, including Windows device/stream
// aliases, even when the current host uses a case-sensitive filesystem.
func NormalizePath(v string, allowEmpty bool) (string, error) {
	if allowEmpty && v == "" {
		return "", nil
	}
	if v == "" || len(v) > 1024 || !utf8.ValidString(v) || strings.HasPrefix(v, "/") || strings.ContainsAny(v, "\\:") {
		return "", fail("SKILL_PATH_INVALID", "")
	}
	for _, r := range v {
		if unicode.IsControl(r) {
			return "", fail("SKILL_PATH_INVALID", "")
		}
	}
	v = norm.NFC.String(v)
	for _, part := range strings.Split(v, "/") {
		if part == "" || part == "." || part == ".." || len(part) > 255 || strings.TrimRight(part, " .") != part {
			return "", fail("SKILL_PATH_INVALID", "")
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
			return "", fail("SKILL_PATH_INVALID", "")
		}
	}
	if len(v) > 1024 {
		return "", fail("SKILL_PATH_INVALID", "")
	}
	return v, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(b)
}
func readFile(ctx context.Context, f *zip.File) ([]byte, error) {
	if f.UncompressedSize64 > MaxFileBytes {
		return nil, fail("SKILL_FILE_TOO_LARGE", "")
	}
	stream, e := f.Open()
	if e != nil {
		return nil, fail("SKILL_ARCHIVE_INVALID", "")
	}
	defer func() { _ = stream.Close() }()
	b, e := io.ReadAll(io.LimitReader(contextReader{ctx, stream}, int64(MaxFileBytes)+1))
	if ctx.Err() != nil {
		return nil, fail("SKILL_VALIDATION_TIMEOUT", "")
	}
	if e != nil || uint64(len(b)) != f.UncompressedSize64 {
		return nil, fail("SKILL_ARCHIVE_INVALID", "")
	}
	if uint64(len(b)) > MaxFileBytes {
		return nil, fail("SKILL_FILE_TOO_LARGE", "")
	}
	return b, nil
}
func Validate(ctx context.Context, source io.ReaderAt, size int64) (*Package, error) {
	if size < 1 || size > MaxArchiveBytes {
		return nil, fail("SKILL_ARCHIVE_TOO_LARGE", "")
	}
	ctx, cancel := context.WithTimeout(ctx, ParseTimeout)
	defer cancel()
	reader, e := zip.NewReader(source, size)
	if e != nil {
		return nil, fail("SKILL_ARCHIVE_INVALID", "")
	}
	if len(reader.File) == 0 || len(reader.File) > MaxFiles*2 {
		return nil, fail("SKILL_FILE_COUNT_INVALID", "")
	}
	files := map[string]*zip.File{}
	seen := map[string]bool{}
	dirs := map[string]bool{}
	fold := cases.Fold()
	var expanded uint64
	for _, f := range reader.File {
		if ctx.Err() != nil {
			return nil, fail("SKILL_VALIDATION_TIMEOUT", "")
		}
		mode := f.Mode()
		if mode&os.ModeType != 0 && !mode.IsDir() {
			return nil, fail("SKILL_SPECIAL_FILE", "")
		}
		directory := mode.IsDir() || strings.HasSuffix(f.Name, "/")
		raw := f.Name
		if directory {
			raw = strings.TrimSuffix(raw, "/")
		}
		name, e := NormalizePath(raw, false)
		if e != nil {
			return nil, e
		}
		canonical := fold.String(name)
		if seen[canonical] {
			return nil, fail("SKILL_DUPLICATE_PATH", name)
		}
		seen[canonical] = true
		if f.Flags&1 != 0 {
			return nil, fail("SKILL_ARCHIVE_ENCRYPTED", name)
		}
		if directory {
			if f.UncompressedSize64 != 0 {
				return nil, fail("SKILL_ARCHIVE_INVALID", name)
			}
			dirs[name] = true
			continue
		}
		if f.UncompressedSize64 > MaxFileBytes {
			return nil, fail("SKILL_FILE_TOO_LARGE", name)
		}
		if f.UncompressedSize64 > max(f.CompressedSize64, 1)*MaxRatio {
			return nil, fail("SKILL_COMPRESSION_RATIO", name)
		}
		expanded += f.UncompressedSize64
		if expanded > MaxExpandedBytes || expanded > uint64(size)*MaxRatio {
			return nil, fail("SKILL_EXPANDED_TOO_LARGE", "")
		}
		files[name] = f
	}
	if len(files) == 0 || len(files) > MaxFiles {
		return nil, fail("SKILL_FILE_COUNT_INVALID", "")
	}
	// A file cannot also be a directory, including implicit directory entries.
	fileAliases := map[string]bool{}
	directoryAliases := map[string]string{}
	for name := range files {
		fileAliases[fold.String(name)] = true
	}
	for name := range files {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			alias := fold.String(parent)
			if old, exists := directoryAliases[alias]; exists && old != parent {
				return nil, fail("SKILL_DUPLICATE_PATH", parent)
			}
			directoryAliases[alias] = parent
		}
	}
	for name := range dirs {
		if old, exists := directoryAliases[fold.String(name)]; exists && old != name {
			return nil, fail("SKILL_DUPLICATE_PATH", name)
		}
	}
	for name := range seen {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if fileAliases[parent] {
				return nil, fail("SKILL_PATH_CONFLICT", name)
			}
		}
	}
	prefix := ""
	if files["SKILL.md"] == nil {
		for name := range files {
			top, rest, ok := strings.Cut(name, "/")
			if !ok || rest == "" {
				return nil, fail("SKILL_MANIFEST_MISSING", "")
			}
			if prefix == "" {
				prefix = top + "/"
			} else if prefix != top+"/" {
				return nil, fail("SKILL_MULTIPLE_ROOTS", "")
			}
		}
		if files[prefix+"SKILL.md"] == nil {
			return nil, fail("SKILL_MANIFEST_MISSING", "")
		}
		for dir := range dirs {
			if dir != strings.TrimSuffix(prefix, "/") && !strings.HasPrefix(dir, prefix) {
				return nil, fail("SKILL_MULTIPLE_ROOTS", "")
			}
		}
	}
	pkg := &Package{Manifest: Manifest{Entries: []Entry{}}}
	for name, f := range files {
		normalized := strings.TrimPrefix(name, prefix)
		b, e := readFile(ctx, f)
		if e != nil {
			return nil, e
		}
		hash := sha256.Sum256(b)
		media := detectMedia(normalized, b)
		pkg.Manifest.Entries = append(pkg.Manifest.Entries, Entry{normalized, uint64(len(b)), hex.EncodeToString(hash[:]), media})
		pkg.Manifest.TotalBytes += uint64(len(b))
		if normalized == "SKILL.md" {
			front, e := parseFrontmatter(b)
			if e != nil {
				return nil, e
			}
			pkg.Frontmatter = front
		}
	}
	if prefix != "" && strings.TrimSuffix(prefix, "/") != pkg.Frontmatter.Name {
		return nil, fail("SKILL_NAME_MISMATCH", "SKILL.md")
	}
	pkg.Manifest.FileCount = len(pkg.Manifest.Entries)
	sort.Slice(pkg.Manifest.Entries, func(i, j int) bool { return pkg.Manifest.Entries[i].Path < pkg.Manifest.Entries[j].Path })
	// Account for the complete public representation before publishing, leaving
	// bounded room for version labels, change notes, IDs and timestamps.
	representation, e := json.Marshal(struct {
		Manifest    Manifest    `json:"manifest"`
		Frontmatter Frontmatter `json:"frontmatter"`
	}{pkg.Manifest, pkg.Frontmatter})
	if e != nil || len(representation) > (1<<20)-(16<<10) {
		return nil, fail("SKILL_MANIFEST_TOO_LARGE", "")
	}
	canonical, _ := json.Marshal(pkg.Manifest)
	contentHash := sha256.Sum256(canonical)
	pkg.ContentSHA256 = hex.EncodeToString(contentHash[:])
	archiveHash := sha256.New()
	if _, e = io.Copy(archiveHash, contextReader{ctx, io.NewSectionReader(source, 0, size)}); e != nil {
		return nil, fail("SKILL_VALIDATION_TIMEOUT", "")
	}
	pkg.ArchiveSHA256 = hex.EncodeToString(archiveHash.Sum(nil))
	return pkg, nil
}
func detectMedia(name string, b []byte) string {
	if utf8.Valid(b) && !bytes.ContainsRune(b, 0) {
		switch strings.ToLower(path.Ext(name)) {
		case ".md":
			return "text/markdown; charset=utf-8"
		case ".json":
			if json.Valid(b) {
				return "application/json"
			}
		}
		return "text/plain; charset=utf-8"
	}
	media := http.DetectContentType(b)
	if parsed, _, e := mime.ParseMediaType(media); e == nil {
		return parsed
	}
	return "application/octet-stream"
}
func parseFrontmatter(b []byte) (Frontmatter, error) {
	var out Frontmatter
	if !utf8.Valid(b) || bytes.ContainsRune(b, 0) {
		return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
	}
	text := strings.ReplaceAll(string(bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return out, fail("SKILL_FRONTMATTER_MISSING", "SKILL.md")
	}
	rest := text[4:]
	end := strings.Index(rest, "\n---\n")
	if end < 0 && strings.HasSuffix(rest, "\n---") {
		end = len(rest) - 4
	}
	if end < 0 || end > 64<<10 {
		return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
	}
	var document yaml.Node
	if yaml.Unmarshal([]byte(rest[:end]), &document) != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
	}
	nodes := 0
	var safe func(*yaml.Node, int) bool
	safe = func(n *yaml.Node, depth int) bool {
		nodes++
		if nodes > 4096 || depth > 16 || n.Kind == yaml.AliasNode || n.Anchor != "" {
			return false
		}
		for _, child := range n.Content {
			if !safe(child, depth+1) {
				return false
			}
		}
		return true
	}
	if !safe(&document, 0) {
		return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
	}
	root := document.Content[0]
	seen := map[string]bool{}
	for i := 0; i < len(root.Content); i += 2 {
		k, v := root.Content[i], root.Content[i+1]
		if k.Tag != "!!str" || seen[k.Value] {
			return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
		}
		seen[k.Value] = true
		switch k.Value {
		case "name":
			if v.Tag != "!!str" || !ValidName(v.Value) {
				return out, fail("SKILL_NAME_INVALID", "SKILL.md")
			}
			out.Name = v.Value
		case "description":
			if v.Tag != "!!str" {
				return out, fail("SKILL_DESCRIPTION_INVALID", "SKILL.md")
			}
			out.Description = strings.TrimSpace(v.Value)
			if out.Description == "" || utf8.RuneCountInString(out.Description) > 1024 {
				return out, fail("SKILL_DESCRIPTION_INVALID", "SKILL.md")
			}
		case "license", "allowed-tools":
			if v.Tag != "!!str" {
				return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
			}
		case "compatibility":
			if v.Tag != "!!str" || utf8.RuneCountInString(v.Value) < 1 || utf8.RuneCountInString(v.Value) > 500 {
				return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
			}
		case "metadata":
			if v.Kind != yaml.MappingNode {
				return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
			}
			keys := map[string]bool{}
			for j := 0; j < len(v.Content); j += 2 {
				if v.Content[j].Tag != "!!str" || v.Content[j+1].Tag != "!!str" || keys[v.Content[j].Value] {
					return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
				}
				keys[v.Content[j].Value] = true
			}
		}
	}
	if !seen["name"] || !seen["description"] {
		return out, fail("SKILL_FRONTMATTER_INVALID", "SKILL.md")
	}
	return out, nil
}
