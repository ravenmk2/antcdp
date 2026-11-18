package agents

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const papiGrantsKind = "papi-grants"

type PAPIGrantRow struct {
	AgentID     uint64          `db:"agent_id"`
	Code        string          `db:"api_code"`
	Constraints json.RawMessage `db:"parameter_constraints"`
	CreatedAt   time.Time       `db:"created_at"`
	UpdatedAt   time.Time       `db:"updated_at"`
}

type PAPIGrantWrite struct {
	Constraints json.RawMessage `json:"parameter_constraints"`
}

type papiGrantView struct {
	Code            string          `json:"api_code"`
	Title           string          `json:"title"`
	Summary         string          `json:"summary"`
	Effect          string          `json:"effect"`
	Available       bool            `json:"available"`
	Granted         bool            `json:"granted"`
	Constraints     json.RawMessage `json:"parameter_constraints"`
	ConstraintsText string          `json:"parameter_constraints_text"`
}

// Store the schema as text inside the JSON column so MySQL cannot round numeric
// bounds or enum values. The admin API and runtime use the decoded schema object.
type storedPAPIConstraints struct {
	ArgsSchema string `json:"args_schema_json,omitempty"`
}

func (v PAPIGrantRow) constraints() (json.RawMessage, error) {
	var stored storedPAPIConstraints
	if json.Unmarshal(v.Constraints, &stored) != nil {
		return nil, integrity()
	}
	return json.Marshal(papi.Constraints{ArgsSchema: json.RawMessage(stored.ArgsSchema)})
}

func (s *Service) GetPAPIGrants(ctx context.Context, raw string, id uint64, q Query) (*Result, error) {
	return s.access(ctx, raw, true, func(_ identity.Tx, r Repository, _ *identity.Auth, out *Result) error {
		if err := validateQuery(&q); err != nil {
			return err
		}
		if s.PAPI == nil {
			return unavailable()
		}
		definition, err := s.bindingDefinition(r, id, papiGrantsKind, "")
		if err != nil {
			return err
		}
		rows, err := r.PAPIGrants(id)
		if err != nil {
			return err
		}
		items, err := s.papiGrantViews(rows, q)
		if err != nil {
			return err
		}
		start := min((q.Page-1)*q.PageSize, len(items))
		out.Data = items[start:min(start+q.PageSize, len(items))]
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: len(items)}
		out.Tag = s.tag(papiGrantsKind, id, definition.RowVersion)
		return nil
	})
}

func (s *Service) papiGrantViews(grants []PAPIGrantRow, q Query) ([]papiGrantView, error) {
	byCode := make(map[string]PAPIGrantRow, len(grants))
	codes := s.PAPI.Codes()
	for _, grant := range grants {
		byCode[grant.Code] = grant
		if s.PAPI.Operation(grant.Code) == nil {
			codes = append(codes, grant.Code)
		}
	}
	slices.Sort(codes)
	search := strings.ToLower(q.Q)
	items := []papiGrantView{}
	for _, code := range codes {
		grant, granted := byCode[code]
		if q.Enabled != nil && *q.Enabled != granted {
			continue
		}
		op := s.PAPI.Operation(code)
		item := papiGrantView{Code: code, Title: code, Granted: granted, Constraints: json.RawMessage(`{}`)}
		if op != nil {
			if !op.Matches(search) {
				continue
			}
			item.Title, item.Summary, item.Effect, item.Available = op.Title, op.Summary, op.Effect, true
		} else if !strings.Contains(code, search) {
			continue
		}
		if granted {
			var err error
			item.Constraints, err = grant.constraints()
			if err != nil {
				return nil, err
			}
		}
		item.ConstraintsText = string(item.Constraints)
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) PutPAPIGrant(ctx context.Context, raw string, id uint64, code, tag string, input PAPIGrantWrite) (*Result, error) {
	return s.changePAPIGrant(ctx, raw, id, code, tag, &input)
}

func (s *Service) DeletePAPIGrant(ctx context.Context, raw string, id uint64, code, tag string) (*Result, error) {
	return s.changePAPIGrant(ctx, raw, id, code, tag, nil)
}

func (s *Service) changePAPIGrant(ctx context.Context, raw string, id uint64, code, tag string, input *PAPIGrantWrite) (*Result, error) {
	return s.access(ctx, raw, true, func(tx identity.Tx, r Repository, auth *identity.Auth, out *Result) error {
		if !papi.ValidCode(code) {
			return httpx.Invalid("api_code", "invalid_format")
		}
		if tag == "" {
			return checkTag(tag, "")
		}
		definition, err := s.bindingDefinition(r, id, papiGrantsKind, tag)
		if err != nil {
			return err
		}
		current, err := r.PAPIGrant(id, code)
		if err != nil {
			return err
		}
		action, err := s.writePAPIGrant(r, id, code, current, input)
		if err != nil {
			return err
		}
		if action != "" {
			if err = advanceBindingVersion(r, definition); err != nil {
				return err
			}
			detail, err := json.Marshal(map[string]string{"api_code": code})
			if err != nil {
				return err
			}
			if err = auditDetail(ctx, tx, auth, "agent.papi_grant."+action, "agent", id, detail); err != nil {
				return err
			}
		}
		out.Tag = s.tag(papiGrantsKind, id, definition.RowVersion)
		out.Status = 204
		return nil
	})
}

func (s *Service) writePAPIGrant(r Repository, id uint64, code string, current *PAPIGrantRow, input *PAPIGrantWrite) (string, error) {
	if input == nil {
		if current == nil {
			return "", nil
		}
		return "revoke", r.DeletePAPIGrant(id, code)
	}
	if s.PAPI.Operation(code) == nil {
		return "", httpx.Invalid("api_code", "unknown")
	}
	constraints, err := papi.ParseConstraints(input.Constraints)
	if err != nil {
		return "", httpx.Invalid("parameter_constraints", "invalid_schema")
	}
	stored, err := json.Marshal(storedPAPIConstraints{ArgsSchema: string(constraints.ArgsSchema)})
	if err != nil {
		return "", err
	}
	action := "grant"
	if current != nil {
		if semanticSame(current.Constraints, json.RawMessage(stored)) {
			return "", nil
		}
		action = "update"
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	return action, r.PutPAPIGrant(PAPIGrantRow{AgentID: id, Code: code, Constraints: stored, CreatedAt: now, UpdatedAt: now})
}
