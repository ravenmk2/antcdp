// Package dingtalk manages signed custom group robots independently of email and SMS.
package dingtalk

import (
	"context"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type Robot struct {
	ID          uint64      `json:"id,string"`
	Code        string      `json:"code"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Enabled     bool        `json:"enabled"`
	Keyword     string      `json:"keyword"`
	HasSecret   bool        `json:"has_secret"`
	RowVersion  uint64      `json:"-"`
	Version     string      `json:"version"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
	Latest      *Diagnostic `json:"latest"`
}
type Authentication struct {
	Token  string `json:"access_token"`
	Secret string `json:"secret"`
}
type Write struct {
	Code           string          `json:"code"`
	Name           *string         `json:"name"`
	Description    *string         `json:"description"`
	Enabled        *bool           `json:"enabled"`
	Keyword        *string         `json:"keyword"`
	Authentication *Authentication `json:"authentication"`
}
type Diagnostic struct {
	TestID     string     `json:"test_id"`
	Status     string     `json:"status"`
	Stage      string     `json:"stage"`
	Reason     string     `json:"reason_code"`
	Version    uint64     `json:"robot_version"`
	ActorID    uint64     `json:"actor_user_id,string"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	Outdated   bool       `json:"outdated"`
}
type TestInput struct {
	Format string `json:"format"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}
type Filter struct {
	Page, PageSize int
	Query, Status  string
}
type Page struct {
	Items    []Robot `json:"items"`
	Total    int     `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"page_size"`
}
type Result struct {
	Data any
	Tag  string
}
type Repository interface {
	List(Filter) ([]Robot, int, error)
	Robot(uint64) (*Robot, error)
	Save(*Robot, bool) error
	Delete(uint64) error
	Secret(uint64) (string, error)
	SetSecret(uint64, string) error
	SaveDiagnostic(uint64, *Diagnostic, bool) error
	Recover(time.Time) error
}
type Service struct {
	Identity *identity.Service
	Store    func() (identity.Store, error)
	Cipher   func(string, string, bool) (string, error)
	ETag     func(string) string
	Send     func(context.Context, Authentication, string, TestInput) Diagnostic
	mu       sync.Mutex
	recent   map[string][]time.Time
}
