// Package integrations manages service connections, owned credentials and connection webhook settings.
package integrations

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/credentials"
)

type ServiceConnection struct {
	ConfigJSON          json.RawMessage `db:"config" json:"-"`
	ConfigSchemaVersion uint64          `db:"config_schema_version" json:"-"`
	ID                  uint64          `db:"id" json:"id,string"`
	Type                string          `db:"service_type" json:"service_type"`
	Ownership           string          `db:"ownership_type" json:"ownership_type"`
	ProjectID           *uint64         `db:"project_id" json:"project_id,string"`
	Code                string          `db:"code" json:"code"`
	Name                string          `db:"name" json:"name"`
	Description         string          `db:"description" json:"description"`
	Enabled             bool            `db:"enabled" json:"enabled"`
	Version             uint64          `db:"row_version" json:"-"`
	ConfigVersion       uint64          `db:"config_version" json:"-"`
	CredentialsVersion  uint64          `db:"credentials_version" json:"-"`
	GrantsVersion       uint64          `db:"grants_version" json:"-"`
	Creator             uint64          `db:"created_by_user_id" json:"-"`
	CreatedAt           time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt           time.Time       `db:"updated_at" json:"updated_at"`
	Config              HTTPConfig      `db:"-" json:"config"`
	EditVersion         string          `db:"-" json:"version"`
}

// HTTPConfig is the shared persisted connection configuration. Database adapters
// use host, port, database and TLSMode; HTTP adapters reject database fields.
type HTTPConfig struct {
	Host                string  `db:"-" json:"host,omitempty"`
	Port                int     `db:"-" json:"port,omitempty"`
	Database            string  `db:"-" json:"database,omitempty"`
	TLSMode             string  `db:"-" json:"tls_mode,omitempty"`
	DefaultOrganization string  `db:"-" json:"default_organization,omitempty"`
	BaseURL             string  `db:"base_url" json:"base_url,omitempty"`
	CA                  *string `db:"custom_ca_pem" json:"custom_ca_pem"`
}
type ServiceCredential = credentials.Entry
type CredentialOwnership = credentials.Scope

type ConnectionGrant struct {
	ConnectionID uint64    `db:"connection_id" json:"connection_id,string"`
	SubjectKind  string    `db:"subject_kind" json:"subject_kind"`
	SubjectID    uint64    `db:"subject_id" json:"subject_id,string"`
	SubjectName  string    `db:"subject_name" json:"subject_name"`
	Enabled      bool      `db:"enabled" json:"enabled"`
	Version      uint64    `db:"row_version" json:"-"`
	Creator      uint64    `db:"created_by_user_id" json:"created_by_user_id,string"`
	Updater      uint64    `db:"updated_by_user_id" json:"updated_by_user_id,string"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}

func (v *ServiceConnection) ValidOwnership() bool {
	return v.Ownership == "platform" && v.ProjectID == nil || v.Ownership == "project" && v.ProjectID != nil && *v.ProjectID != 0
}

// WebhookSettings is a singleton value owned by a service connection, not an entity.
type WebhookSettings struct {
	ConnectionID uint64     `db:"connection_id" json:"connection_id,string"`
	Enabled      bool       `db:"webhook_enabled" json:"enabled"`
	Method       string     `db:"webhook_verification_method" json:"verification_method"`
	HasSecret    bool       `db:"has_secret" json:"has_secret"`
	SecretValid  bool       `db:"secret_valid" json:"-"`
	Version      uint64     `db:"webhook_version" json:"-"`
	UpdatedAt    *time.Time `db:"webhook_updated_at" json:"updated_at"`
	EditVersion  string     `db:"-" json:"version"`
}

func (w *WebhookSettings) ValidRecord() bool {
	return w.ConnectionID != 0 && w.Version != 0 && w.SecretValid && (w.Method == "secret_token" || w.Method == "signing_token") && (!w.Enabled || w.HasSecret)
}

func unquote(tag string) string { return strings.Trim(tag, `"`) }
func (s *Service) tag(kind string, values ...any) string {
	return `"` + s.ETag(fmt.Sprint(append([]any{"v1/", kind, "/"}, values...)...)) + `"`
}
func (s *Service) connectionTag(v *ServiceConnection) string {
	return s.tag("connection", v.ID, "/", v.Version)
}
func (s *Service) webhookTag(v *WebhookSettings) string {
	return s.tag("webhook-settings", v.ConnectionID, "/", v.Version)
}
func (s *Service) preferredTag(v *ServiceConnection, owner CredentialOwnership) string {
	return s.tag("preferred", v.ID, "/", owner.Type, "/", owner.Owner, "/", v.CredentialsVersion)
}
func (s *Service) grantsTag(v *ServiceConnection) string {
	return s.tag("grants", v.ID, "/", v.GrantsVersion)
}

type Repository interface {
	Connections() ([]ServiceConnection, error)
	Connection(uint64) (*ServiceConnection, error) // locks parent before child access
	InsertConnection(*ServiceConnection) error
	SaveConnection(*ServiceConnection) error
	DeleteConnection(uint64) error
	ConnectionGrants(uint64) ([]ConnectionGrant, error)
	SaveConnectionGrant(*ConnectionGrant) error
	ConnectionGranted(uint64, CredentialOwnership, bool) (bool, error)
	ConnectionUserScopes(uint64) ([]CredentialOwnership, error)
	ConnectionJobReferences(uint64, uint64) (int, error)
	credentials.Reader
	WebhookSettings(uint64) (*WebhookSettings, error)
	SaveWebhookSettings(*WebhookSettings) error
	SetSecret(string, uint64, string) error
	Secret(string, uint64) (string, error)
	Diagnostics(string, uint64) (json.RawMessage, error)
	SaveDiagnostics(string, uint64, json.RawMessage) error
}
