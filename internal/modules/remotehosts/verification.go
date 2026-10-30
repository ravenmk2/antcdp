package remotehosts

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

var outboundSlots = make(chan struct{}, 8)

type Diagnostic struct {
	ID         string         `json:"id"`
	Kind       string         `json:"kind"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt time.Time      `json:"finished_at"`
	Status     string         `json:"status"`
	Outdated   bool           `json:"outdated"`
	Summary    map[string]any `json:"summary"`
}
type storedDiagnostic struct {
	Diagnostic
	ConnectionVersion uint64 `json:"connection_version"`
	ConfigVersion     uint64 `json:"config_version"`
	CredentialVersion uint64 `json:"credential_version"`
	MaterialVersion   uint64 `json:"material_version"`
	WebhookVersion    uint64 `json:"webhook_version"`
}

func diagnosticView(raw json.RawMessage, connection, config, credential, material, webhook uint64) (*Diagnostic, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var d storedDiagnostic
	if json.Unmarshal(raw, &d) != nil || d.ID == "" {
		return nil, integrity()
	}
	d.Outdated = d.ConnectionVersion != connection || d.ConfigVersion != config || d.CredentialVersion != credential || d.MaterialVersion != material || d.WebhookVersion != webhook
	return &d.Diagnostic, nil
}
func newDiagnostic(kind string, started time.Time) Diagnostic {
	id, _ := newCredentialCode()
	return Diagnostic{ID: id, Kind: kind, StartedAt: started.UTC().Truncate(time.Millisecond), FinishedAt: time.Now().UTC().Truncate(time.Millisecond), Summary: map[string]any{}}
}
func saveDiagnostic(r Repository, kind string, id uint64, d storedDiagnostic) error {
	previous, err := r.Diagnostics(kind, id)
	if err != nil {
		return err
	}
	if len(previous) > 0 {
		var old storedDiagnostic
		if json.Unmarshal(previous, &old) != nil {
			return integrity()
		}
		same := old.ConnectionVersion == d.ConnectionVersion && old.ConfigVersion == d.ConfigVersion && old.CredentialVersion == d.CredentialVersion && old.MaterialVersion == d.MaterialVersion && old.WebhookVersion == d.WebhookVersion
		if same && (old.StartedAt.After(d.StartedAt) || old.StartedAt.Equal(d.StartedAt) && old.ID > d.ID) {
			return nil
		}
	}
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return r.SaveDiagnostics(kind, id, data)
}
func (s *Service) Verify(ctx context.Context, raw string, id, cid uint64, owner CredentialOwnership, tag string, meta ...identity.Metadata) (Result, *identity.Auth, error) {
	select {
	case outboundSlots <- struct{}{}:
		defer func() { <-outboundSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "外部验证繁忙，请稍后重试")
	}
	var g Config
	var token, username string
	snapshot := storedDiagnostic{}
	a, err := s.access(ctx, raw, owner, id, true, func(_ identity.Tx, r Repository, _ *identity.Auth, v *Host, owner CredentialOwnership) error {
		if !v.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "远程主机已停用")
		}
		snapshot.ConnectionVersion = v.Version
		snapshot.ConfigVersion = v.ConfigVersion
		g = v.Config
		if cid == 0 {
			return check(tag, s.connectionTag(v))
		}
		cr, err := r.Credential(cid)
		if err != nil {
			return err
		}
		if !owned(cr, v, owner) {
			return fail()
		}
		if err = check(tag, s.credentialTag(cr)); err != nil {
			return err
		}
		if !cr.Usable() {
			return unavailable()
		}
		snapshot.CredentialVersion = cr.Version
		snapshot.MaterialVersion = cr.MaterialVersion
		var identity struct {
			Username string `json:"username"`
		}
		if err := json.Unmarshal(cr.Identity, &identity); err != nil {
			return integrity()
		}
		username = identity.Username
		sealed, err := r.Secret("credential", cid)
		if err != nil {
			return err
		}
		binding := credentialPurpose(v.Type, "credential", id, cid, cr.AuthMethod)
		// Version 1 was written before the module split. IDs and AAD remain unchanged.
		if cr.SecretFormat == 1 {
			binding = fmt.Sprintf("service-integrations/ssh/credential/%d/%d/%s/v1", id, cid, cr.AuthMethod)
		}
		token, err = s.Cipher(binding, sealed, false)
		return err
	})
	if err != nil {
		return Result{}, a, err
	}
	if s.Probe != nil {
		snapshot.Diagnostic = s.Probe(ctx, &g, token, time.Now().UTC())
	} else {
		snapshot.Diagnostic = adapters[s.serviceType()].probe(ctx, &g, username, token, time.Now().UTC())
	}
	var out Result
	a, err = s.access(ctx, raw, owner, id, true, func(tx identity.Tx, r Repository, actor *identity.Auth, v *Host, owner CredentialOwnership) error {
		if !v.Enabled || v.Version != snapshot.ConnectionVersion || v.ConfigVersion != snapshot.ConfigVersion {
			return changedState()
		}
		kind, target := "connection", id
		if cid != 0 {
			cr, err := r.Credential(cid)
			if err != nil {
				return err
			}
			if !owned(cr, v, owner) {
				return fail()
			}
			if !cr.Usable() || cr.Version != snapshot.CredentialVersion || cr.MaterialVersion != snapshot.MaterialVersion {
				return changedState()
			}
			kind, target = "credential", cid
		}
		if err := saveDiagnostic(r, kind, target, snapshot); err != nil {
			return err
		}
		out = Result{Data: snapshot.Diagnostic}
		if s.serviceType() == "ssh" {
			var m identity.Metadata
			if len(meta) > 0 {
				m = meta[0]
			}
			targetKind := "remote_host"
			if cid != 0 {
				targetKind = "ssh_credential"
			}
			return s.audit(tx, actor, targetKind, target, v.Name, "verified", map[string]any{"enabled": v.Enabled}, m)
		}
		return nil
	})
	return out, a, err
}
