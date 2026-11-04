package projectdelivery

import (
	"encoding/json"
	"fmt"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Impact struct {
	Kind   string `json:"subject_kind"`
	ID     string `json:"subject_id"`
	Name   string `json:"name"`
	Branch string `json:"branch_name"`
	Reason string `json:"reason"`
}

func (x *access) modelCommand(cmd Command, out *i.Result) error {
	if e := match(cmd.Tag, x.model.ETag); e != nil {
		return e
	}
	if e := ValidateRules(cmd.Model.Rules); e != nil {
		return e
	}
	if len(cmd.Model.Samples) > 50 {
		return httpx.Invalid("sample_names", "too_many")
	}
	if e := x.guard(0, 0); e != nil {
		return e
	}
	variants, _, e := x.r.Variants(cmd.ProjectID, Query{Status: "all"})
	if e != nil {
		return e
	}
	envs, e := x.r.Environments(cmd.ProjectID, 0)
	if e != nil {
		return e
	}
	refs := map[string]bool{}
	impacts := []Impact{}
	for _, v := range variants {
		refs[v.Type()] = true
		c := Classify(cmd.Model.Rules, v.Branch, v.Type(), false)
		if c.Validity != "valid" {
			impacts = append(impacts, Impact{"variant", fmt.Sprint(v.ID), v.Name, v.Branch, c.Reason})
		}
	}
	for _, v := range envs {
		refs[v.BranchType] = true
		c := Classify(cmd.Model.Rules, v.Branch, v.BranchType, true)
		if c.Validity != "valid" {
			impacts = append(impacts, Impact{"environment", fmt.Sprint(v.ID), v.Name, v.Branch, c.Reason})
		}
	}
	for _, r := range cmd.Model.Rules {
		if !r.Enabled && refs[r.Type] {
			return httpx.E(409, "BRANCH_TYPE_REFERENCED", "仍有产品分支或环境引用该类型（含归档对象）")
		}
	}
	// Canonical ordering prevents request order from changing a confirmation token.
	ordered := make([]BranchRule, 0, 7)
	for _, t := range Types {
		for _, r := range cmd.Model.Rules {
			if t.Type == r.Type {
				ordered = append(ordered, r)
			}
		}
	}
	cmd.Model.Rules = ordered
	versions := []uint64{x.model.Version, x.model.VariantsVersion}
	for _, v := range variants {
		versions = append(versions, v.ID, v.Version, v.EnvironmentsVersion)
	}
	for _, e := range envs {
		versions = append(versions, e.ID, e.Version)
	}
	token := digest(struct {
		Project  uint64
		Versions []uint64
		Rules    []BranchRule
	}{cmd.ProjectID, versions, ordered})

	if cmd.Operation == "model.preview" {
		samples := []Classification{}
		for _, name := range cmd.Model.Samples {
			samples = append(samples, Classify(ordered, name, "", false))
		}
		out.Data = map[string]any{"samples": samples, "impacts": paginate(impacts, cmd.Query), "impact_token": token}
		return nil
	}
	if len(impacts) > 0 && cmd.Model.ImpactToken != token {
		return httpx.E(409, "RULE_CHANGE_IMPACT", "规则影响已有绑定，请预览并确认")
	}
	if digest(ordered) != digest(x.model.Rules) {
		x.model.Rules = ordered
		x.model.Version++
		if e = x.r.SaveDeliveryModel(x.model); e != nil {
			return e
		}
		if e = x.audit("project_branch_model", cmd.ProjectID, x.project.Name, "updated", map[string]any{"rules": ordered, "impact_count": len(impacts)}, cmd.Meta); e != nil {
			return e
		}
	}
	x.model.ETag = tag("branch-model", cmd.ProjectID, x.model.Version)
	*out = i.Result{Data: x.model, Tag: x.model.ETag}
	return nil
}
func (x *access) scope(v *Variant, eid uint64) ([]ScopedRepo, string, string, uint64, string, error) {
	repos, e := x.allRepos()
	if e != nil {
		return nil, "", "", 0, "", e
	}
	rows := Evaluate(v.Scope, repos)
	branch, kind, id, typ := v.Branch, "variant", v.ID, v.Type()
	var env *Environment
	if eid != 0 {
		env, e = x.r.Environment(v.ProjectID, v.ID, eid)
		if e != nil {
			return nil, "", "", 0, "", e
		}
		if env == nil {
			return nil, "", "", 0, "", notFound()
		}
		rows = Evaluate(env.Scope, plain(rows))
		branch, kind, id, typ = env.Branch, "environment", env.ID, env.BranchType
	}
	version, e := x.repos.RepoVersion(v.ProjectID)
	if e != nil {
		return nil, "", "", 0, "", e
	}
	// Include versions explicitly: configuration versions intentionally have json:"-".
	ev := uint64(0)
	var es *Scope
	if env != nil {
		ev = env.Version
		es = &env.Scope
	}
	token := digest(struct {
		P, V, E, R, M, VV, EV uint64
		Scope                 Scope
		Environment           *Scope
	}{v.ProjectID, v.ID, eid, version, x.model.Version, v.Version, ev, v.Scope, es})
	return rows, token, branch, id, kind, binding(x.model.Rules, branch, typ, eid != 0)
}
func (s *Service) scopeResult(x *access, v *Variant, eid uint64, q Query, out *i.Result) error {
	rows, token, _, id, kind, err := x.scope(v, eid)
	if err != nil {
		if api, ok := err.(*httpx.Error); !ok || api.Code != "VALIDATION_FAILED" {
			return err
		}
	}
	checks, e := x.r.BranchChecks(v.ProjectID, kind, id)
	if e != nil {
		return e
	}
	byID := map[uint64]Check{}
	for _, c := range checks {
		byID[c.RepositoryID] = c
	}
	for n, r := range rows {
		c, ok := byID[r.ID]
		if !ok {
			rows[n].Check = &Check{Status: "unchecked", RepositoryID: r.ID}
			continue
		}
		snap, e := s.Integrations.BranchSnapshot(x.tx, r.ConnectionID, false)
		current := checkSnapshot(token, r.ProjectRepo, snap)
		c.Outdated = e != nil || digest(c.Snapshot) != digest(current)
		rows[n].Check = &c
	}
	page := paginate(rows, q)
	page.ScopeToken = token
	page.CanManage = x.manage && v.ArchivedAt == nil
	out.Data = page
	return nil
}
func (x *access) previewScope(cmd Command, out *i.Result) error {
	if cmd.Scope.Kind != "variant" && cmd.Scope.Kind != "environment" {
		return httpx.Invalid("subject_kind", "invalid_value")
	}
	repos, e := x.allRepos()
	if e != nil {
		return e
	}
	var v *Variant
	old := DefaultScope(cmd.Scope.Kind == "environment")
	if cmd.Scope.VariantID != "" {
		id, e := parseID(cmd.Scope.VariantID)
		if e != nil {
			return e
		}
		v, e = x.variant(id, true, false)
		if e != nil {
			return e
		}
		if cmd.Scope.Kind == "variant" {
			old = v.Scope
		} else {
			repos = plain(Evaluate(v.Scope, repos))
		}
	}
	if cmd.Scope.Kind == "environment" && v == nil {
		return httpx.Invalid("variant_id", "required")
	}
	if e = ValidateScope(cmd.Scope.Scope, cmd.Scope.Kind == "environment", repos, old); e != nil {
		return e
	}
	page := paginate(Evaluate(cmd.Scope.Scope, repos), cmd.Query)
	page.ScopeToken = "draft-" + digest(cmd.Scope)
	page.CanManage = x.manage
	out.Data = page
	return nil
}
func checkSnapshot(token string, r i.ProjectRepo, remote i.BranchSnapshot) json.RawMessage {
	b, _ := json.Marshal(struct {
		Scope      string           `json:"scope_digest"`
		Repository uint64           `json:"repository_version,string"`
		Remote     i.BranchSnapshot `json:"remote"`
	}{token, r.Version, remote})
	return b
}
