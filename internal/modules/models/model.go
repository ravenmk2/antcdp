// Package models manages model connections, immutable routes and request-scoped tests.
package models

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type Field[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (f *Field[T]) UnmarshalJSON(b []byte) error {
	f.Set = true
	f.Null = bytes.Equal(bytes.TrimSpace(b), []byte("null"))
	if f.Null {
		return nil
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&f.Value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("invalid JSON value")
	}
	return nil
}

type Config struct {
	BaseURL        string  `json:"base_url"`
	Region         *string `json:"region"`
	CustomCA       *string `json:"custom_ca_pem"`
	ConnectTimeout int     `json:"connect_timeout_seconds"`
	RequestTimeout int     `json:"request_timeout_seconds"`
}
type SecretWrite struct {
	Operation string  `json:"operation"`
	Value     *string `json:"value,omitempty"`
}
type AuthenticationWrite struct {
	Method string      `json:"auth_method"`
	Secret SecretWrite `json:"secret"`
}
type Authentication struct {
	Method    string `json:"auth_method"`
	HasSecret bool   `json:"has_secret"`
}
type Provider struct {
	IconKey        *string         `db:"icon_key" json:"icon_key"`
	ID             uint64          `db:"id" json:"id,string"`
	Code           string          `db:"code" json:"code"`
	Name           string          `db:"name" json:"name"`
	Description    string          `db:"description" json:"description"`
	Type           string          `db:"provider_type" json:"provider_type"`
	Enabled        bool            `db:"enabled" json:"enabled"`
	Config         Config          `db:"-" json:"config"`
	Authentication Authentication  `db:"-" json:"authentication"`
	Version        string          `db:"-" json:"version"`
	CreatedAt      time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updated_at"`
	BaseURL        string          `db:"base_url" json:"-"`
	AuthMethod     string          `db:"auth_method" json:"-"`
	StoredConfig   json.RawMessage `db:"config" json:"-"`
	IdentityConfig json.RawMessage `db:"identity_config" json:"-"`
	SchemaVersion  uint64          `db:"config_schema_version" json:"-"`
	HasSecret      bool            `db:"has_secret" json:"-"`
	SecretValid    bool            `db:"secret_valid" json:"-"`
	SecretRevision uint64          `db:"secret_revision" json:"-"`
	RowVersion     uint64          `db:"row_version" json:"-"`
	ConfigVersion  uint64          `db:"config_version" json:"-"`
	Creator        uint64          `db:"created_by_user_id" json:"-"`
	ModelCount     int             `db:"model_count" json:"-"`
}
type ProviderSummary struct {
	IconKey     *string   `db:"icon_key" json:"icon_key"`
	AuthMethod  string    `json:"auth_method"`
	ID          uint64    `json:"id,string"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Type        string    `json:"provider_type"`
	Enabled     bool      `json:"enabled"`
	Endpoint    string    `json:"endpoint_display"`
	ModelCount  int       `json:"model_count"`
	HasSecret   bool      `json:"has_secret"`
	Version     string    `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type ProviderCreate struct {
	IconKey        *string              `json:"icon_key"`
	Code           Field[string]        `json:"code"`
	Name           string               `json:"name"`
	Description    string               `json:"description"`
	Type           string               `json:"provider_type"`
	Enabled        Field[bool]          `json:"enabled"`
	Config         *Config              `json:"config"`
	Authentication *AuthenticationWrite `json:"authentication"`
}
type ProviderPatch struct {
	IconKey     Field[string] `json:"icon_key"`
	Name        Field[string] `json:"name"`
	Description Field[string] `json:"description"`
	Enabled     Field[bool]   `json:"enabled"`
	Config      Field[Config] `json:"config"`
}
type Capabilities struct {
	Text      string `json:"text_input"`
	Image     string `json:"image_input"`
	Tools     string `json:"tool_calling"`
	Streaming string `json:"streaming"`
	Thinking  string `json:"thinking"`
}
type ThinkingOption = modelcore.ThinkingOption
type Definition struct {
	ThinkingLevels   []string                   `db:"-" json:"thinking_levels"`
	ThinkingMapping  map[string]json.RawMessage `db:"-" json:"thinking_mapping"`
	IconKey          *string                    `db:"icon_key" json:"icon_key"`
	ID               uint64                     `db:"id" json:"id,string"`
	ProviderID       uint64                     `db:"provider_id" json:"provider_id,string"`
	RemoteModelID    string                     `db:"model_id" json:"model_id"`
	Name             string                     `db:"name" json:"name"`
	Description      string                     `db:"description" json:"description"`
	Protocol         string                     `db:"protocol" json:"protocol"`
	Enabled          bool                       `db:"enabled" json:"enabled"`
	Capabilities     Capabilities               `db:"-" json:"declared_capabilities"`
	ContextWindow    uint64                     `db:"context_window_tokens" json:"context_window"`
	MaxOutput        uint64                     `db:"max_output_tokens" json:"max_output_tokens"`
	Parameters       json.RawMessage            `db:"generation_defaults" json:"default_parameters"`
	Thinking         []ThinkingOption           `db:"-" json:"thinking_options"`
	Version          string                     `db:"-" json:"version"`
	CreatedAt        time.Time                  `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time                  `db:"updated_at" json:"updated_at"`
	CapabilitiesJSON json.RawMessage            `db:"capabilities" json:"-"`
	ThinkingJSON     json.RawMessage            `db:"thinking_options" json:"-"`
	SchemaVersion    uint64                     `db:"capability_schema_version" json:"-"`
	RowVersion       uint64                     `db:"row_version" json:"-"`
	ConfigVersion    uint64                     `db:"config_version" json:"-"`
	Creator          uint64                     `db:"created_by_user_id" json:"-"`
}
type DefinitionSummary struct {
	IconKey       *string      `db:"icon_key" json:"icon_key"`
	ID            uint64       `json:"id,string"`
	ProviderID    uint64       `json:"provider_id,string"`
	Name          string       `json:"name"`
	RemoteModelID string       `json:"model_id"`
	Protocol      string       `json:"protocol"`
	Enabled       bool         `json:"enabled"`
	Capabilities  Capabilities `json:"declared_capabilities"`
	Version       string       `json:"version"`
}

type DefinitionCreate struct {
	ThinkingLevels  []string                   `json:"thinking_levels"`
	ThinkingMapping map[string]json.RawMessage `json:"thinking_mapping"`
	IconKey         *string                    `json:"icon_key"`
	ProviderID      string                     `json:"provider_id"`
	RemoteModelID   string                     `json:"model_id"`
	Name            string                     `json:"name"`
	Description     string                     `json:"description"`
	Protocol        string                     `json:"protocol"`
	Enabled         Field[bool]                `json:"enabled"`
	Capabilities    Capabilities               `json:"declared_capabilities"`
	ContextWindow   uint64                     `json:"context_window"`
	MaxOutput       uint64                     `json:"max_output_tokens"`
	Parameters      json.RawMessage            `json:"default_parameters"`
	Thinking        []ThinkingOption           `json:"-"`
}
type DefinitionPatch struct {
	ThinkingLevels  Field[[]string]                   `json:"thinking_levels"`
	ThinkingMapping Field[map[string]json.RawMessage] `json:"thinking_mapping"`
	IconKey         Field[string]                     `json:"icon_key"`
	Name            Field[string]                     `json:"name"`
	Description     Field[string]                     `json:"description"`
	Enabled         Field[bool]                       `json:"enabled"`
	Capabilities    Field[Capabilities]               `json:"declared_capabilities"`
	ContextWindow   Field[uint64]                     `json:"context_window"`
	MaxOutput       Field[uint64]                     `json:"max_output_tokens"`
	Parameters      Field[json.RawMessage]            `json:"default_parameters"`
	Thinking        Field[[]ThinkingOption]           `json:"-"`
}
type Query struct {
	Page, PageSize            int
	Q, ProviderType, Protocol string
	ProviderID                uint64
	Enabled                   *bool
}
type Pagination struct {
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}
type Result struct {
	Data          any
	Tag, Location string
	Status        int
	Pagination    *Pagination
	Auth          *identity.Auth `json:"-"`
}
type ProbeRequest struct {
	Kind     string
	Provider Provider
	Model    *Definition
	Secret   string
	Levels   []string
}
type Service struct {
	Store              func() (identity.Store, error)
	active             sync.Map
	Identity           *identity.Service
	Cipher             func(purpose, value string, seal bool) (string, error)
	ETag               func(string) string
	ThinkingCatalog    func(string, string) []ThinkingOption
	Types              func() any
	ValidateParameters func(providerType, protocol string, parameters json.RawMessage) error
	Probe              func(context.Context, ProbeRequest) (json.RawMessage, error)
	// ReferenceCheck runs inside the same transaction. Later modules may register
	// their reference check without querying nonexistent tables in this phase.
	ReferenceCheck func(context.Context, identity.Tx, string, uint64) (bool, error)
}
type Repository interface {
	Providers(Query) ([]Provider, int, error)
	Provider(uint64) (*Provider, error)
	InsertProvider(*Provider) error
	SaveProvider(*Provider) error
	DeleteProvider(uint64) error
	SetSecret(uint64, string) error
	Secret(uint64) (string, error)
	Definitions(Query) ([]Definition, int, error)
	Definition(uint64, bool) (*Definition, error)
	InsertDefinition(*Definition) error
	SaveDefinition(*Definition) error
	DeleteDefinition(uint64) error
	ProviderReferenced(uint64) (bool, error)
}
