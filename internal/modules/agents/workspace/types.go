// Package workspace defines Agent workspace paths and bounded operation data.
// Remote filesystem behavior belongs to the sandbox provider.
package workspace

import (
	"encoding/json"
	"errors"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"
)

const Version = 1
const MaxRequestBytes = 46 << 10
const MaxResponseBytes = 1 << 20
const MaxReadBytes = 64 << 10
const MaxWriteBytes = 32 << 10
const MaxFileBytes int64 = 100 << 20
const MaxWalkEntries = 10000

// ValidCWD accepts the computer home and canonical root-session directories.
func ValidCWD(cwd string) bool {
	if cwd == "/data/home" {
		return true
	}
	value, ok := strings.CutPrefix(cwd, "/data/sessions/")
	if !ok {
		return false
	}
	id, err := strconv.ParseUint(value, 10, 64)
	return err == nil && id != 0 && strconv.FormatUint(id, 10) == value
}

// Paths are relative to the Agent workspace mount. Provider APIs govern IO semantics.
type Request struct {
	Version      int    `json:"version"`
	Operation    string `json:"operation"`
	Token        string `json:"token,omitempty"`
	Path         string `json:"path,omitempty"`
	AgentID      string `json:"agent_id,omitempty"`
	Offset       int64  `json:"offset,omitempty"`
	Limit        int    `json:"limit,omitempty"`
	Data         string `json:"data_base64,omitempty"`
	ExpectedHash string `json:"expected_sha256,omitempty"`
	Identity     string `json:"identity,omitempty"`

	Recursive    bool           `json:"recursive,omitempty"`
	Pattern      string         `json:"pattern,omitempty"`
	ReplaceAll   bool           `json:"replace_all,omitempty"`
	Include      string         `json:"include,omitempty"`
	Literal      bool           `json:"literal,omitempty"`
	CaseFold     bool           `json:"case_fold,omitempty"`
	Entries      []Removal      `json:"entries,omitempty"`
	Skills       []SkillArchive `json:"skills,omitempty"`
	SkillSetHash string         `json:"skill_set_hash,omitempty"`
}

type SkillArchive struct {
	Name       string `json:"name"`
	ArchiveSHA string `json:"archive_sha256"`
	ContentSHA string `json:"content_sha256"`
}

type Removal struct {
	Path     string `json:"path"`
	Identity string `json:"identity"`
}

type Entry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	Size       int64  `json:"size_bytes,string"`
	ModifiedAt string `json:"modified_at"`
	Identity   string `json:"identity"`
}

type MatchGroup struct {
	Path  string  `json:"path"`
	Lines []Match `json:"lines"`
}

type Match struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

type Response struct {
	Version int             `json:"version"`
	OK      bool            `json:"ok"`
	Code    string          `json:"error_code,omitempty"`
	Changed bool            `json:"changed"`
	Result  json.RawMessage `json:"result,omitempty"`
}

type Fault struct {
	Code    string
	Changed bool
}

func (f *Fault) Error() string  { return f.Code }
func failure(code string) error { return &Fault{Code: code} }

func Result(value any, changed bool, err error) Response {
	r := Response{Version: Version, OK: err == nil, Changed: changed}
	if err != nil {
		r.Code = "WORKSPACE_IO_FAILED"
		var fault *Fault
		if errors.As(err, &fault) {
			r.Code, r.Changed = fault.Code, changed || fault.Changed
		}
		return r
	}
	r.Result, err = json.Marshal(value)
	if err != nil || len(r.Result) > MaxResponseBytes-256 {
		r.OK, r.Code, r.Result = false, "WORKSPACE_OUTPUT_LIMIT", nil
	}
	return r
}

func Normalize(value string, allowRoot bool) (string, error) {
	if value == "" && allowRoot {
		return ".", nil
	}
	if value == "." && allowRoot {
		return value, nil
	}
	if len(value) == 0 || len(value) > 1024 || !utf8.ValidString(value) || strings.ContainsAny(value, "\\\x00\r\n") || strings.HasPrefix(value, "/") || path.Clean(value) != value {
		return "", failure("WORKSPACE_PATH_INVALID")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." || len(segment) > 255 {
			return "", failure("WORKSPACE_PATH_INVALID")
		}
	}
	return value, nil
}

// PublicPath excludes internal workspace state from client-selected paths.
func PublicPath(value string, allowRoot bool) (string, error) {
	name, err := Normalize(value, allowRoot)
	if err != nil {
		return "", err
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".system" {
			return "", failure("WORKSPACE_PATH_PROTECTED")
		}
	}
	return name, nil
}
