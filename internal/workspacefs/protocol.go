// Package workspacefs defines the bounded protocol of the trusted workspace
// helper. It does not authorize platform users or choose a sandbox.
package workspacefs

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"
	"unicode/utf8"
)

const Version = 1
const HelperPath = "/usr/local/libexec/antcdp-workspace-helper"
const TransferDirectory = "/run/antcdp-transfers"
const MaxRequestBytes = 46 << 10
const MaxResponseBytes = 1 << 20
const MaxReadBytes = 64 << 10
const MaxWriteBytes = 32 << 10
const MaxFileBytes int64 = 100 << 20
const MaxWalkEntries = 10000

// Paths are relative to /data. File operations never follow symlinks.
type Request struct {
	Version      int            `json:"version"`
	Operation    string         `json:"operation"`
	Token        string         `json:"token,omitempty"`
	Path         string         `json:"path,omitempty"`
	AgentID      string         `json:"agent_id,omitempty"`
	ProjectID    string         `json:"project_id,omitempty"`
	Offset       int64          `json:"offset,omitempty"`
	Limit        int            `json:"limit,omitempty"`
	Data         string         `json:"data_base64,omitempty"`
	ExpectedHash string         `json:"expected_sha256,omitempty"`
	Identity     string         `json:"identity,omitempty"`
	Overwrite    bool           `json:"overwrite,omitempty"`
	Recursive    bool           `json:"recursive,omitempty"`
	Pattern      string         `json:"pattern,omitempty"`
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

type Match struct {
	Path string `json:"path"`
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

func Encode(request Request) (string, error) {
	request.Version = Version
	data, err := json.Marshal(request)
	if err != nil || len(data) > MaxRequestBytes {
		return "", failure("WORKSPACE_REQUEST_INVALID")
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func Decode(encoded string) (Request, error) {
	var request Request
	if len(encoded) > base64.RawURLEncoding.EncodedLen(MaxRequestBytes) {
		return request, failure("WORKSPACE_REQUEST_INVALID")
	}
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(data) > MaxRequestBytes {
		return request, failure("WORKSPACE_REQUEST_INVALID")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || request.Version != Version {
		return request, failure("WORKSPACE_REQUEST_INVALID")
	}
	return request, nil
}

// Normalize refuses aliases such as a/../b instead of silently changing their
// meaning. The host resolves a model's relative CWD before using this protocol.
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

func reserved(value string) bool {
	if value == "." || value == ".system" || strings.HasPrefix(value, ".system/") {
		return true
	}
	parts := strings.Split(value, "/")
	return parts[0] == "agents"
}

// PublicPath excludes internal helper state from client-selected paths.
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

type Engine struct {
	WorkspaceRoot string
	TransferRoot  string
	UID, GID      int
}

func DefaultEngine() *Engine {
	return &Engine{WorkspaceRoot: "/data", TransferRoot: TransferDirectory, UID: 10001, GID: 10001}
}
