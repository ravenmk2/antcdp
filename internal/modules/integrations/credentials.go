package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func expiry(f Field[time.Time], target **time.Time) error {
	if !f.Set {
		return nil
	}
	if f.Null {
		*target = nil
		return nil
	}
	if f.Value.Year() < 1000 || f.Value.Year() > 9999 {
		return httpx.Invalid("expires_at", "invalid_format")
	}
	value := f.Value.UTC().Truncate(time.Millisecond)
	*target = &value
	return nil
}
func (s *Service) Credentials(ctx context.Context, raw string, id, cid uint64, owner CredentialOwnership, op, tag, collectionTag string, input any, meta identity.Metadata) (Result, *identity.Auth, error) {
	out := Result{}
	write := op != "list" && op != "get" && op != "diagnostics" && op != "get_preferred"
	a, err := s.access(ctx, raw, owner, id, write, func(tx identity.Tx, r Repository, a *identity.Auth, v *ServiceConnection, owner CredentialOwnership) error {
		if op == "list" {
			rows, err := r.Credentials(id, owner)
			if err != nil {
				return err
			}
			for j := range rows {
				if !owned(&rows[j], v, owner) {
					return integrity()
				}
				s.credentialResult(&rows[j])
			}
			tag := s.collectionTag(v, owner)
			out = Result{Data: map[string]any{"items": rows, "mutation_version": unquote(tag)}, Tag: tag}
			return nil
		}
		if op == "get_preferred" || op == "preferred" || op == "clear_preferred" {
			rows, err := r.Credentials(id, owner)
			if err != nil {
				return err
			}
			var current *uint64
			for j := range rows {
				if !owned(&rows[j], v, owner) {
					return integrity()
				}
				if rows[j].Preferred {
					if current != nil {
						return integrity()
					}
					value := rows[j].ID
					current = &value
				}
			}
			if op == "get_preferred" {
				out = selection(current, s.preferredTag(v, owner))
				return nil
			}
			if err = check(tag, s.preferredTag(v, owner)); err != nil {
				return err
			}
			var target *uint64
			var cr *ServiceCredential
			if op == "preferred" {
				cid, err := c.ID(input.(SelectionWrite).CredentialID)
				if err != nil {
					return err
				}
				cr, err = r.Credential(cid)
				if err != nil {
					return err
				}
				if !owned(cr, v, owner) {
					return fail()
				}
				if !cr.Usable() {
					return unavailable()
				}
				target = &cid
			}
			if !sameID(current, target) {
				// Clear before setting, preserving the unique preferred slot throughout the transaction.
				for j := range rows {
					if rows[j].Preferred {
						rows[j].Preferred = false
						rows[j].Version++
						if err = r.SaveCredential(&rows[j]); err != nil {
							return err
						}
					}
				}
				if target != nil {
					cr.Preferred = true
					cr.Version++
					if err = r.SaveCredential(cr); err != nil {
						return err
					}
				}
				v.CredentialsVersion++
				if err = r.SaveConnection(v); err != nil {
					return err
				}
				if err = audit(tx, a, "service_credential", id, "访问凭证首选", "preferred_changed", map[string]any{"ownership_type": owner.Type}, meta); err != nil {
					return err
				}
			}
			out = selection(target, s.preferredTag(v, owner))
			out.CollectionTag = s.collectionTag(v, owner)
			return nil
		}
		var cr *ServiceCredential
		if cid != 0 {
			var err error
			cr, err = r.Credential(cid)
			if err != nil {
				return err
			}
			if !owned(cr, v, owner) {
				return fail()
			}
			out = s.credentialResult(cr)
			if write {
				if err = check(tag, s.credentialTag(cr)); err != nil {
					return err
				}
			}
		}
		action := ""
		switch op {
		case "get":
			return nil
		case "diagnostics":
			raw, err := r.Diagnostics("credential", cid)
			if err != nil {
				return err
			}
			d, err := diagnosticView(raw, v.Version, v.ConfigVersion, cr.Version, cr.MaterialVersion, 0)
			out = Result{Data: map[string]any{"latest": d}}
			return err
		case "create":
			if err := check(tag, s.collectionTag(v, owner)); err != nil {
				return err
			}
			w := input.(CredentialCreate)
			if err := validateAuthentication(w.Authentication); err != nil {
				return err
			}
			code, err := codeValue(w.Code)
			if err != nil {
				return err
			}
			cr = &ServiceCredential{ConnectionID: id, Type: v.Type, Code: code, Ownership: owner.Type, Name: strings.TrimSpace(w.Name), Enabled: true, AuthMethod: w.Authentication.Method, AuthSchemaVersion: 1, Identity: json.RawMessage(`{}`), Version: 1, MaterialVersion: 1, Creator: a.User.ID}
			if err = applyCommon(CommonWrite{Description: w.Description}, &cr.Name, &cr.Description, &cr.Enabled); err != nil {
				return err
			}
			if err = expiry(w.ExpiresAt, &cr.ExpiresAt); err != nil {
				return err
			}
			if owner.Type == "project" {
				cr.ProjectID = &owner.Owner
			}
			if owner.Type == "personal" {
				cr.UserID = &owner.Owner
			}
			if err = r.InsertCredential(cr); err != nil {
				return err
			}
			sealed, err := s.Cipher(purpose("credential", id, cr.ID, cr.AuthMethod), w.Authentication.Secret.Token, true)
			if err != nil {
				return err
			}
			if err = r.SetSecret("credential", cr.ID, sealed); err != nil {
				return err
			}
			cr.HasSecret = true
			action = "created"
		case "update":
			w := input.(CredentialWrite)
			if emptyCommon(w.CommonWrite) && !w.ExpiresAt.Set {
				return httpx.Invalid("body", "empty_patch")
			}
			before, _ := json.Marshal(cr)
			if err := applyCommon(w.CommonWrite, &cr.Name, &cr.Description, &cr.Enabled); err != nil {
				return err
			}
			if err := expiry(w.ExpiresAt, &cr.ExpiresAt); err != nil {
				return err
			}
			after, _ := json.Marshal(cr)
			if bytes.Equal(before, after) {
				out.CollectionTag = s.collectionTag(v, owner)
				return nil
			}
			cr.Version++
			if !cr.Enabled {
				cr.Preferred = false
				clearFallback(v, cid)
			}
			if err := r.SaveCredential(cr); err != nil {
				return err
			}
			action = "updated"
		case "authentication":
			w := input.(Authentication)
			if err := validateAuthentication(&w); err != nil {
				return err
			}
			sealed, err := s.Cipher(purpose("credential", id, cid, w.Method), w.Secret.Token, true)
			if err != nil {
				return err
			}
			if err = r.SetSecret("credential", cid, sealed); err != nil {
				return err
			}
			cr.AuthMethod = w.Method
			cr.AuthSchemaVersion = 1
			cr.Identity = json.RawMessage(`{}`)
			cr.HasSecret = true
			cr.Version++
			cr.MaterialVersion++
			if err = r.SaveCredential(cr); err != nil {
				return err
			}
			action = "authentication_replaced"
		case "delete":
			if err := check(collectionTag, s.collectionTag(v, owner)); err != nil {
				return err
			}
			clearFallback(v, cid)
			if err := r.DeleteCredential(cid); err != nil {
				return err
			}
			action = "deleted"
		default:
			return fail()
		}
		v.CredentialsVersion++
		if err := r.SaveConnection(v); err != nil {
			return err
		}
		out = Result{}
		if op != "delete" {
			out = s.credentialResult(cr)
		}
		out.CollectionTag = s.collectionTag(v, owner)
		if op == "create" {
			out.Location = fmt.Sprint(cr.ID)
		} // server expands against the authorized collection path
		return audit(tx, a, "service_credential", cr.ID, cr.Name, action, map[string]any{"ownership_type": owner.Type, "enabled": cr.Enabled}, meta)
	})
	return out, a, err
}
func clearFallback(v *ServiceConnection, id uint64) {
	if sameID(v.FallbackID, &id) {
		v.FallbackID = nil
		v.FallbackVersion++
	}
}
