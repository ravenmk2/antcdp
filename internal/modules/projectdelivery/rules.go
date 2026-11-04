// Package projectdelivery owns project variants, environments and branch intent.
package projectdelivery

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Rule struct {
	Mode    string `json:"mode"`
	Pattern string `json:"pattern"`
}
type BranchRule struct {
	Type    string `json:"branch_type"`
	Enabled bool   `json:"enabled"`
	Rule    *Rule  `json:"rule"`
}
type BranchType struct {
	Type             string `json:"branch_type"`
	Label            string `json:"label"`
	Description      string `json:"description"`
	AllowEnvironment bool   `json:"allow_environment"`
}

var Types = []BranchType{
	{"mainline", "主线", "标准版主要维护分支", true}, {"development", "开发", "持续承接日常开发", true},
	{"integration", "集成", "汇集多个开发来源并联调", true}, {"release", "发布", "准备或维护具体发布", true},
	{"feature", "功能", "实现具体功能", false}, {"hotfix", "修复", "问题修复", false}, {"custom", "定制", "定制变体主要维护分支", true},
}

func Defaults() []BranchRule {
	out := make([]BranchRule, 0, 7)
	for _, t := range Types {
		r := Rule{"glob", t.Type + "/**"}
		if t.Type == "mainline" {
			r = Rule{"exact", "main"}
		}
		if t.Type == "development" {
			r = Rule{"exact", "develop"}
		}
		out = append(out, BranchRule{t.Type, t.Type == "mainline", &r})
	}
	return out
}
func ValidBranch(s string) bool {
	if !utf8.ValidString(s) || len(s) == 0 || len(s) > 1024 || s == "HEAD" || s == "@" || strings.HasPrefix(s, "-") || strings.HasPrefix(s, "refs/heads/") || strings.HasSuffix(s, ".") || strings.Contains(s, "..") || strings.Contains(s, "@{") {
		return false
	}
	for _, r := range s {
		if r <= 32 || r == 127 || strings.ContainsRune("~^:?*[\\", r) {
			return false
		}
	}
	for p := range strings.SplitSeq(s, "/") {
		if p == "" || strings.HasPrefix(p, ".") || strings.HasSuffix(p, ".lock") {
			return false
		}
	}
	return true
}
func Compile(r Rule, branch bool) (*regexp.Regexp, error) {
	if !utf8.ValidString(r.Pattern) || len(r.Pattern) == 0 || len(r.Pattern) > 1024 {
		return nil, httpx.Invalid("rule", "rule_invalid")
	}
	p := r.Pattern
	switch r.Mode {
	case "exact":
		if branch && !ValidBranch(p) {
			return nil, httpx.Invalid("rule", "branch_name_invalid")
		}
		p = regexp.QuoteMeta(p)
	case "glob":
		if strings.Contains(p, "***") {
			return nil, httpx.Invalid("rule", "rule_invalid")
		}
		var b strings.Builder
		for n := 0; n < len(p); {
			switch p[n] {
			case '*':
				if n+1 < len(p) && p[n+1] == '*' {
					b.WriteString("(?s:.*)")
					n += 2
				} else {
					b.WriteString("[^/]*")
					n++
				}
			case '?':
				b.WriteString("[^/]")
				n++
			default:
				r, size := utf8.DecodeRuneInString(p[n:])
				b.WriteString(regexp.QuoteMeta(string(r)))
				n += size
			}
		}
		p = b.String()
	case "regex":
	default:
		return nil, httpx.Invalid("rule", "rule_invalid")
	}
	compiled, e := regexp.Compile(`\A(?:` + p + `)\z`)
	if e != nil {
		return nil, httpx.Invalid("rule", "rule_invalid")
	}
	return compiled, nil
}
func ValidateRules(rules []BranchRule) error {
	if len(rules) != len(Types) {
		return httpx.Invalid("rules", "seven_types_required")
	}
	seen := map[string]bool{}
	enabled := 0
	for _, r := range rules {
		if seen[r.Type] || !slices.ContainsFunc(Types, func(t BranchType) bool { return t.Type == r.Type }) {
			return httpx.Invalid("rules", "invalid_type")
		}
		seen[r.Type] = true
		if r.Enabled {
			enabled++
		}
		if r.Rule == nil {
			if r.Enabled {
				return httpx.Invalid("rules", "rule_required")
			}
		} else if _, e := Compile(*r.Rule, true); e != nil {
			return e
		}
	}
	if enabled == 0 {
		return httpx.Invalid("rules", "enabled_required")
	}
	return nil
}

type Classification struct {
	Name         string   `json:"name"`
	GitValid     bool     `json:"git_valid"`
	MatchedTypes []string `json:"matched_types"`
	Validity     string   `json:"binding_validity"`
	Reason       string   `json:"reason"`
}

func Classify(rules []BranchRule, name, typ string, environment bool) Classification {
	c := Classification{Name: name, GitValid: ValidBranch(name), MatchedTypes: []string{}, Validity: "invalid"}
	if !c.GitValid {
		c.Reason = "branch_name_invalid"
		return c
	}
	for _, r := range rules {
		if r.Enabled && r.Rule != nil {
			p, e := Compile(*r.Rule, true)
			if e == nil && p.MatchString(name) {
				c.MatchedTypes = append(c.MatchedTypes, r.Type)
			}
		}
	}
	switch {
	case len(c.MatchedTypes) == 0:
		c.Reason = "branch_unclassified"
	case len(c.MatchedTypes) > 1:
		c.Reason = "branch_ambiguous"
	case typ != "" && c.MatchedTypes[0] != typ:
		c.Reason = "branch_type_mismatch"
	case environment && !slices.ContainsFunc(Types, func(t BranchType) bool { return t.Type == c.MatchedTypes[0] && t.AllowEnvironment }):
		c.Reason = "environment_branch_type_forbidden"
	default:
		c.Validity = "valid"
	}
	return c
}
func binding(rules []BranchRule, name, typ string, env bool) error {
	c := Classify(rules, name, typ, env)
	if c.Validity != "valid" {
		return httpx.Invalid("branch_name", c.Reason)
	}
	return nil
}
func digest(v any) string {
	b, _ := json.Marshal(v)
	var normalized any
	decoder := json.NewDecoder(strings.NewReader(string(b)))
	decoder.UseNumber()
	if decoder.Decode(&normalized) == nil {
		b, _ = json.Marshal(normalized)
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func tag(kind string, id, version uint64) string { return fmt.Sprintf(`"%s-%d-%d"`, kind, id, version) }
func match(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if got != want {
		return httpx.E(412, "VERSION_CONFLICT", "内容已变化，请重新加载")
	}
	return nil
}
