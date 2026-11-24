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

var errInvalidPath = errors.New("资源路径应为 code、platform/code、team:team-code/code 或 project:project-code/code")

func Parse(path string) (Locator, error) {
	scope, code, scoped := strings.Cut(strings.TrimPrefix(path, "/"), "/")
	if !scoped && Valid(scope) {
		return Locator{Code: scope}, nil
	}
	if !Valid(code) {
		return Locator{}, errInvalidPath
	}
	if scope == "platform" {
		return Locator{ScopeKind: scope, Code: code}, nil
	}
	kind, owner, _ := strings.Cut(scope, ":")
	if (kind == "project" || kind == "team") && Valid(owner) {
		return Locator{ScopeKind: kind, ScopeCode: owner, Code: code}, nil
	}
	return Locator{}, errInvalidPath
}

func (l Locator) String() string {
	if l.ScopeKind == "" {
		return l.Code
	}
	if l.ScopeKind == "platform" {
		return "platform/" + l.Code
	}
	return l.ScopeKind + ":" + l.ScopeCode + "/" + l.Code
}
