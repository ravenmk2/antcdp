package integrations

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/credentials"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type CatalogCreate struct {
	Code Field[string] `json:"code"`
	Kind string        `json:"kind"`
	CatalogEdit
}
type CatalogEdit struct {
	CommonWrite
	ExpiresAt  Field[time.Time]      `json:"expires_at"`
	Identifier Field[string]         `json:"identifier"`
	Material   *credentials.Material `json:"material"`
}

func (s *Service) Catalog(ctx context.Context, raw string, scope CredentialOwnership, id uint64, op, tag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	var out Result
	a, err := s.access(ctx, raw, scope, 0, op != "list" && op != "get", func(tx identity.Tx, _ Repository, actor *identity.Auth, _ *ServiceConnection, scope CredentialOwnership) error {
		r, ok := tx.(credentials.Repository)
		if !ok {
			return integrity()
		}
		if op == "list" {
			rows, e := r.Entries(scope)
			if e != nil {
				return e
			}
			for i := range rows {
				rows[i].EditVersion = unquote(rows[i].Tag())
			}
			out.Data = map[string]any{"items": rows}
			return nil
		}
		var entry *credentials.Entry
		var edit CatalogEdit
		if op == "create" {
			w := input.(CatalogCreate)
			code, e := codeValue(w.Code)
			if e != nil {
				return e
			}
			if w.Material == nil {
				return httpx.Invalid("material", "required")
			}
			entry = &credentials.Entry{Code: code, Kind: w.Kind, ScopeKind: scope.Type, ScopeID: scope.Owner, Enabled: true, Version: 1, MaterialVersion: 1, Creator: actor.User.ID}
			edit = w.CatalogEdit
		} else {
			var err error
			entry, err = r.Entry(id)
			if err != nil {
				return err
			}
			if !entry.Owned(scope) {
				return fail()
			}
			if op == "get" {
				out = s.credentialResult(entry)
				return nil
			}
			if err = check(tag, entry.Tag()); err != nil {
				return err
			}
			if op == "delete" {
				if err = r.RemoveEntry(id); err != nil {
					return err
				}
				return audit(tx, actor, "credential", id, entry.Name, "deleted", nil, meta)
			}
			edit = input.(CatalogEdit)
			if emptyCommon(edit.CommonWrite) && !edit.ExpiresAt.Set && edit.Material == nil && !edit.Identifier.Set {
				return httpx.Invalid("body", "empty_patch")
			}
			entry.Version++
		}
		if err := applyCommon(edit.CommonWrite, &entry.Name, &entry.Description, &entry.Enabled); err != nil {
			return err
		}
		if err := expiry(edit.ExpiresAt, &entry.ExpiresAt); err != nil {
			return err
		}
		if edit.Identifier.Set {
			if edit.Identifier.Null || edit.Material == nil {
				return httpx.Invalid("identifier", "material_required")
			}
			entry.Identifier = strings.TrimSpace(edit.Identifier.Value)
		}
		if edit.Material != nil {
			if err := edit.Material.Validate(entry.Kind, entry.Identifier); err != nil {
				return err
			}
		}
		action := "updated"
		if op == "create" {
			if err := r.InsertEntry(entry); err != nil {
				return err
			}
			action = "created"
		} else if edit.Material != nil {
			entry.MaterialVersion++
			action = "rotated"
		}
		if edit.Material != nil {
			data, err := json.Marshal(edit.Material)
			if err != nil {
				return err
			}
			sealed, err := s.CredentialCipher(entry.Purpose(), string(data), true)
			if err != nil {
				return err
			}
			if err = r.StoreMaterial(entry.ID, sealed); err != nil {
				return err
			}
		}
		if op != "create" {
			if err := r.UpdateEntry(entry); err != nil {
				return err
			}
		}
		out = s.credentialResult(entry)
		if op == "create" {
			out.Location = fmt.Sprint(entry.ID)
		}
		return audit(tx, actor, "credential", entry.ID, entry.Name, action, map[string]any{"scope_kind": entry.ScopeKind, "scope_id": entry.ScopeID, "material_version": entry.MaterialVersion}, meta)
	})
	return out, a, err
}
