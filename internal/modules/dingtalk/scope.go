package dingtalk

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type scopeKey struct{}
type scope struct {
	Kind string
	ID   uint64
}

// WithProject selects a server-authorized route scope, never a request body field.
func WithProject(ctx context.Context, id uint64) context.Context {
	return context.WithValue(ctx, scopeKey{}, scope{Kind: "project", ID: id})
}
func scopeFrom(ctx context.Context) scope {
	if s, ok := ctx.Value(scopeKey{}).(scope); ok {
		return s
	}
	return scope{Kind: "platform"}
}
func inScope(ctx context.Context, r *Robot) bool {
	s := scopeFrom(ctx)
	return r.ScopeKind == s.Kind && r.ScopeID == s.ID
}

// SendMessage is the credential-owning host's transport boundary. It does not
// perform authorization or persist intent: callers must complete both first.
func SendMessage(ctx context.Context, auth Authentication, input TestInput) Diagnostic {
	return sendRobot(ctx, auth, input)
}

func ValidateMessage(w TestInput) error {
	if w.Format != "text" && w.Format != "markdown" || strings.TrimSpace(w.Body) == "" || len(w.Body) > 16<<10 || utf8.RuneCountInString(w.Title) > 100 || w.Format == "markdown" && strings.TrimSpace(w.Title) == "" {
		return httpx.Invalid("body", "invalid_message")
	}
	return nil
}
