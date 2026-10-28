// Package integrations manages service configuration and scoped credentials.
package integrations

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

type Integration struct {
	ID                 uint64    `db:"id" json:"id,string"`
	Type               string    `db:"service_type" json:"service_type"`
	Name               string    `db:"name" json:"name"`
	Description        string    `db:"description" json:"description"`
	Enabled            bool      `db:"enabled" json:"enabled"`
	DefaultID          *uint64   `db:"default_credential_id" json:"-"`
	Version            uint64    `db:"row_version" json:"version,string"`
	CredentialsVersion uint64    `db:"credentials_version" json:"-"`
	DefaultVersion     uint64    `db:"default_version" json:"-"`
	Creator            uint64    `db:"created_by_user_id" json:"-"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at" json:"updated_at"`
}
type GitLab struct {
	ID                uint64  `db:"integration_id" json:"integration_id,string"`
	BaseURL           string  `db:"base_url" json:"base_url"`
	CA                *string `db:"custom_ca_pem" json:"custom_ca_pem"`
	WebhookEnabled    bool    `db:"webhook_enabled" json:"webhook_enabled"`
	Method            string  `db:"webhook_verification_method" json:"webhook_verification_method"`
	HasSecret         bool    `db:"has_secret" json:"has_secret"`
	Version           uint64  `db:"row_version" json:"version,string"`
	ConnectionVersion uint64  `db:"connection_version" json:"-"`
	WebhookVersion    uint64  `db:"webhook_version" json:"-"`
}
type Credential struct {
	ID              uint64          `db:"id" json:"id,string"`
	IntegrationID   uint64          `db:"integration_id" json:"integration_id,string"`
	Scope           string          `db:"scope_type" json:"scope_type"`
	ProjectID       *uint64         `db:"project_id" json:"project_id,string"`
	UserID          *uint64         `db:"user_id" json:"user_id,string"`
	Name            string          `db:"name" json:"name"`
	Description     string          `db:"description" json:"description"`
	AuthMethod      string          `db:"auth_method" json:"auth_method"`
	Identity        json.RawMessage `db:"identity_config" json:"identity_config"`
	Enabled         bool            `db:"enabled" json:"enabled"`
	Preferred       bool            `db:"is_preferred" json:"is_preferred"`
	HasSecret       bool            `db:"has_secret" json:"has_secret"`
	ExpiresAt       *time.Time      `db:"expires_at" json:"expires_at"`
	Version         uint64          `db:"row_version" json:"version,string"`
	MaterialVersion uint64          `db:"material_version" json:"-"`
	Creator         uint64          `db:"created_by_user_id" json:"-"`
}
type Scope struct {
	Type  string
	Owner uint64
}

func (i *Integration) Tag() string { return fmt.Sprintf(`"integration-%d-v%d"`, i.ID, i.Version) }
func (g *GitLab) Tag() string      { return fmt.Sprintf(`"gitlab-config-%d-v%d"`, g.ID, g.Version) }
func (c *Credential) Tag() string  { return fmt.Sprintf(`"credential-%d-v%d"`, c.ID, c.Version) }
func (i *Integration) DefaultTag() string {
	return fmt.Sprintf(`"integration-default-%d-v%d"`, i.ID, i.DefaultVersion)
}
func (i *Integration) CollectionTag(s Scope) string {
	return fmt.Sprintf(`"credentials-%x"`, sha256.Sum256([]byte(fmt.Sprintf("v1/%d/%s/%d/%d", i.ID, s.Type, s.Owner, i.CredentialsVersion))))
}
func (c *Credential) Usable() bool {
	return c.Enabled && c.HasSecret && (c.ExpiresAt == nil || c.ExpiresAt.After(time.Now()))
}

type Repository interface {
	Integrations() ([]Integration, error)
	Integration(uint64) (*Integration, error) // locks common row before any child access
	GitLab(uint64) (*GitLab, error)
	InsertIntegration(*Integration, *GitLab) error
	SaveIntegration(*Integration) error
	SaveGitLab(*GitLab) error
	DeleteIntegration(uint64) error
	Credentials(uint64, Scope) ([]Credential, error)
	Credential(uint64) (*Credential, error)
	InsertCredential(*Credential) error
	SaveCredential(*Credential) error
	DeleteCredential(uint64) error
	CredentialCount(uint64) (int, error)
	SetSecret(string, uint64, string) error
	Secret(string, uint64) (string, error)
	Diagnostics(string, uint64) (json.RawMessage, error)
	SaveDiagnostics(string, uint64, json.RawMessage) error
}
