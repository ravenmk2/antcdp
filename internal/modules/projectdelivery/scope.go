package projectdelivery

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type ScopeRule struct {
	ConnectionID *string `json:"connection_id"`
	Mode         string  `json:"mode"`
	Pattern      string  `json:"pattern"`
}
type Scope struct {
	Mode  string      `json:"mode"`
	IDs   []string    `json:"repository_ids"`
	Rules []ScopeRule `json:"rules"`
}

func DefaultScope(env bool) Scope {
	mode := "all"
	if env {
		mode = "inherit"
	}
	return Scope{mode, []string{}, []ScopeRule{}}
}
func ValidateScope(s Scope, env bool, repos []i.ProjectRepo, old Scope) error {
	b, _ := json.Marshal(s)
	if len(b) > 24<<10 || len(s.IDs) > 500 || len(s.Rules) > 20 {
		return httpx.Invalid("repository_scope", "too_large")
	}
	if s.Mode != "custom" {
		if s.Mode != DefaultScope(env).Mode || len(s.IDs) > 0 || len(s.Rules) > 0 {
			return httpx.Invalid("repository_scope", "invalid_mode")
		}
		return nil
	}
	ids := map[string]bool{}
	connections := map[string]bool{}
	for _, r := range repos {
		ids[fmt.Sprint(r.ID)] = true
		connections[fmt.Sprint(r.ConnectionID)] = true
	}
	seen := map[string]bool{}
	for _, id := range s.IDs {
		if _, e := c.ID(id); e != nil {
			return e
		}
		if seen[id] || !ids[id] {
			return httpx.Invalid("repository_scope.repository_ids", "repository_out_of_scope")
		}
		seen[id] = true
	}
	seen = map[string]bool{}
	for _, r := range s.Rules {
		key := digest(r)
		if seen[key] {
			return httpx.Invalid("repository_scope.rules", "duplicate")
		}
		seen[key] = true
		if r.Mode != "glob" && r.Mode != "regex" {
			return httpx.Invalid("repository_scope.rules", "invalid_mode")
		}
		if _, e := Compile(Rule{r.Mode, r.Pattern}, false); e != nil {
			return e
		}
		if r.ConnectionID != nil {
			if _, e := c.ID(*r.ConnectionID); e != nil {
				return e
			}
			if !connections[*r.ConnectionID] && !slices.ContainsFunc(old.Rules, func(o ScopeRule) bool { return digest(o) == key }) {
				return httpx.Invalid("repository_scope.rules", "connection_out_of_scope")
			}
		}
	}
	return nil
}

type ScopedRepo struct {
	i.ProjectRepo
	Sources []string `json:"match_sources"`
	Check   *Check   `json:"check"`
}

func Evaluate(s Scope, repos []i.ProjectRepo) []ScopedRepo {
	out := []ScopedRepo{}
	patterns := make([]*regexp.Regexp, len(s.Rules))
	for n, rule := range s.Rules {
		patterns[n], _ = Compile(Rule{rule.Mode, rule.Pattern}, false)
	}
	manual := map[string]bool{}
	for _, id := range s.IDs {
		manual[id] = true
	}
	for _, r := range repos {
		sources := []string{}
		if s.Mode == "all" || s.Mode == "inherit" {
			sources = append(sources, s.Mode)
		} else {
			if manual[fmt.Sprint(r.ID)] {
				sources = append(sources, "manual")
			}
			for n, rule := range s.Rules {
				if rule.ConnectionID != nil && *rule.ConnectionID != fmt.Sprint(r.ConnectionID) {
					continue
				}
				p := patterns[n]
				if p != nil && p.MatchString(r.FullPath) {
					sources = append(sources, "rule:"+strconv.Itoa(n))
				}
			}
		}
		if len(sources) > 0 {
			out = append(out, ScopedRepo{ProjectRepo: r, Sources: sources})
		}
	}
	slices.SortFunc(out, func(a, b ScopedRepo) int {
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	return out
}
func plain(rows []ScopedRepo) []i.ProjectRepo {
	out := make([]i.ProjectRepo, len(rows))
	for n, r := range rows {
		out[n] = r.ProjectRepo
	}
	return out
}
