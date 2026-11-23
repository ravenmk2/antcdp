// Package credentials owns scoped login material and resource preferences.
package credentials

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"golang.org/x/crypto/ssh"
)

const (
	Platform  = "platform"
	Project   = "project"
	User      = "user"
	Team      = "team"
	Password  = "username_password"
	Secret    = "secret"
	SSHKey    = "ssh_private_key"
	AccessKey = "access_key_pair"
)

type Scope struct {
	Type  string `db:"kind"`
	Owner uint64 `db:"owner_id"`
}

type Entry struct {
	ID              uint64     `db:"id" json:"id,string"`
	ScopeKind       string     `db:"scope_kind" json:"scope_kind"`
	ScopeID         uint64     `db:"scope_id" json:"scope_id,string"`
	Code            string     `db:"code" json:"code"`
	Name            string     `db:"name" json:"name"`
	Description     string     `db:"description" json:"description"`
	Kind            string     `db:"kind" json:"kind"`
	Identifier      string     `db:"identifier" json:"identifier"`
	Enabled         bool       `db:"enabled" json:"enabled"`
	ExpiresAt       *time.Time `db:"expires_at" json:"expires_at"`
	Version         uint64     `db:"row_version" json:"-"`
	MaterialVersion uint64     `db:"material_version" json:"-"`
	Creator         uint64     `db:"created_by_user_id" json:"-"`
	EditVersion     string     `db:"-" json:"version"`
}
type Material struct {
	Value      string `json:"value"`
	Passphrase string `json:"passphrase,omitempty"`
}
type Cipher func(string, string, bool) (string, error)

func (e *Entry) Purpose() string { return fmt.Sprintf("credential/%d/%s/v1", e.ID, e.Kind) }
func (e *Entry) Owned(s Scope) bool {
	return e != nil && e.ScopeKind == s.Type && e.ScopeID == s.Owner
}
func (e *Entry) Usable() bool {
	return e != nil && e.Enabled && (e.ExpiresAt == nil || e.ExpiresAt.After(time.Now()))
}
func (e *Entry) Compatible(service string) bool {
	switch service {
	case "ssh":
		return e.Kind == Password || e.Kind == SSHKey
	case "gitlab":
		return e.Kind == Secret
	case "elasticsearch":
		return e.Kind == Secret || e.Kind == Password
	case "jenkins", "openobserve", "mysql", "postgresql":
		return e.Kind == Password
	}
	return false
}
func (m Material) Validate(kind, identifier string) error {
	if m.Value == "" || strings.ContainsRune(m.Value, 0) {
		return httpx.Invalid("material.value", "invalid_format")
	}
	if kind != SSHKey && (len(m.Value) > 8192 || m.Passphrase != "") {
		return httpx.Invalid("material", "invalid_format")
	}
	if kind == Secret {
		if identifier != "" {
			return httpx.Invalid("identifier", "not_allowed")
		}
		return nil
	}
	if identifier == "" || len(identifier) > 255 || strings.TrimSpace(identifier) != identifier || strings.ContainsFunc(identifier, unicode.IsControl) {
		return httpx.Invalid("identifier", "invalid_format")
	}
	switch kind {
	case Password, AccessKey:
		return nil
	case SSHKey:
		if len(m.Value) > 32768 || len(m.Passphrase) > 8192 {
			return httpx.Invalid("material", "invalid_format")
		}
		var err error
		if m.Passphrase == "" {
			_, err = ssh.ParsePrivateKey([]byte(m.Value))
		} else {
			_, err = ssh.ParsePrivateKeyWithPassphrase([]byte(m.Value), []byte(m.Passphrase))
		}
		if err != nil {
			return httpx.Invalid("material.value", "invalid_key_or_passphrase")
		}
		return nil
	default:
		return httpx.Invalid("kind", "unsupported")
	}
}

type Preference struct {
	ID           uint64 `db:"id"`
	CredentialID uint64 `db:"credential_id"`
}
type Reader interface {
	Entries(Scope) ([]Entry, error)
	Entry(uint64) (*Entry, error)
	MaterialCiphertext(uint64) (string, error)
	Preference(string, uint64, Scope) (*Preference, error)
	SetPreference(string, uint64, Scope, *uint64) error
}
type Repository interface {
	Reader
	InsertEntry(*Entry) error
	UpdateEntry(*Entry) error
	StoreMaterial(uint64, string) error
	RemoveEntry(uint64) error
}

func Open(r Reader, cipher Cipher, e *Entry) (Material, error) {
	var material Material
	sealed, err := r.MaterialCiphertext(e.ID)
	if err != nil {
		return material, err
	}
	raw, err := cipher(e.Purpose(), sealed, false)
	if err != nil {
		return material, err
	}
	err = json.Unmarshal([]byte(raw), &material)
	return material, err
}
func Selected(r Reader, target string, id uint64, owner Scope, service string) (*Entry, *Preference, error) {
	p, err := r.Preference(target, id, owner)
	if err != nil || p == nil {
		return nil, p, err
	}
	e, err := r.Entry(p.CredentialID)
	if err != nil {
		return nil, nil, err
	}
	if !e.Owned(owner) || !e.Compatible(service) {
		return nil, nil, httpx.E(500, "DATA_INTEGRITY_ERROR", "首选凭据归属或类型异常")
	}
	return e, p, nil
}

func (e *Entry) Tag() string {
	return fmt.Sprintf(`"%x"`, sha256.Sum256([]byte(fmt.Sprintf("credential/v1/%d/%d", e.ID, e.Version))))
}

// Candidates returns only material types accepted by this resource.
func Candidates(r Reader, scope Scope, service string) ([]Entry, error) {
	entries, err := r.Entries(scope)
	if err != nil {
		return nil, err
	}
	items := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.Compatible(service) {
			e.EditVersion = strings.Trim(e.Tag(), `"`)
			items = append(items, e)
		}
	}
	return items, nil
}

// Choose runs while the resource is locked. Locking the new credential also
// serializes selection with rotation, disable and deletion.
func Choose(r Reader, target string, id uint64, scope Scope, service string, current, next *uint64) (bool, error) {
	if next != nil {
		e, err := r.Entry(*next)
		if err != nil {
			return false, err
		}
		if !e.Owned(scope) || !e.Compatible(service) {
			return false, httpx.E(404, "NOT_FOUND", "找不到匹配的凭据")
		}
		if !e.Usable() {
			return false, httpx.E(409, "CREDENTIAL_UNAVAILABLE", "凭据已停用或到期")
		}
	}
	if current == nil && next == nil || current != nil && next != nil && *current == *next {
		return false, nil
	}
	return true, r.SetPreference(target, id, scope, next)
}
