package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Service struct{ Identity *identity.Service }

var codePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,62}[A-Za-z0-9]$`)
var tagPattern = regexp.MustCompile(`^"(?:project|team)(?:-members|-dissolve)?-[1-9][0-9]*-(?:v[1-9][0-9]*|r[1-9][0-9]*-m[1-9][0-9]*)"$`)
var IconKeys = []string{"folder", "code", "box", "globe", "bolt", "layers", "team"}

func ID(raw string) (uint64, error) {
	v, e := strconv.ParseUint(raw, 10, 64)
	if e != nil || v == 0 || strconv.FormatUint(v, 10) != raw {
		return 0, httpx.Invalid("id", "invalid_format")
	}
	return v, nil
}
func conflict() error {
	return httpx.E(412, "VERSION_CONFLICT", "内容已更新，请重新加载后重试")
}
func precondition(got, want string) error {
	if got == "" {
		return httpx.E(428, "PRECONDITION_REQUIRED", "请先加载当前资料")
	}
	if !tagPattern.MatchString(got) {
		return httpx.Invalid("If-Match", "invalid_format")
	}
	if got != want {
		return conflict()
	}
	return nil
}
func forbidden() error { return httpx.E(403, "FORBIDDEN", "没有此操作的权限") }
func repo(tx identity.Tx) (Repository, error) {
	r, ok := tx.(Repository)
	if !ok {
		return nil, httpx.E(503, "FEATURE_UNAVAILABLE", "协作模块暂不可用")
	}
	return r, nil
}
func access(r *Resource, a *identity.Auth, write bool) error {
	if r == nil || (!r.IsMember && a.User.Role != "admin") {
		return httpx.E(404, "RESOURCE_NOT_FOUND", "对象不存在或不可见")
	}
	if write {
		if a.User.Role != "admin" && r.Role != "admin" {
			return forbidden()
		}
		if r.EndedAt != nil {
			return httpx.E(409, "RESOURCE_READ_ONLY", "对象已归档或解散")
		}
	}
	return nil
}
func (s *Service) read(ctx context.Context, raw string, fn func(Repository, *identity.Auth) error) (*identity.Auth, error) {
	return s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		r, e := repo(tx)
		if e != nil {
			return e
		}
		return fn(r, a)
	})
}
func (s *Service) List(ctx context.Context, raw string, k Kind, q Query) (Page, *identity.Auth, error) {
	out := Page{}
	if !k.Valid() {
		return out, nil, httpx.Invalid("kind", "invalid_value")
	}
	if q.Scope == "" {
		q.Scope = "mine"
	}
	if q.Status == "" {
		q.Status = "active"
	}
	if q.Page < 1 || q.Size < 1 || q.Size > 100 || utf8.RuneCountInString(q.Search) > 100 || q.Page > 1000000 {
		return out, nil, httpx.Invalid("page", "invalid_value")
	}
	end := "archived"
	if k == Team {
		end = "dissolved"
	}
	if !slices.Contains([]string{"active", "all", end}, q.Status) || !slices.Contains([]string{"mine", "all"}, q.Scope) {
		return out, nil, httpx.Invalid("filter", "invalid_value")
	}
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		if (q.Scope == "all" || q.Unmanaged) && a.User.Role != "admin" {
			return forbidden()
		}
		var err error
		out, err = r.Resources(k, a.User.ID, q)
		for i := range out.Items {
			out.Items[i].Decorate(k, a.User.Role == "admin")
		}
		return err
	})
	return out, a, e
}
func (s *Service) Get(ctx context.Context, raw string, k Kind, id uint64) (*Resource, *identity.Auth, error) {
	var out *Resource
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		var err error
		out, err = r.Resource(k, id, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(out, a, false); err != nil {
			return err
		}
		out.Decorate(k, a.User.Role == "admin")
		return nil
	})
	return out, a, e
}
func apply(r *Resource, w Write, create bool) error {
	if create {
		if !codePattern.MatchString(w.Code) {
			return httpx.Invalid("code", "invalid_format")
		}
		r.Code = w.Code
		if w.Name == nil {
			return httpx.Invalid("name", "required")
		}
	} else if w.Code != "" || w.Admins != nil {
		return httpx.Invalid("code", "immutable")
	}
	if w.Name != nil {
		v := strings.TrimSpace(*w.Name)
		if !utf8.ValidString(v) || utf8.RuneCountInString(v) < 1 || utf8.RuneCountInString(v) > 100 {
			return httpx.Invalid("name", "invalid_length")
		}
		r.Name = v
	}
	if w.Summary != nil {
		if !utf8.ValidString(*w.Summary) || utf8.RuneCountInString(*w.Summary) > 300 {
			return httpx.Invalid("summary", "invalid_length")
		}
		r.Summary = *w.Summary
	}
	if w.Description != nil {
		if !utf8.ValidString(*w.Description) || len(*w.Description) > 102400 {
			return httpx.Invalid("description", "invalid_length")
		}
		r.Description = *w.Description
	}
	if w.Icon != nil {
		switch w.Icon.Type {
		case "default":
			if w.Icon.Key != "" || w.Icon.FileID != "" {
				return httpx.Invalid("icon", "invalid_value")
			}
			r.IconKey = nil
			r.IconFileID = nil
		case "builtin":
			if !slices.Contains(IconKeys, w.Icon.Key) || w.Icon.FileID != "" {
				return httpx.Invalid("icon", "invalid_value")
			}
			key := w.Icon.Key
			r.IconKey = &key
			r.IconFileID = nil
		case "upload":
			if w.Icon.Key != "" {
				return httpx.Invalid("icon", "invalid_value")
			}
			id, err := ID(w.Icon.FileID)
			if err != nil {
				return httpx.Invalid("icon.file_id", "invalid_format")
			}
			r.IconKey = nil
			r.IconFileID = &id
		default:
			return httpx.Invalid("icon", "invalid_value")
		}
	}
	return nil
}
func audit(tx identity.Tx, a *identity.Auth, meta identity.Metadata, k Kind, r *Resource, action string, detail any) error {
	data, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	id := strconv.FormatUint(r.ID, 10)
	uid := a.User.ID
	un := a.User.Username
	return tx.Audit(identity.Event{ActorID: &uid, ActorType: "user", ActorName: a.User.DisplayName, ActorUsername: &un, Action: string(k) + "." + action, TargetType: string(k), TargetID: &id, TargetLabel: r.Name, OccurredAt: time.Now().UTC(), RequestID: &meta.RequestID, IP: &meta.IP, Detail: data})
}
func (s *Service) Create(ctx context.Context, raw string, k Kind, w Write, meta identity.Metadata) (*Resource, *identity.Auth, error) {
	out := &Resource{}
	if e := apply(out, w, true); e != nil {
		return nil, nil, e
	}
	if len(w.Admins) < 1 || len(w.Admins) > 100 {
		return nil, nil, httpx.Invalid("admin_user_ids", "invalid_length")
	}
	ids := []uint64{}
	for _, v := range w.Admins {
		id, e := ID(v)
		if e != nil {
			return nil, nil, e
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	a, e := s.Identity.BusinessAccess(ctx, raw, func(identity.Tx) ([]uint64, error) { return ids, nil }, func(tx identity.Tx, a *identity.Auth) error {
		if a.User.Role != "admin" {
			return forbidden()
		}
		r, err := repo(tx)
		if err != nil {
			return err
		}
		users, err := tx.LockUsers(ids)
		if err != nil {
			return err
		}
		for _, id := range ids {
			u := users[id]
			if u == nil || u.DeletedAt != nil || u.Status != "active" {
				return httpx.Invalid("admin_user_ids", "unavailable")
			}
		}
		out.Creator = a.User.ID
		out.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
		out.UpdatedAt = out.CreatedAt
		out.Version = 1
		out.MembershipVersion = 1
		if err = r.InsertResource(k, out, ids); err != nil {
			return err
		}
		if err = bindIcon(tx, a.User.ID, nil, out.IconFileID); err != nil {
			return err
		}
		if out.IconFileID != nil {
			if err = r.SaveResource(k, out); err != nil {
				return err
			}
		}
		out.Role = ""
		out.IsMember = slices.Contains(ids, a.User.ID)
		if out.IsMember {
			out.Role = "admin"
		}
		out.Decorate(k, true)
		return audit(tx, a, meta, k, out, "created", map[string]any{"code": out.Code})
	})
	return out, a, e
}

// prepare locks every affected user before the session. If membership discovery
// changes while waiting, abort rather than acquire users out of order.
func (s *Service) mutate(ctx context.Context, raw string, k Kind, id uint64, extras []uint64, teamID uint64, fn func(identity.Tx, Repository, *identity.Auth, *Resource, []uint64) error) (*identity.Auth, error) {
	var locked []uint64
	return s.Identity.BusinessAccess(ctx, raw, func(tx identity.Tx) ([]uint64, error) {
		r, e := repo(tx)
		if e != nil {
			return nil, e
		}
		locked, e = r.CollaborationUsers(k, id)
		if e != nil {
			return nil, e
		}
		if teamID != 0 {
			more, err := r.CollaborationUsers(Team, teamID)
			if err != nil {
				return nil, err
			}
			locked = append(locked, more...)
		}
		locked = append(locked, extras...)
		return locked, nil
	}, func(tx identity.Tx, a *identity.Auth) error {
		r, e := repo(tx)
		if e != nil {
			return e
		}
		if e = r.LockCollaboration(k, id, teamID); e != nil {
			return e
		}
		actual, e := r.CollaborationUsers(k, id)
		if e != nil {
			return e
		}
		if teamID != 0 {
			more, err := r.CollaborationUsers(Team, teamID)
			if err != nil {
				return err
			}
			actual = append(actual, more...)
		}
		for _, uid := range actual {
			if uid != a.User.ID && !slices.Contains(locked, uid) {
				return conflict()
			}
		}
		out, e := r.Resource(k, id, a.User.ID)
		if e != nil {
			return e
		}
		if out != nil {
			out.Decorate(k, a.User.Role == "admin")
		}
		return fn(tx, r, a, out, locked)
	})
}
func (s *Service) Update(ctx context.Context, raw string, k Kind, id uint64, w Write, tag string, meta identity.Metadata) (*Resource, *identity.Auth, error) {
	var out *Resource
	a, e := s.mutate(ctx, raw, k, id, nil, 0, func(tx identity.Tx, r Repository, a *identity.Auth, obj *Resource, _ []uint64) error {
		if err := access(obj, a, true); err != nil {
			return err
		}
		if err := precondition(tag, obj.ETag); err != nil {
			return err
		}
		before := *obj
		if err := apply(obj, w, false); err != nil {
			return err
		}
		out = obj
		if obj.Name == before.Name && obj.Summary == before.Summary && obj.Description == before.Description && ptrEqual(obj.IconKey, before.IconKey) && ptrEqual(obj.IconFileID, before.IconFileID) {
			return nil
		}
		obj.Version++
		obj.UpdatedAt = time.Now().UTC()
		if err := bindIcon(tx, a.User.ID, before.IconFileID, obj.IconFileID); err != nil {
			return err
		}
		if err := r.SaveResource(k, obj); err != nil {
			return err
		}
		obj.Decorate(k, a.User.Role == "admin")
		return audit(tx, a, meta, k, obj, "updated", map[string]any{"description_changed": obj.Description != before.Description, "icon_changed": !ptrEqual(obj.IconKey, before.IconKey) || !ptrEqual(obj.IconFileID, before.IconFileID)})
	})
	return out, a, e
}
func ptrEqual[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func (s *Service) Members(ctx context.Context, raw string, k Kind, id uint64, q Query) (MemberPage, *identity.Auth, error) {
	out := MemberPage{Items: []Member{}, Page: q.Page, PageSize: q.Size}
	if q.Page < 1 || q.Page > 1000000 || q.Size < 1 || q.Size > 100 || utf8.RuneCountInString(q.Search) > 100 {
		return out, nil, httpx.Invalid("filter", "invalid_value")
	}
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		obj, err := r.Resource(k, id, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(obj, a, false); err != nil {
			return err
		}
		rows, err := r.Members(k, id)
		if err != nil {
			return err
		}
		search := strings.ToLower(strings.TrimSpace(q.Search))
		rows = slices.DeleteFunc(rows, func(m Member) bool {
			return search != "" && !strings.Contains(strings.ToLower(m.Name), search) && !strings.Contains(strings.ToLower(m.Username), search)
		})
		out.Total = len(rows)
		start := min((q.Page-1)*q.Size, len(rows))
		out.Items = rows[start:min(start+q.Size, len(rows))]
		obj.Decorate(k, false)
		out.MembershipETag = obj.MembershipETag
		return nil
	})
	return out, a, e
}
func (s *Service) Member(ctx context.Context, raw string, k Kind, id, uid uint64, role, tag, operation string, meta identity.Metadata) (*identity.Auth, error) {
	if operation != "remove" && operation != "leave" && role != "admin" && role != "member" {
		return nil, httpx.Invalid("role", "invalid_value")
	}
	return s.mutate(ctx, raw, k, id, []uint64{uid}, 0, func(tx identity.Tx, r Repository, a *identity.Auth, obj *Resource, locked []uint64) error {
		if operation == "leave" {
			uid = a.User.ID
			role = ""
			if obj == nil {
				return nil
			}
		} else {
			if err := access(obj, a, true); err != nil {
				return err
			}
			if err := precondition(tag, obj.MembershipETag); err != nil {
				return err
			}
		}
		if operation == "remove" {
			role = ""
		}
		members, err := r.Members(k, id)
		if err != nil {
			return err
		}
		old := ""
		for _, m := range members {
			if m.ID == uid {
				old = m.Role
			}
		}
		if operation == "add" && old != "" && old != role {
			return httpx.E(409, "MEMBER_ALREADY_EXISTS", "用户已直接加入，请修改角色")
		}
		if operation == "role" && old == "" {
			return httpx.E(404, "NOT_FOUND", "直接成员不存在")
		}
		if role != "" {
			users, err := tx.LockUsers([]uint64{uid})
			if err != nil {
				return err
			}
			u := users[uid]
			if u == nil || u.DeletedAt != nil || u.Status != "active" {
				return httpx.Invalid("user_id", "unavailable")
			}
		}
		changed, err := r.SetMember(k, id, uid, role, time.Now().UTC())
		if err != nil || !changed {
			return err
		}
		if err = r.BumpMembers(k, id); err != nil {
			return err
		}
		if err = r.CleanupShortcuts(append(locked, uid), time.Now().UTC()); err != nil {
			return err
		}
		action := "member_role_changed"
		if old == "" {
			action = "member_added"
		}
		if role == "" {
			action = "member_removed"
		}
		if operation == "leave" {
			action = "member_left"
		}
		return audit(tx, a, meta, k, obj, action, map[string]any{"user_id": fmt.Sprint(uid), "before": old, "after": role})
	})
}
func (s *Service) Teams(ctx context.Context, raw string, id uint64) ([]Resource, *identity.Auth, error) {
	out := []Resource{}
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		obj, err := r.Resource(Project, id, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(obj, a, false); err != nil {
			return err
		}
		out, err = r.ProjectTeams(id, a.User.ID)
		return err
	})
	return out, a, e
}
func (s *Service) Projects(ctx context.Context, raw string, id uint64) ([]Resource, *identity.Auth, error) {
	out := []Resource{}
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		obj, err := r.Resource(Team, id, a.User.ID)
		if err != nil {
			return err
		}
		if err = access(obj, a, false); err != nil {
			return err
		}
		out, err = r.TeamProjects(id, a.User.ID, a.User.Role == "admin")
		return err
	})
	return out, a, e
}
func (s *Service) TeamGrant(ctx context.Context, raw string, id, team uint64, add bool, tag string, meta identity.Metadata) (*identity.Auth, error) {
	return s.mutate(ctx, raw, Project, id, nil, team, func(tx identity.Tx, r Repository, a *identity.Auth, obj *Resource, locked []uint64) error {
		if err := access(obj, a, true); err != nil {
			return err
		}
		if err := precondition(tag, obj.MembershipETag); err != nil {
			return err
		}
		t, err := r.Resource(Team, team, a.User.ID)
		if err != nil {
			return err
		}
		if t == nil || t.EndedAt != nil {
			return httpx.Invalid("team_id", "unavailable")
		}
		changed, err := r.SetProjectTeam(id, team, add, time.Now().UTC())
		if err != nil || !changed {
			return err
		}
		if err = r.BumpMembers(Project, id); err != nil {
			return err
		}
		if err = r.CleanupShortcuts(locked, time.Now().UTC()); err != nil {
			return err
		}
		action := "team_removed"
		if add {
			action = "team_added"
		}
		return audit(tx, a, meta, Project, obj, action, map[string]any{"team_id": fmt.Sprint(team)})
	})
}
func (s *Service) Lifecycle(ctx context.Context, raw string, k Kind, id uint64, op, tag string, meta identity.Metadata) (*identity.Auth, error) {
	return s.mutate(ctx, raw, k, id, nil, 0, func(tx identity.Tx, r Repository, a *identity.Auth, obj *Resource, locked []uint64) error {
		if a.User.Role != "admin" {
			return forbidden()
		}
		if obj == nil {
			return httpx.E(404, "NOT_FOUND", "对象不存在")
		}
		expected := obj.ETag
		if k == Team {
			expected = obj.DissolveETag
		}
		if err := precondition(tag, expected); err != nil {
			return err
		}
		now := time.Now().UTC()
		if op == "restore" {
			if obj.EndedAt == nil {
				return nil
			}
			obj.EndedAt = nil
		} else {
			if obj.EndedAt != nil {
				return nil
			}
			obj.EndedAt = &now
		}
		obj.Version++
		obj.UpdatedAt = now
		if k == Team {
			if err := r.EndTeam(id, now); err != nil {
				return err
			}
			obj.MembershipVersion++
		}
		if err := r.SaveResource(k, obj); err != nil {
			return err
		}
		if err := r.CleanupShortcuts(locked, now); err != nil {
			return err
		}
		action := map[string]string{"archive": "archived", "restore": "restored", "dissolve": "dissolved"}[op]
		return audit(tx, a, meta, k, obj, action, map[string]any{})
	})
}
func (s *Service) Options(ctx context.Context, raw string, k Kind, id uint64, teams bool, q string) (any, *identity.Auth, error) {
	var out any
	a, e := s.read(ctx, raw, func(r Repository, a *identity.Auth) error {
		if id == 0 {
			if a.User.Role != "admin" {
				return forbidden()
			}
		} else {
			obj, err := r.Resource(k, id, a.User.ID)
			if err != nil {
				return err
			}
			if err = access(obj, a, true); err != nil {
				return err
			}
		}
		if utf8.RuneCountInString(q) > 100 {
			return httpx.Invalid("q", "invalid_length")
		}
		var err error
		if teams {
			var page Page
			page, err = r.Resources(Team, a.User.ID, Query{Scope: "all", Search: q, Status: "active", Page: 1, Size: 50})
			items := []TeamOption{}
			linked, e := r.ProjectTeams(id, a.User.ID)
			if e != nil {
				return e
			}
			for _, item := range page.Items {
				if slices.ContainsFunc(linked, func(v Resource) bool { return v.ID == item.ID }) {
					continue
				}
				items = append(items, TeamOption{ID: item.ID, Code: item.Code, Name: item.Name, Summary: item.Summary})
			}
			out = items
		} else {
			users, e := r.UserOptions(q)
			if e != nil {
				return e
			}
			if id != 0 {
				members, e := r.Members(k, id)
				if e != nil {
					return e
				}
				users = slices.DeleteFunc(users, func(u UserOption) bool {
					return slices.ContainsFunc(members, func(m Member) bool { return m.ID == u.ID && m.Role != "" })
				})
			}
			out = users
		}
		return err
	})
	return out, a, e
}
