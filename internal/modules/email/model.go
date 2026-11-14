// Package email owns SMTP profiles, email templates and email delivery tests.
package email

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type Config struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	TLSMode     string `json:"tls_mode"`
	FromAddress string `json:"from_address"`
	CustomCA    string `json:"custom_ca_pem,omitempty"`
}
type SenderName struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Default bool   `json:"default"`
}
type Authentication struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
type Profile struct {
	ID          uint64       `json:"id,string"`
	Code        string       `json:"code"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Enabled     bool         `json:"enabled"`
	Config      Config       `json:"config"`
	Username    string       `json:"username"`
	HasSecret   bool         `json:"has_secret"`
	SenderNames []SenderName `json:"sender_names"`
	RowVersion  uint64       `json:"-"`
	Version     string       `json:"version"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Latest      *SendLog     `json:"latest,omitempty"`
}
type ProfileWrite struct {
	Code           string          `json:"code"`
	Name           *string         `json:"name"`
	Description    *string         `json:"description"`
	Enabled        *bool           `json:"enabled"`
	Config         *Config         `json:"config"`
	SenderNames    *[]SenderName   `json:"sender_names"`
	Authentication *Authentication `json:"authentication"`
}
type Parameter struct {
	Type        string               `json:"type"`
	Description string               `json:"description,omitempty"`
	Required    bool                 `json:"required"`
	Default     any                  `json:"default,omitempty"`
	Properties  map[string]Parameter `json:"properties,omitempty"`
	Items       *Parameter           `json:"items,omitempty"`
}
type Template struct {
	ID            uint64               `json:"id,string"`
	Code          string               `json:"code"`
	Name          string               `json:"name"`
	Description   string               `json:"description"`
	Enabled       bool                 `json:"enabled"`
	EngineID      string               `json:"engine_id"`
	EngineVersion int                  `json:"engine_version"`
	Subject       string               `json:"subject_template"`
	BodyFormat    string               `json:"body_format"`
	Body          string               `json:"body_template"`
	TextBody      string               `json:"text_body_template"`
	Parameters    map[string]Parameter `json:"parameter_schema"`
	Sample        map[string]any       `json:"sample_data"`
	RowVersion    uint64               `json:"-"`
	Version       string               `json:"version"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
	Latest        *SendLog             `json:"latest,omitempty"`
}
type SendLog struct {
	ID              uint64     `json:"id,string"`
	TestID          string     `json:"test_id"`
	ProfileID       uint64     `json:"profile_id,string"`
	TemplateID      uint64     `json:"template_id,string"`
	ActorID         uint64     `json:"actor_user_id,string"`
	ActorName       string     `json:"actor_name"`
	ProfileName     string     `json:"profile_name"`
	TemplateName    string     `json:"template_name"`
	ProfileVersion  uint64     `json:"profile_version"`
	TemplateVersion uint64     `json:"template_version"`
	SenderNameID    string     `json:"sender_name_id"`
	RecipientMask   string     `json:"recipient_mask"`
	Status          string     `json:"status"`
	Stage           string     `json:"stage"`
	Reason          string     `json:"reason_code"`
	ResponseCode    string     `json:"response_code,omitempty"`
	MessageID       string     `json:"message_id,omitempty"`
	AttachmentCount int        `json:"attachment_count"`
	AttachmentBytes int        `json:"attachment_bytes"`
	StartedAt       time.Time  `json:"started_at"`
	FinishedAt      *time.Time `json:"finished_at"`
	Outdated        bool       `json:"outdated"`
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
	Subject    string `json:"subject"`
	BodyFormat string `json:"body_format"`
	Body       string `json:"body"`
	TextBody   string `json:"text_body,omitempty"`
}
type Attachment struct {
	Name string
	Data []byte
}
type TestInput struct {
	Recipient    string         `json:"recipient"`
	SenderNameID string         `json:"sender_name_id"`
	Template     *TemplateInput `json:"template"`
	Content      *Content       `json:"content"`
	Attachments  []Attachment   `json:"-"`
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
	DeleteTemplate(uint64) error
	InsertLog(*SendLog) error
	FinishLog(*SendLog) error
	Logs(Filter) ([]SendLog, int, error)
	Log(uint64) (*SendLog, error)
	Busy(uint64, uint64) (bool, error)
	Prune(time.Time) error
}
type Service struct {
	Identity *identity.Service
	Store    func() (identity.Store, error)
	Cipher   func(string, string, bool) (string, error)
	ETag     func(string) string
	// Send is injectable only by Go callers for protocol tests, never through configuration.
	Send func(context.Context, Profile, Authentication, string, string, Content, []Attachment) SendLog
}

func cloneJSON[T any](v T) T {
	b, _ := json.Marshal(v)
	var out T
	_ = json.Unmarshal(b, &out)
	return out
}
