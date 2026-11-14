// Package integrations manages service connections, owned credentials and connection webhook settings.
package integrations

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type ServiceConnection struct {
	ConfigJSON          json.RawMessage `db:"config" json:"-"`
	ConfigSchemaVersion uint64          `db:"config_schema_version" json:"-"`
	ID                  uint64          `db:"id" json:"id,string"`
	Type                string          `db:"service_type" json:"service_type"`
	Code                string          `db:"code" json:"code"`
	Name                string          `db:"name" json:"name"`
	Description         string          `db:"description" json:"description"`
	Enabled             bool            `db:"enabled" json:"enabled"`
	FallbackID          *uint64         `db:"fallback_credential_id" json:"-"`
	Version             uint64          `db:"row_version" json:"-"`
	ConfigVersion       uint64          `db:"config_version" json:"-"`
	CredentialsVersion  uint64          `db:"credentials_version" json:"-"`
	FallbackVersion     uint64          `db:"fallback_version" json:"-"`
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
type ServiceCredential struct {
	ID                uint64          `db:"id" json:"id,string"`
	ConnectionID      uint64          `db:"connection_id" json:"connection_id,string"`
	Type              string          `db:"service_type" json:"service_type"`
	Code              string          `db:"code" json:"code"`
	Ownership         string          `db:"ownership_type" json:"ownership_type"`
	ProjectID         *uint64         `db:"project_id" json:"project_id,string"`
	UserID            *uint64         `db:"user_id" json:"user_id,string"`
	Name              string          `db:"name" json:"name"`
	Description       string          `db:"description" json:"description"`
	AuthMethod        string          `db:"auth_method" json:"auth_method"`
	AuthSchemaVersion uint64          `db:"auth_schema_version" json:"-"`
	Identity          json.RawMessage `db:"identity_config" json:"identity_config"`
	Enabled           bool            `db:"enabled" json:"enabled"`
	Preferred         bool            `db:"is_preferred" json:"is_preferred"`
	HasSecret         bool            `db:"has_secret" json:"has_secret"`
	SecretValid       bool            `db:"secret_valid" json:"-"`
	ExpiresAt         *time.Time      `db:"expires_at" json:"expires_at"`
	Version           uint64          `db:"row_version" json:"-"`
	MaterialVersion   uint64          `db:"material_version" json:"-"`
	Creator           uint64          `db:"created_by_user_id" json:"-"`
	CreatedAt         time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time       `db:"updated_at" json:"updated_at"`
	EditVersion       string          `db:"-" json:"version"`
}
type CredentialOwnership struct {
	Type  string
	Owner uint64
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

func (c *ServiceCredential) Usable() bool {
	return c.Enabled && c.HasSecret && (c.ExpiresAt == nil || c.ExpiresAt.After(time.Now()))
}
func unquote(tag string) string { return strings.Trim(tag, `"`) }
func (s *Service) tag(kind string, values ...any) string {
	return `"` + s.ETag(fmt.Sprint(append([]any{"v1/", kind, "/"}, values...)...)) + `"`
}
func (s *Service) connectionTag(v *ServiceConnection) string {
	return s.tag("connection", v.ID, "/", v.Version)
}
func (s *Service) credentialTag(v *ServiceCredential) string {
	return s.tag("credential", v.ID, "/", v.Version)
}
func (s *Service) webhookTag(v *WebhookSettings) string {
	return s.tag("webhook-settings", v.ConnectionID, "/", v.Version)
}
func (s *Service) collectionTag(v *ServiceConnection, owner CredentialOwnership) string {
	return s.tag("credentials", v.ID, "/", owner.Type, "/", owner.Owner, "/", v.CredentialsVersion)
}
func (s *Service) preferredTag(v *ServiceConnection, owner CredentialOwnership) string {
	return s.tag("preferred", v.ID, "/", owner.Type, "/", owner.Owner, "/", v.CredentialsVersion)
}
func (s *Service) fallbackTag(v *ServiceConnection) string {
	return s.tag("fallback", v.ID, "/", v.FallbackVersion)
}

type Repository interface {
	Connections() ([]ServiceConnection, error)
	Connection(uint64) (*ServiceConnection, error) // locks parent before child access
	InsertConnection(*ServiceConnection) error
	SaveConnection(*ServiceConnection) error
	DeleteConnection(uint64) error
	Credentials(uint64, CredentialOwnership) ([]ServiceCredential, error)
	Credential(uint64) (*ServiceCredential, error)
	InsertCredential(*ServiceCredential) error
	SaveCredential(*ServiceCredential) error
	DeleteCredential(uint64) error
	CredentialCount(uint64) (int, error)
	WebhookSettings(uint64) (*WebhookSettings, error)
	SaveWebhookSettings(*WebhookSettings) error
	SetSecret(string, uint64, string) error
	Secret(string, uint64) (string, error)
	Diagnostics(string, uint64) (json.RawMessage, error)
	SaveDiagnostics(string, uint64, json.RawMessage) error
}

// ValidRecord detects unsupported or malformed persisted authentication/ownership.
func (c *ServiceCredential) ValidRecord() bool {
	if c.ID == 0 || c.ConnectionID == 0 || c.Creator == 0 || names(c.Name, c.Description) != nil || c.Preferred && !c.Enabled || !c.SecretValid || c.Version == 0 || c.MaterialVersion == 0 || c.AuthSchemaVersion != 1 || !c.HasSecret || !credentialCodePattern.MatchString(c.Code) {
		return false
	}
	if validateIdentityFor(c.Type, c.AuthMethod, c.Identity) != nil {
		return false
	}
	switch c.Ownership {
	case "system":
		return c.ProjectID == nil && c.UserID == nil
	case "project":
		return c.UserID == nil && c.ProjectID != nil && *c.ProjectID != 0
	case "personal":
		return c.ProjectID == nil && c.UserID != nil && *c.UserID != 0
	}
	return false
}
