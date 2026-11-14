package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) GetAdminCommandReceipt(ctx context.Context, raw, key, command, scope string) (*Result, error) {
	return s.getReceipt(ctx, raw, key, command, scope, true)
}
func (s *Service) GetCommandReceipt(ctx context.Context, raw, key, command, scope string) (*Result, error) {
	return s.getReceipt(ctx, raw, key, command, scope, false)
}
func (s *Service) getReceipt(ctx context.Context, raw, key, command, scope string, admin bool) (*Result, error) {
	return s.access(ctx, raw, admin, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) || len(command) < 1 || len(command) > 64 || len(scope) < 1 || len(scope) > 128 {
			return httpx.Invalid("command", "invalid_format")
		}
		if admin && !strings.HasPrefix(command, "agent.") && !strings.HasPrefix(command, "skill") && !strings.HasPrefix(command, "mcp_") && !strings.HasPrefix(command, "cloud_") && !strings.HasPrefix(command, "sandbox") && !strings.HasPrefix(command, "workspace.") {
			return missing()
		}
		kind, id := splitScope(scope)
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if !admin && kind != "sessions" {
			n, e := idValue(id, "scope")
			if e != nil {
				return e
			}
			session := n
			switch kind {
			case "workspace":
				repo, e := CloudStateFor(tx)
				if e != nil {
					return e
				}
				workspace, e := repo.Computer(n, false)
				if e != nil {
					return e
				}
				if e = workspaceContentAccess(workspace, a); e != nil {
					return e
				}
				session = 0
			case "session":
			case "input":
				v, e := st.Input(n, false)
				if e != nil {
					return e
				}
				if v == nil {
					return missing()
				}
				session = v.SessionID
			case "run":
				v, e := st.Run(n, false)
				if e != nil {
					return e
				}
				if v == nil {
					return missing()
				}
				session = v.SessionID
			case "interaction":
				v, e := st.Interaction(n, false)
				if e != nil {
					return e
				}
				if v == nil {
					return missing()
				}
				session = v.SessionID
			case "artifact":
				v, e := st.Artifact(n, false)
				if e != nil {
					return e
				}
				if v == nil {
					return missing()
				}
				session = v.ContentSessionID
			default:
				return missing()
			}
			if session != 0 {
				if _, e = s.sessionAccess(st, session, a, false, false); e != nil {
					return e
				}
			}
		}
		rec, e := r.Receipt(strconv.FormatUint(a.User.ID, 10), kind, id, command, key)
		if e != nil {
			return e
		}
		if rec == nil || rec.Status != "completed" {
			return missing()
		}
		if !admin && kind == "sessions" {
			if rec.TargetKind == nil || *rec.TargetKind != "session" || rec.TargetID == nil {
				return missing()
			}
			if _, e = s.sessionAccess(st, *rec.TargetID, a, false, false); e != nil {
				return e
			}
		}
		var saved savedResult
		if json.Unmarshal(rec.Result, &saved) != nil {
			return integrity()
		}
		refs := []ResourceRef{}
		if rec.TargetKind != nil && rec.TargetID != nil {
			refs = append(refs, ResourceRef{Kind: *rec.TargetKind, ID: strconv.FormatUint(*rec.TargetID, 10)})
		}
		out.Data = CommandReceipt{Command: command, Scope: scope, Key: key, ResponseStatus: rec.ResponseStatus, ResponseData: saved.Data, Resources: refs, CreatedAt: rec.CreatedAt}
		return nil
	})
}
