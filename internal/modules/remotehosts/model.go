// Package remotehosts manages SSH hosts, trusted host keys and owned credentials.
package remotehosts

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/credentials"
)

type Host struct {
	TrustActor          uint64            `db:"-" json:"-"`
	Hostname            string            `db:"host" json:"-"`
	Port                int               `db:"port" json:"-"`
	HostKeyFingerprints map[string]string `db:"-" json:"host_key_fingerprints,omitempty"`
	ConfigJSON          json.RawMessage   `db:"config" json:"-"`
	ConfigSchemaVersion uint64            `db:"config_schema_version" json:"-"`
	ID                  uint64            `db:"id" json:"id,string"`
	Type                string            `db:"service_type" json:"service_type"`
	Code                string            `db:"code" json:"code"`
	Name                string            `db:"name" json:"name"`
	Description         string            `db:"description" json:"description"`
	Enabled             bool              `db:"enabled" json:"enabled"`
	Version             uint64            `db:"row_version" json:"-"`
	ConfigVersion       uint64            `db:"config_version" json:"-"`
	CredentialsVersion  uint64            `db:"credentials_version" json:"-"`
	Creator             uint64            `db:"created_by_user_id" json:"-"`
	CreatedAt           time.Time         `db:"created_at" json:"created_at"`
	UpdatedAt           time.Time         `db:"updated_at" json:"updated_at"`
	Config              Config            `db:"-" json:"config"`
	EditVersion         string            `db:"-" json:"version"`
}

// Config is the SSH connection API value; persistence uses explicit host/port columns.
type Config struct {
	HostKeys []string `json:"host_keys,omitempty"`
	Host     string   `json:"host"`
	Port     int      `json:"port"`
}
type CredentialOwnership = credentials.Scope

func unquote(tag string) string { return strings.Trim(tag, `"`) }
func (s *Service) tag(kind string, values ...any) string {
	return `"` + s.ETag(fmt.Sprint(append([]any{"remote-hosts/v1/", kind, "/"}, values...)...)) + `"`
}
func (s *Service) connectionTag(v *Host) string {
	return s.tag("connection", v.ID, "/", v.Version)
}
func (s *Service) preferredTag(v *Host, owner CredentialOwnership) string {
	return s.tag("preferred", v.ID, "/", owner.Type, "/", owner.Owner, "/", v.CredentialsVersion)
}

type Repository interface {
	Connections() ([]Host, error)
	Connection(uint64) (*Host, error) // locks parent before child access
	InsertConnection(*Host) error
	SaveConnection(*Host) error
	DeleteConnection(uint64) error
	credentials.Reader

	Diagnostics(string, uint64) (json.RawMessage, error)
	SaveDiagnostics(string, uint64, json.RawMessage) error
}
