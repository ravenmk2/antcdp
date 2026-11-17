package resourcecode

import (
	"errors"
	"strings"
)

// Locator identifies a resource without conveying permission to use it.
// An empty ScopeKind denotes the caller's current scope.
type Locator struct {
	ScopeKind string `json:"scopeKind"`
	ScopeCode string `json:"scopeCode"`
	Code      string `json:"code"`
}

func Parse(path string) (Locator, error) {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	invalid := errors.New("资源路径应为 code、platform/code、team/team-code/code 或 project/project-code/code")
	for _, part := range parts {
		if !Valid(part) {
			return Locator{}, invalid
		}
	}
	switch {
	case len(parts) == 1:
		return Locator{Code: parts[0]}, nil
	case len(parts) == 2 && parts[0] == "platform":
		return Locator{ScopeKind: "platform", Code: parts[1]}, nil
	case len(parts) == 3 && (parts[0] == "team" || parts[0] == "project"):
		return Locator{ScopeKind: parts[0], ScopeCode: parts[1], Code: parts[2]}, nil
	default:
		return Locator{}, invalid
	}
}

func (l Locator) String() string {
	if l.ScopeKind == "" {
		return l.Code
	}
	if l.ScopeKind == "platform" {
		return "platform/" + l.Code
	}
	return l.ScopeKind + "/" + l.ScopeCode + "/" + l.Code
}
