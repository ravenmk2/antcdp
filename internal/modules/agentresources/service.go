// Package agentresources manages the administrator-owned tool and skill library.
package agentresources

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	mcpruntime "github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Field[T any] = models.Field[T]
type Pagination = models.Pagination
type Result struct {
	Data          any
	Tag, Location string
	Status        int
	Replayed      bool
	Pagination    *Pagination
	Auth          *identity.Auth `json:"-"`
	// Internal receipt metadata never enters a response.
	TargetKind  string
	TargetID    uint64
	OperationID *uint64
}
type MCPClient interface {
	Discover(context.Context) (mcpruntime.Discovery, error)
	Call(context.Context, mcpruntime.CallRequest) (mcpruntime.CallResult, error)
}
type MCPSession interface {
	MCPClient
	Close() error
}
type Service struct {
	Identity             *identity.Service
	Store                func() (identity.Store, error)
	Cipher               func(purpose, value string, seal bool) (string, error)
	ETag                 func(string) string
	Files                *agents.ByteStore
	Epoch                string
	skillReleaseMu       sync.Mutex
	pendingSkillReleases map[uint64]struct{}
	MCPFactory           func(context.Context, mcpruntime.Config) (MCPClient, error)
	MCPOpen              func(context.Context, mcpruntime.Config) (MCPSession, error)
	debugMu              sync.Mutex
	debugSessions        map[string]*mcpDebugSession
}
type Query struct {
	Page, PageSize  int
	Q, Availability string
	Enabled         *bool
}
type metadataKey struct{}

func WithMetadata(ctx context.Context, meta identity.Metadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, meta)
}
func (s *Service) access(ctx context.Context, raw string, fn func(identity.Tx, *identity.Auth, *Result) error) (*Result, error) {
	if s.Identity == nil || s.ETag == nil {
		return nil, unavailable()
	}
	out := &Result{Status: 200}
	a, e := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return httpx.E(403, "FORBIDDEN", "需要管理员权限")
		}
		*out = Result{Status: 200}
		return fn(tx, a, out)
	})
	out.Auth = a
	return out, e
}
func (s *Service) background(ctx context.Context, fn func(identity.Tx) error) error {
	if s.Store == nil || s.ETag == nil {
		return unavailable()
	}
	store, e := s.Store()
	if e != nil {
		return e
	}
	return store.Transact(ctx, fn)
}

type savedResult struct {
	Data     json.RawMessage `json:"data"`
	Tag      string          `json:"tag"`
	Location string          `json:"location"`
}

func splitScope(scope string) (string, string) {
	kind, id, ok := strings.Cut(scope, ":")
	if !ok {
		return kind, "0"
	}
	return kind, id
}
func (s *Service) requestHash(input any) ([]byte, error) {
	b, e := json.Marshal(input)
	if e != nil {
		return nil, e
	}
	h := sha256.Sum256([]byte(s.ETag("agentresources/request/" + string(b))))
	return h[:], nil
}
func (s *Service) command(ctx context.Context, raw, key, command, scope string, input any, fn func(identity.Tx, *identity.Auth, *Result, uint64) error) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) {
			return httpx.Invalid("Idempotency-Key", "invalid_format")
		}
		repo, e := agents.RepositoryFor(tx)
		if e != nil {
			return e
		}
		hash, e := s.requestHash(input)
		if e != nil {
			return e
		}
		kind, id := splitScope(scope)
		old, e := repo.Receipt(strconv.FormatUint(a.User.ID, 10), kind, id, command, key)
		if e != nil {
			return e
		}
		if old != nil {
			if !hmac.Equal(old.Hash, hash) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
			}
			var saved savedResult
			if json.Unmarshal(old.Result, &saved) != nil {
				return integrity()
			}
			out.Data = saved.Data
			out.Status = old.ResponseStatus
			out.Tag = saved.Tag
			out.Location = saved.Location
			out.Replayed = true
			return nil
		}
		rec := &agents.Receipt{ActorKind: "user", ActorID: strconv.FormatUint(a.User.ID, 10), ScopeKind: kind, ScopeID: id, Command: command, Key: key, Hash: hash, Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: time.Now().UTC().Truncate(time.Millisecond)}
		if e = repo.InsertReceipt(rec); e != nil {
			return e
		}
		if e = fn(tx, a, out, rec.ID); e != nil {
			return e
		}
		if out.TargetKind == "" {
			out.TargetKind = kind
			out.TargetID, _ = strconv.ParseUint(id, 10, 64)
		}
		if out.TargetID != 0 {
			rec.TargetKind = &out.TargetKind
			rec.TargetID = &out.TargetID
		}
		rec.OperationID = out.OperationID
		b, e := json.Marshal(out.Data)
		if e != nil {
			return e
		}
		rec.Result, e = json.Marshal(savedResult{b, out.Tag, out.Location})
		if e != nil {
			return e
		}
		rec.Status = "completed"
		rec.ResponseStatus = out.Status
		now := time.Now().UTC()
		rec.CompletedAt = &now
		if e = repo.SaveReceipt(rec); e != nil {
			return e
		}
		return audit(ctx, tx, a, command, out.TargetKind, out.TargetID)
	})
}
func audit(ctx context.Context, tx identity.Tx, a *identity.Auth, action, kind string, id uint64) error {
	meta, _ := ctx.Value(metadataKey{}).(identity.Metadata)
	target := strconv.FormatUint(id, 10)
	v := identity.Event{ActorID: &a.User.ID, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &a.User.Username, Action: action, TargetType: kind, TargetID: &target, OccurredAt: time.Now().UTC(), Detail: json.RawMessage(`{}`)}
	if meta.RequestID != "" {
		v.RequestID = &meta.RequestID
	}
	if meta.IP != "" {
		v.IP = &meta.IP
	}
	return tx.Audit(v)
}

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{16,128}$`)
var codePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var tagPattern = regexp.MustCompile(`^"[a-f0-9]{64}"$`)

func missing() error     { return httpx.E(404, "NOT_FOUND", "智能体资源不存在") }
func integrity() error   { return httpx.E(500, "DATA_INTEGRITY_ERROR", "智能体资源完整性异常") }
func unavailable() error { return httpx.E(503, "SERVICE_UNAVAILABLE", "智能体资源暂不可用") }
func inUse() error       { return httpx.E(409, "RESOURCE_IN_USE", "资源仍有活动引用") }
func (s *Service) tag(kind string, id, version uint64) string {
	return `"` + s.ETag(fmt.Sprintf("agentresources/%s/%d/%d", kind, id, version)) + `"`
}
func checkTag(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前配置")
	}
	if !tagPattern.MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return httpx.E(412, "VERSION_CONFLICT", "资源已变化，请重新加载")
	}
	return nil
}
func names(name, description string) error {
	if strings.TrimSpace(name) == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 100 {
		return httpx.Invalid("name", "invalid_length")
	}
	if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 1000 {
		return httpx.Invalid("description", "invalid_length")
	}
	return nil
}
func validID(value string) (uint64, error) {
	id, e := strconv.ParseUint(value, 10, 64)
	if e != nil || id == 0 || strconv.FormatUint(id, 10) != value {
		return 0, httpx.Invalid("id", "invalid_format")
	}
	return id, nil
}
func validateQuery(q *Query) error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 {
		return httpx.Invalid("page", "invalid_range")
	}
	q.Q = strings.TrimSpace(q.Q)
	if utf8.RuneCountInString(q.Q) > 64 {
		return httpx.Invalid("q", "invalid_length")
	}
	return nil
}
func same(a, b any) bool {
	x, e := json.Marshal(a)
	if e != nil {
		return false
	}
	y, e := json.Marshal(b)
	return e == nil && string(x) == string(y)
}
