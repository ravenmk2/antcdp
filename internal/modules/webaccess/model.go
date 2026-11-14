// Package webaccess owns retrieval configuration independently of its callers.
package webaccess

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

type Field[T any] = models.Field[T]
type Result struct {
	Data          any
	Tag, Location string
	Status        int
	Pagination    *Pagination
	Auth          *identity.Auth `json:"-"`
}
type Pagination = models.Pagination
type Authentication = models.Authentication
type AuthenticationWrite = models.AuthenticationWrite
type Config struct {
	BaseURL string `json:"base_url"`
	Timeout int    `json:"timeout_seconds"`
}
type Provider struct {
	ID             uint64          `db:"id" json:"id,string"`
	Code           string          `db:"code" json:"code"`
	Name           string          `db:"name" json:"name"`
	Description    string          `db:"description" json:"description"`
	Type           string          `db:"provider_type" json:"provider_type"`
	Enabled        bool            `db:"enabled" json:"enabled"`
	Supported      []string        `db:"-" json:"supported_operations"`
	Config         Config          `db:"-" json:"config"`
	Authentication Authentication  `db:"-" json:"authentication"`
	Version        string          `db:"-" json:"version"`
	CreatedAt      time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updated_at"`
	BaseURL        string          `db:"base_url" json:"-"`
	AuthMethod     string          `db:"auth_method" json:"-"`
	IdentityConfig json.RawMessage `db:"identity_config" json:"-"`
	StoredConfig   json.RawMessage `db:"config" json:"-"`
	SupportedJSON  json.RawMessage `db:"supported_operations" json:"-"`
	SchemaVersion  uint64          `db:"config_schema_version" json:"-"`
	HasSecret      bool            `db:"has_secret" json:"-"`
	SecretValid    bool            `db:"secret_valid" json:"-"`
	SecretRevision uint64          `db:"secret_revision" json:"-"`
	RowVersion     uint64          `db:"row_version" json:"-"`
	ConfigVersion  uint64          `db:"config_version" json:"-"`
	LastDiagnostic json.RawMessage `db:"last_diagnostic" json:"-"`
	Creator        uint64          `db:"created_by_user_id" json:"-"`
}
type ProviderCreate struct {
	Code           Field[string]        `json:"code"`
	Name           string               `json:"name"`
	Description    string               `json:"description"`
	Type           string               `json:"provider_type"`
	Enabled        Field[bool]          `json:"enabled"`
	Config         *Config              `json:"config"`
	Authentication *AuthenticationWrite `json:"authentication"`
}
type ProviderPatch struct {
	Name        Field[string] `json:"name"`
	Description Field[string] `json:"description"`
	Enabled     Field[bool]   `json:"enabled"`
	Config      Field[Config] `json:"config"`
}
type Query struct {
	Page, PageSize             int
	Q, ProviderType, Operation string
	Enabled                    *bool
}
type Settings struct {
	runtime.Settings
	Version string `json:"version"`
}
type SettingsRow struct {
	SearchRoutes  json.RawMessage `db:"search_routes"`
	MaxResults    int             `db:"search_max_results"`
	FetchRoutes   json.RawMessage `db:"fetch_routes"`
	MaxBytes      int64           `db:"fetch_max_bytes"`
	Timeout       int             `db:"fetch_timeout_seconds"`
	MaxRedirects  int             `db:"fetch_max_redirects"`
	InternalHosts json.RawMessage `db:"fetch_allowed_internal_hosts"`
	RowVersion    uint64          `db:"row_version"`
	UpdatedBy     *uint64         `db:"updated_by_user_id"`
	CreatedAt     time.Time       `db:"created_at"`
	UpdatedAt     time.Time       `db:"updated_at"`
}
type RouteState struct {
	Route     runtime.RouteRef `json:"route"`
	Available bool             `json:"available"`
	Reason    *string          `json:"reason"`
}
type OperationState struct {
	Available bool         `json:"available"`
	Reason    *string      `json:"reason"`
	Routes    []RouteState `json:"routes"`
}
type State struct {
	Search OperationState `json:"search"`
	Fetch  OperationState `json:"fetch"`
}
type ProbeSnapshot struct {
	ConfigVersion  uint64 `json:"config_version"`
	SecretRevision uint64 `json:"secret_revision"`
}
type ProbeWrite struct {
	Operation string `json:"operation"`
}
type Check struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}
type Diagnostic struct {
	Kind       string     `json:"kind"`
	Status     string     `json:"status"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	Checks     []Check    `json:"checks"`
	Outdated   bool       `json:"outdated"`
}
type ProbeResult struct {
	Operation  string     `json:"operation"`
	Diagnostic Diagnostic `json:"diagnostic"`
}
type Service struct {
	Identity *identity.Service
	Store    func() (identity.Store, error)
	Cipher   func(purpose, value string, seal bool) (string, error)
	ETag     func(string) string
	Adapter  func(context.Context, Provider, string) (runtime.Adapter, error)
	Reader   runtime.Adapter
	leaseMu  sync.Mutex
	active   map[uint64]int
	testing  sync.Map
}
type Repository interface {
	Providers(Query) ([]Provider, int, error)
	Provider(uint64) (*Provider, error)
	InsertProvider(*Provider) error
	SaveProvider(*Provider) error
	DeleteProvider(uint64) error
	SetSecret(uint64, string) error
	Secret(uint64) (string, error)
	Settings() (*SettingsRow, error)
	SaveSettings(*SettingsRow) error
	ProviderReferenced(uint64) (bool, error)
	RecordDiagnostic(uint64, string, StoredDiagnostic) error
}

// StoredDiagnostic retains one bounded observation per capability.
type StoredDiagnostic struct {
	Snapshot   ProbeSnapshot `json:"config_snapshot"`
	Diagnostic Diagnostic    `json:"diagnostic"`
}
