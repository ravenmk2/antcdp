package projectdelivery

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Service struct {
	Identity     *identity.Service
	Integrations *i.Service
}
type access struct {
	tx      identity.Tx
	r       Repository
	repos   i.ProjectRepoStore
	auth    *identity.Auth
	project *c.Resource
	model   *Model
	manage  bool
}

func notFound() error { return httpx.E(404, "NOT_FOUND", "对象不存在或不可见") }
func changed() error {
	return httpx.E(409, "STATE_CHANGED", "配置或权限已变化，请重新加载")
}
func busy() error {
	return httpx.E(409, "BRANCH_OPERATION_IN_PROGRESS", "存在执行中的分支创建，请稍后重试")
}
func (s *Service) access(ctx context.Context, raw string, pid uint64, write bool, fn func(*access) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		cr, ok := tx.(c.Repository)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "项目管理暂不可用")
		}
		r, ok := tx.(Repository)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "产品变体暂不可用")
		}
		pr, ok := tx.(i.ProjectRepoStore)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "项目仓库暂不可用")
		}
		if e := cr.LockCollaboration(c.Project, pid, 0); e != nil {
			return e
		}
		p, e := cr.Resource(c.Project, pid, a.User.ID)
		if e != nil {
			return e
		}
		if p == nil || (!p.IsMember && a.User.Role != "admin") {
			return notFound()
		}
		manage := a.User.Role == "admin" || p.Role == "admin"
		if write && !manage {
			return httpx.E(403, "FORBIDDEN", "需要项目管理员权限")
		}
		if write && p.EndedAt != nil {
			return httpx.E(409, "PROJECT_ARCHIVED", "归档项目只读")
		}
		m, e := r.DeliveryModel(pid)
		if e != nil {
			return e
		}
		m.ETag = tag("branch-model", pid, m.Version)
		m.Types = Types
		m.CanManage = manage && p.EndedAt == nil
		return fn(&access{tx, r, pr, a, p, m, m.CanManage})
	})
}
func (x *access) allRepos() ([]i.ProjectRepo, error) {
	out := []i.ProjectRepo{}
	for page := 1; ; page++ {
		v, e := x.repos.ProjectRepos(x.project.ID, i.RepoQuery{Page: page, Size: 100})
		if e != nil {
			return nil, e
		}
		out = append(out, v.Items...)
		if len(out) >= v.Total {
			return out, nil
		}
	}
}
func (x *access) variant(id uint64, write bool, allowArchived bool) (*Variant, error) {
	v, e := x.r.Variant(x.project.ID, id)
	if e != nil {
		return nil, e
	}
	if v == nil {
		return nil, notFound()
	}
	if write && !allowArchived && v.ArchivedAt != nil {
		return nil, httpx.E(409, "VARIANT_ARCHIVED", "归档变体只读")
	}
	return v, nil
}
func (x *access) decorateVariant(v *Variant, repos []i.ProjectRepo) {
	v.ETag = tag("project-variant", v.ID, v.Version)
	v.CanManage = x.manage
	v.BranchType = v.Type()
	b := Classify(x.model.Rules, v.Branch, v.Type(), false)
	v.Validity = b.Validity
	v.Reason = b.Reason
	v.RepositoryCount = len(Evaluate(v.Scope, repos))
}
func (x *access) decorateEnvironment(v *Environment, parent *Variant, repos []i.ProjectRepo) {
	v.ETag = tag("project-environment", v.ID, v.Version)
	v.CanManage = x.manage && parent.ArchivedAt == nil
	b := Classify(x.model.Rules, v.Branch, v.BranchType, true)
	v.Validity = b.Validity
	v.Reason = b.Reason
	v.RepositoryCount = len(Evaluate(v.Scope, plain(Evaluate(parent.Scope, repos))))
}
func (x *access) guard(vid, rid uint64) error {
	v, e := x.r.DeliveryBusy(x.project.ID, vid, rid)
	if e != nil {
		return e
	}
	if v {
		return busy()
	}
	return nil
}
func (x *access) audit(kind string, id uint64, name, action string, detail any, meta identity.Metadata) error {
	data, e := json.Marshal(detail)
	if e != nil {
		return e
	}
	uid := x.auth.User.ID
	username := x.auth.User.Username
	target := fmt.Sprint(id)
	return x.tx.Audit(identity.Event{ActorID: &uid, ActorType: "user", ActorName: x.auth.User.DisplayName, ActorUsername: &username, Action: kind + "." + action, TargetType: kind, TargetID: &target, TargetLabel: name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: data})
}
func validateQuery(q *Query) error {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.Size == 0 {
		q.Size = 20
	}
	if q.Status == "" {
		q.Status = "active"
	}
	if q.Page < 1 || q.Page > 1000000 || !slices.Contains([]int{10, 20, 50, 100}, q.Size) || utf8.RuneCountInString(q.Search) > 100 {
		return httpx.Invalid("query", "invalid_value")
	}
	return nil
}
func paginate[T any](rows []T, q Query) Page[T] {
	start := min((q.Page-1)*q.Size, len(rows))
	return Page[T]{Items: rows[start:min(start+q.Size, len(rows))], Total: len(rows), Page: q.Page, Size: q.Size}
}

type Write struct {
	Code       i.Field[string] `json:"code"`
	Name       i.Field[string] `json:"name"`
	Summary    i.Field[string] `json:"summary"`
	MainBranch i.Field[string] `json:"main_branch"`
	BranchType i.Field[string] `json:"branch_type"`
	BranchName i.Field[string] `json:"branch_name"`
	Scope      i.Field[Scope]  `json:"repository_scope"`
}
type ModelWrite struct {
	Rules       []BranchRule `json:"rules"`
	Samples     []string     `json:"sample_names"`
	ImpactToken string       `json:"impact_token"`
}
type ScopeWrite struct {
	VariantID string `json:"variant_id"`
	Scope     Scope  `json:"repository_scope"`
	Kind      string `json:"subject_kind"`
}
type Command struct {
	Operation                           string
	ProjectID, VariantID, EnvironmentID uint64
	Tag, Collection                     string
	Query                               Query
	Write                               Write
	Model                               ModelWrite
	Scope                               ScopeWrite
	Meta                                identity.Metadata
}

func (s *Service) Config(ctx context.Context, raw string, cmd Command) (i.Result, *identity.Auth, error) {
	var out i.Result
	if e := validateQuery(&cmd.Query); e != nil {
		return out, nil, e
	}
	write := !strings.HasSuffix(cmd.Operation, ".get") && !strings.HasSuffix(cmd.Operation, ".list")
	a, e := s.access(ctx, raw, cmd.ProjectID, write, func(x *access) error {
		switch cmd.Operation {
		case "model.get":
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			x.model.Connections = []ScopeConnection{}
			seen := map[uint64]bool{}
			for _, r := range repos {
				if !seen[r.ConnectionID] {
					seen[r.ConnectionID] = true
					x.model.Connections = append(x.model.Connections, ScopeConnection{r.ConnectionID, r.ConnectionName})
				}
			}
			out = i.Result{Data: x.model, Tag: x.model.ETag}
			return nil
		case "model.preview", "model.save":
			return x.modelCommand(cmd, &out)
		case "variant.list":
			if !slices.Contains([]string{"active", "archived", "all"}, cmd.Query.Status) {
				return httpx.Invalid("archived", "invalid_value")
			}
			rows, n, e := x.r.Variants(cmd.ProjectID, cmd.Query)
			if e != nil {
				return e
			}
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			for n := range rows {
				x.decorateVariant(&rows[n], repos)
			}
			ct := tag("project-variants", cmd.ProjectID, x.model.VariantsVersion)
			out = i.Result{Data: Page[Variant]{Items: rows, Total: n, Page: cmd.Query.Page, Size: cmd.Query.Size, MutationVersion: ct, CanManage: x.manage}, CollectionTag: ct}
			return nil
		case "variant.create":
			return x.writeVariant(nil, cmd, &out)
		case "scope.preview":
			return x.previewScope(cmd, &out)
		}
		v, e := x.variant(cmd.VariantID, write, slices.Contains([]string{"variant.archive", "variant.restore", "variant.delete"}, cmd.Operation))
		if e != nil {
			return e
		}
		switch cmd.Operation {
		case "variant.get":
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			x.decorateVariant(v, repos)
			out = i.Result{Data: v, Tag: v.ETag}
			return nil
		case "variant.save", "variant.archive", "variant.restore", "variant.delete":
			return x.writeVariant(v, cmd, &out)
		case "environment.list":
			rows, e := x.r.Environments(cmd.ProjectID, v.ID)
			if e != nil {
				return e
			}
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			for n := range rows {
				x.decorateEnvironment(&rows[n], v, repos)
			}
			page := paginate(rows, cmd.Query)
			page.MutationVersion = tag("variant-environments", v.ID, v.EnvironmentsVersion)
			page.CanManage = x.manage && v.ArchivedAt == nil
			out = i.Result{Data: page, CollectionTag: page.MutationVersion}
			return nil
		case "environment.create":
			return x.writeEnvironment(v, nil, cmd, &out)
		case "repositories.get":
			return s.scopeResult(x, v, cmd.EnvironmentID, cmd.Query, &out)
		}
		env, e := x.r.Environment(cmd.ProjectID, v.ID, cmd.EnvironmentID)
		if e != nil {
			return e
		}
		if env == nil {
			return notFound()
		}
		if cmd.Operation == "environment.get" {
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			x.decorateEnvironment(env, v, repos)
			out = i.Result{Data: env, Tag: env.ETag}
			return nil
		}
		return x.writeEnvironment(v, env, cmd, &out)
	})
	return out, a, e
}

var codePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$`)

func fields(code, name, summary *string, w Write, create bool) error {
	if create {
		if !w.Code.Set || w.Code.Null || !codePattern.MatchString(w.Code.Value) {
			return httpx.Invalid("code", "invalid_format")
		}
		*code = w.Code.Value
	} else if w.Code.Set {
		return httpx.Invalid("code", "immutable")
	}
	if w.Name.Set {
		if w.Name.Null {
			return httpx.Invalid("name", "required")
		}
		*name = strings.TrimSpace(w.Name.Value)
	}
	if *name == "" || utf8.RuneCountInString(*name) > 100 || !utf8.ValidString(*name) {
		return httpx.Invalid("name", "invalid_length")
	}
	if w.Summary.Set {
		if w.Summary.Null {
			return httpx.Invalid("summary", "invalid_value")
		}
		*summary = w.Summary.Value
	}
	if utf8.RuneCountInString(*summary) > 300 || !utf8.ValidString(*summary) {
		return httpx.Invalid("summary", "invalid_length")
	}
	return nil
}
func (x *access) writeVariant(v *Variant, cmd Command, out *i.Result) error {
	create := v == nil
	ct := tag("project-variants", cmd.ProjectID, x.model.VariantsVersion)
	if create {
		if e := match(cmd.Tag, ct); e != nil {
			return e
		}
		v = &Variant{ProjectID: cmd.ProjectID, Kind: "custom", Scope: DefaultScope(false), Creator: x.auth.User.ID, Version: 1, EnvironmentsVersion: 1}
	} else {
		if e := match(cmd.Tag, tag("project-variant", v.ID, v.Version)); e != nil {
			return e
		}
		if e := x.guard(v.ID, 0); e != nil {
			return e
		}
	}
	before := digest(v)
	action := "updated"
	if create {
		action = "created"
	}
	switch cmd.Operation {
	case "variant.delete", "variant.archive", "variant.restore":
		if v.Kind == "standard" {
			return httpx.E(409, "STANDARD_VARIANT_PROTECTED", "标准版不能归档或删除")
		}
		switch cmd.Operation {
		case "variant.delete":
			if e := match(cmd.Collection, ct); e != nil {
				return e
			}
			if v.EnvironmentCount > 0 {
				return httpx.E(409, "VARIANT_HAS_ENVIRONMENTS", "请先清空环境")
			}
			if e := x.r.DeleteVariant(cmd.ProjectID, v.ID); e != nil {
				return e
			}
			action = "deleted"
		case "variant.archive":
			if v.ArchivedAt == nil {
				now := time.Now().UTC()
				v.ArchivedAt = &now
			}
			action = "archived"
		default:
			v.ArchivedAt = nil
			action = "restored"
		}
	default:
		if cmd.Write.BranchName.Set || cmd.Write.BranchType.Set {
			return httpx.Invalid("branch_name", "unexpected_field")
		}
		if e := fields(&v.Code, &v.Name, &v.Summary, cmd.Write, create); e != nil {
			return e
		}
		if cmd.Write.MainBranch.Set {
			if cmd.Write.MainBranch.Null {
				return httpx.Invalid("main_branch", "required")
			}
			if create || v.Branch != cmd.Write.MainBranch.Value {
				if e := binding(x.model.Rules, cmd.Write.MainBranch.Value, v.Type(), false); e != nil {
					return e
				}
			}
			v.Branch = cmd.Write.MainBranch.Value
		}
		if create && v.Branch == "" {
			return httpx.Invalid("main_branch", "required")
		}
		if cmd.Write.Scope.Set {
			if cmd.Write.Scope.Null {
				return httpx.Invalid("repository_scope", "required")
			}
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			if e = ValidateScope(cmd.Write.Scope.Value, false, repos, v.Scope); e != nil {
				return e
			}
			v.Scope = cmd.Write.Scope.Value
		}
	}
	if create || digest(v) != before || action == "deleted" {
		if action != "deleted" {
			if !create {
				v.Version++
			}
			if e := x.r.SaveVariant(v, create); e != nil {
				return e
			}
		}
		if e := x.r.BumpVariants(cmd.ProjectID); e != nil {
			return e
		}
		x.model.VariantsVersion++
		if e := x.audit("project_variant", v.ID, v.Name, action, map[string]any{"project_id": fmt.Sprint(cmd.ProjectID), "main_branch": v.Branch}, cmd.Meta); e != nil {
			return e
		}
	}
	repos, e := x.allRepos()
	if e != nil {
		return e
	}
	x.decorateVariant(v, repos)
	*out = i.Result{Data: v, Tag: v.ETag, CollectionTag: tag("project-variants", cmd.ProjectID, x.model.VariantsVersion)}
	return nil
}
func (x *access) writeEnvironment(v *Variant, env *Environment, cmd Command, out *i.Result) error {
	create := env == nil
	ct := tag("variant-environments", v.ID, v.EnvironmentsVersion)
	if create {
		if e := match(cmd.Tag, ct); e != nil {
			return e
		}
		env = &Environment{ProjectID: v.ProjectID, VariantID: v.ID, Scope: DefaultScope(true), Creator: x.auth.User.ID, Version: 1}
	} else if e := match(cmd.Tag, tag("project-environment", env.ID, env.Version)); e != nil {
		return e
	}
	before := digest(env)
	action := "updated"
	if create {
		action = "created"
	}
	if cmd.Operation == "environment.delete" {
		if e := match(cmd.Collection, ct); e != nil {
			return e
		}
		if e := x.r.DeleteEnvironment(v.ProjectID, v.ID, env.ID); e != nil {
			return e
		}
		action = "deleted"
	} else {
		if cmd.Write.MainBranch.Set {
			return httpx.Invalid("main_branch", "unexpected_field")
		}
		if e := fields(&env.Code, &env.Name, &env.Summary, cmd.Write, create); e != nil {
			return e
		}
		if cmd.Write.BranchName.Null || cmd.Write.BranchType.Null {
			return httpx.Invalid("branch_name", "required")
		}
		name, typ := env.Branch, env.BranchType
		if cmd.Write.BranchName.Set {
			name = cmd.Write.BranchName.Value
		}
		if cmd.Write.BranchType.Set {
			typ = cmd.Write.BranchType.Value
		}
		if create || name != env.Branch || typ != env.BranchType {
			if typ == "" {
				return httpx.Invalid("branch_type", "required")
			}
			if e := binding(x.model.Rules, name, typ, true); e != nil {
				return e
			}
		}
		env.Branch = name
		env.BranchType = typ
		if cmd.Write.Scope.Set {
			if cmd.Write.Scope.Null {
				return httpx.Invalid("repository_scope", "required")
			}
			repos, e := x.allRepos()
			if e != nil {
				return e
			}
			if e = ValidateScope(cmd.Write.Scope.Value, true, plain(Evaluate(v.Scope, repos)), env.Scope); e != nil {
				return e
			}
			env.Scope = cmd.Write.Scope.Value
		}
	}
	if create || digest(env) != before || action == "deleted" {
		if action != "deleted" {
			if !create {
				env.Version++
			}
			if e := x.r.SaveEnvironment(env, create); e != nil {
				return e
			}
		}
		if e := x.r.BumpEnvironments(v.ID); e != nil {
			return e
		}
		v.EnvironmentsVersion++
		if e := x.audit("project_environment", env.ID, env.Name, action, map[string]any{"project_id": fmt.Sprint(v.ProjectID), "variant_id": fmt.Sprint(v.ID), "branch_name": env.Branch}, cmd.Meta); e != nil {
			return e
		}
	}
	repos, e := x.allRepos()
	if e != nil {
		return e
	}
	x.decorateEnvironment(env, v, repos)
	*out = i.Result{Data: env, Tag: env.ETag, CollectionTag: tag("variant-environments", v.ID, v.EnvironmentsVersion)}
	return nil
}
