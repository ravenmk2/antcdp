// Package diagnostic carries bounded public facts separately from error/control semantics.
package diagnostic

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net"
	"syscall"
)

// Detail contains no remote messages, URLs, headers, credentials or request bodies.
// Callers supply only host-owned identifiers and classification codes.
type Detail struct {
	Source      string `json:"source,omitempty"`
	Stage       string `json:"stage,omitempty"`
	Code        string `json:"code,omitempty"`
	HTTPStatus  int    `json:"http_status,omitempty"`
	Network     string `json:"network,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	InstanceID  string `json:"instance_id,omitempty"`
	ToolName    string `json:"tool_name,omitempty"`
	ToolIndex   int    `json:"tool_index,omitempty"`
	FieldPath   string `json:"field_path,omitempty"`
	Constraint  string `json:"constraint,omitempty"`
	Expected    string `json:"expected,omitempty"`
}

type carrier interface{ Diagnostic() *Detail }

func From(err error) *Detail {
	var c carrier
	if errors.As(err, &c) {
		return Copy(c.Diagnostic())
	}
	return nil
}

func Copy(d *Detail) *Detail {
	if d == nil {
		return nil
	}
	v := *d
	v.Source = token(v.Source)
	v.Stage = token(v.Stage)
	v.Code = token(v.Code)
	v.OperationID = token(v.OperationID)
	v.InstanceID = token(v.InstanceID)
	v.ToolName = token(v.ToolName)
	v.Constraint = token(v.Constraint)
	v.FieldPath = safePath(v.FieldPath)
	v.Expected = safePath(v.Expected)
	if v.ToolIndex < 0 || v.ToolIndex > 256 {
		v.ToolIndex = 0
	}
	switch v.Network {
	case "dns", "timeout", "connection_refused", "connection_reset", "tls":
	default:
		v.Network = ""
	}
	if v.HTTPStatus < 100 || v.HTTPStatus > 599 {
		v.HTTPStatus = 0
	}
	if v == (Detail{}) {
		return nil
	}
	return &v
}

func safePath(s string) string {
	if len(s) > 256 {
		return ""
	}
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-', c == '/', c == '.', c == '~', c == ',':
		default:
			return ""
		}
	}
	return s
}

func token(s string) string {
	if len(s) > 96 {
		return ""
	}
	for _, c := range s {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-':
		default:
			return ""
		}
	}
	return s
}

type failure struct {
	cause  error
	detail *Detail
}

// Attach replaces explanatory facts without changing the wrapped control error.
func Attach(err error, detail *Detail) error {
	if err == nil {
		return nil
	}
	return &failure{cause: err, detail: Copy(detail)}
}

func (e *failure) Error() string       { return e.cause.Error() }
func (e *failure) Unwrap() error       { return e.cause }
func (e *failure) Diagnostic() *Detail { return Copy(e.detail) }

// With fills missing context, preserving a more specific inner stage and all
// errors.Is/As behavior. Diagnostic data must never decide whether to retry.
func With(err error, context Detail) error {
	if err == nil {
		return nil
	}
	d := From(err)
	if d == nil {
		d = &Detail{}
	}
	if d.Source == "" {
		d.Source = context.Source
	}
	if d.Stage == "" {
		d.Stage = context.Stage
	}
	if d.Code == "" {
		d.Code = context.Code
	}
	if d.HTTPStatus == 0 {
		d.HTTPStatus = context.HTTPStatus
	}
	if d.Network == "" {
		d.Network = context.Network
	}
	if d.OperationID == "" {
		d.OperationID = context.OperationID
	}
	if d.InstanceID == "" {
		d.InstanceID = context.InstanceID
	}
	return &failure{cause: err, detail: Copy(d)}
}

// NetworkClass examines types only; never retain the original network error.
func NetworkClass(err error) string {
	var dns *net.DNSError
	var timeout net.Error
	var certificate *tls.CertificateVerificationError
	var authority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var record tls.RecordHeaderError
	switch {
	case errors.As(err, &dns):
		return "dns"
	case errors.As(err, &certificate), errors.As(err, &authority), errors.As(err, &hostname), errors.As(err, &record):
		return "tls"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "connection_refused"
	case errors.Is(err, syscall.ECONNRESET):
		return "connection_reset"
	case errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	default:
		return ""
	}
}

// Read/Put extend object-shaped observations without replacing existing fields.
func Read(raw json.RawMessage) *Detail {
	var v struct {
		Diagnostic *Detail `json:"diagnostic"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return Copy(v.Diagnostic)
}
func Put(raw json.RawMessage, detail *Detail) (json.RawMessage, error) {
	if detail = Copy(detail); detail == nil {
		return raw, nil
	}
	v := map[string]json.RawMessage{}
	if len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
	}
	if v == nil {
		v = map[string]json.RawMessage{}
	}
	b, err := json.Marshal(detail)
	if err != nil {
		return nil, err
	}
	v["diagnostic"] = b
	return json.Marshal(v)
}
