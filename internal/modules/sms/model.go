// Package sms owns SMS provider profiles, templates and delivery tests.
package sms

import (
	"context"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type Config struct {
	Provider string `json:"provider"`
}
type Authentication struct {
	AccessKeyID     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
}
type Profile struct {
	ID          uint64    `json:"id,string"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	Config      Config    `json:"config"`
	AccessKeyID string    `json:"access_key_id"`
	HasSecret   bool      `json:"has_secret"`
	RowVersion  uint64    `json:"-"`
	Version     string    `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Latest      *SendLog  `json:"latest,omitempty"`
}
type ProfileWrite struct {
	Code           string          `json:"code"`
	Name           *string         `json:"name"`
	Description    *string         `json:"description"`
	Enabled        *bool           `json:"enabled"`
	Config         *Config         `json:"config"`
	Authentication *Authentication `json:"authentication"`
}
type Parameter struct {
	Type        string  `json:"type"`
	Description string  `json:"description,omitempty"`
	Required    bool    `json:"required"`
	Default     *string `json:"default,omitempty"`
}
type Simulation struct {
	TestID          string    `json:"test_id"`
	Status          string    `json:"status"`
	StartedAt       time.Time `json:"started_at"`
	TemplateVersion uint64    `json:"template_version"`
	Outdated        bool      `json:"outdated"`
}
type Template struct {
	Mode           string               `json:"mode"`
	ProfileID      uint64               `json:"profile_id,string"`
	SignName       string               `json:"sign_name"`
	RemoteID       string               `json:"remote_template_id"`
	Mapping        map[string]string    `json:"provider_parameters"`
	LastSimulation *Simulation          `json:"last_simulation,omitempty"`
	ID             uint64               `json:"id,string"`
	Code           string               `json:"code"`
	Name           string               `json:"name"`
	Description    string               `json:"description"`
	Enabled        bool                 `json:"enabled"`
	EngineID       string               `json:"engine_id"`
	EngineVersion  int                  `json:"engine_version"`
	Body           string               `json:"body_template"`
	Parameters     map[string]Parameter `json:"parameter_schema"`
	Sample         map[string]any       `json:"sample_data"`
	RowVersion     uint64               `json:"-"`
	Version        string               `json:"version"`
	CreatedAt      time.Time            `json:"created_at"`
	UpdatedAt      time.Time            `json:"updated_at"`
	Latest         *SendLog             `json:"latest,omitempty"`
}
type SendLog struct {
	ID                uint64     `json:"id,string"`
	TestID            string     `json:"test_id"`
	ProfileID         uint64     `json:"profile_id,string"`
	TemplateID        uint64     `json:"template_id,string"`
	ActorID           uint64     `json:"actor_user_id,string"`
	ActorName         string     `json:"actor_name"`
	ProfileName       string     `json:"profile_name"`
	TemplateName      string     `json:"template_name"`
	ProfileVersion    uint64     `json:"profile_version"`
	TemplateVersion   uint64     `json:"template_version"`
	RecipientMask     string     `json:"recipient_mask"`
	Status            string     `json:"status"`
	Stage             string     `json:"stage"`
	Reason            string     `json:"reason_code"`
	ProviderRequestID string     `json:"provider_request_id,omitempty"`
	ProviderMessageID string     `json:"provider_message_id,omitempty"`
	StartedAt         time.Time  `json:"started_at"`
	FinishedAt        *time.Time `json:"finished_at"`
	Outdated          bool       `json:"outdated"`
}
type Filter struct {
	Page, PageSize                 int
	Query, Status                  string
	ProfileID, TemplateID, ActorID uint64
	From, To                       *time.Time
}
type Page struct {
	Items    any `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}
type Result struct {
	Data any
	Tag  string
}
type TemplateInput struct {
	ID         uint64         `json:"id,string"`
	Version    string         `json:"version"`
	Parameters map[string]any `json:"parameters"`
}
type Content struct {
	Body       string            `json:"body,omitempty"`
	SignName   string            `json:"sign_name,omitempty"`
	RemoteID   string            `json:"remote_template_id,omitempty"`
	Parameters map[string]string `json:"provider_parameters,omitempty"`
}
type TestInput struct {
	Recipient string         `json:"recipient"`
	Template  *TemplateInput `json:"template"`
}
type PreviewInput struct {
	Draft    *Template      `json:"draft"`
	Template *TemplateInput `json:"template"`
}

type Repository interface {
	Profiles(Filter) ([]Profile, int, error)
	Profile(uint64) (*Profile, error)
	SaveProfile(*Profile, bool) error
	DeleteProfile(uint64) error
	Secret(uint64) (string, error)
	SetSecret(uint64, string) error
	Templates(Filter) ([]Template, int, error)
	Template(uint64) (*Template, error)
	SaveTemplate(*Template, bool) error
	SaveSimulation(uint64, *Simulation) error
	TemplateCount(uint64) (int, error)
	DeleteTemplate(uint64) error
	InsertLog(*SendLog) error
	FinishLog(*SendLog) error
	Logs(Filter) ([]SendLog, int, error)
	Log(uint64) (*SendLog, error)
	Busy(uint64, uint64) (bool, error)
	Prune(time.Time) error
}
type Service struct {
	simulationMu      sync.Mutex
	recentSimulations map[string][]time.Time
	Identity          *identity.Service
	Store             func() (identity.Store, error)
	Cipher            func(string, string, bool) (string, error)
	ETag              func(string) string
	// Send is injectable only by Go callers for protocol tests, never through configuration.
	Send func(context.Context, Profile, Authentication, string, Content) SendLog
}
