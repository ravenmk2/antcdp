// Package webaccess provides bounded Search/Fetch routing without agent,
// authentication, transport or persistence dependencies.
package webaccess

import (
	"context"
	"errors"
	"time"
)

type Operation string

const (
	Search Operation = "search"
	Fetch  Operation = "fetch"
)

// Failure contains only stable diagnostics, never URLs, credentials or bodies.
// An unconfirmed remote outcome cannot silently trigger another paid request.
type Failure struct {
	Code     string
	Unknown  bool
	Fallback bool
}

func (e *Failure) Error() string { return e.Code }

func Fail(code string) error { return &Failure{Code: code} }

func CanFallback(err error) bool {
	var failure *Failure
	return errors.As(err, &failure) && failure.Fallback && !failure.Unknown
}

type RouteRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type SearchSettings struct {
	Routes     []RouteRef `json:"routes"`
	MaxResults int        `json:"max_results"`
}

type FetchSettings struct {
	Routes               []RouteRef `json:"routes"`
	MaxBytes             int64      `json:"max_bytes"`
	TimeoutSeconds       int        `json:"timeout_seconds"`
	MaxRedirects         int        `json:"max_redirects"`
	AllowedInternalHosts []string   `json:"allowed_internal_hosts"`
}

type Settings struct {
	Search SearchSettings `json:"search"`
	Fetch  FetchSettings  `json:"fetch"`
}

// Permit is constructed by a trusted caller after its own authorization. It
// is not an HTTP DTO and cannot be supplied by an end user or language model.
type Permit struct {
	Deadline time.Time
	MaxCalls int
	Caller   string
}

type SearchRequest struct {
	Query      string
	MaxResults int
}

type FetchRequest struct {
	URL                  string
	MaxBytes             int64
	MaxRedirects         int
	AllowedInternalHosts []string
}

type SearchEntry struct {
	Title       string  `json:"title"`
	URL         string  `json:"url"`
	Summary     string  `json:"summary"`
	PublishedAt *string `json:"published_at"`
	Truncated   bool    `json:"truncated"`
}

type Attempt struct {
	Route   RouteRef `json:"route"`
	Status  string   `json:"status"`
	Reason  *string  `json:"reason"`
	Outcome string   `json:"outcome"`
}

type SearchResult struct {
	Results   []SearchEntry `json:"results"`
	Route     RouteRef      `json:"route"`
	Truncated bool          `json:"truncated"`
	Attempts  []Attempt     `json:"attempts"`
}

type FetchResult struct {
	RequestedURL string    `json:"requested_url"`
	FinalURL     *string   `json:"final_url"`
	Title        string    `json:"title"`
	Content      string    `json:"content"`
	MediaType    string    `json:"media_type"`
	Truncated    bool      `json:"truncated"`
	Route        RouteRef  `json:"route"`
	Attempts     []Attempt `json:"attempts"`
}

type Adapter interface {
	Search(context.Context, SearchRequest) (SearchResult, error)
	Fetch(context.Context, FetchRequest) (FetchResult, error)
}

// Source resolves current configuration and credentials for every individual
// attempt. No caller can cache a permanent authorization or secret via Router.
type Source interface {
	RuntimeSettings(context.Context) (Settings, error)
	Resolve(context.Context, RouteRef, Operation) (Adapter, error)
}
