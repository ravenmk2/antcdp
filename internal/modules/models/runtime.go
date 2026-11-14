package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// RuntimeModel is an internal, non-secret view. Its caller must authorize the
// actual runtime subject; this does not grant an HTTP user model access.
type RuntimeModel struct {
	ProviderID     uint64
	DefinitionID   uint64
	ProviderType   string
	ProviderName   string
	Name           string
	Protocol       string
	RemoteModelID  string
	Config         Config
	IdentityConfig json.RawMessage
	AuthMethod     string
	Capabilities   Capabilities
	Thinking       []ThinkingOption
	Parameters     json.RawMessage
	ContextWindow  uint64
	MaxOutput      uint64
	Available      bool
}

// RuntimeRoute freezes the non-secret identity used by a locked conversation.
// Parameters belong to the request, not to credential lookup.
// The persisted wire names are stable: changing them would invalidate route hashes.
type RuntimeRoute struct {
	ProviderID     uint64          `json:"provider_id,string"`
	DefinitionID   uint64          `json:"model_id,string"`
	ProviderType   string          `json:"provider_type"`
	Protocol       string          `json:"protocol"`
	RemoteModelID  string          `json:"remote_model_id"`
	Config         Config          `json:"config"`
	IdentityConfig json.RawMessage `json:"identity_config"`
	AuthMethod     string          `json:"auth_method"`
}

func (v RuntimeModel) Route() RuntimeRoute {
	return RuntimeRoute{v.ProviderID, v.DefinitionID, v.ProviderType, v.Protocol, v.RemoteModelID, v.Config, v.IdentityConfig, v.AuthMethod}
}

// ReadRuntimeModel locks provider before definition, sharing the delete/binding
// lock order. It must be called inside the host's authorized short transaction.
func (s *Service) ReadRuntimeModel(tx identity.Tx, id uint64) (*RuntimeModel, error) {
	values, err := s.ReadRuntimeModels(tx, []uint64{id})
	if err != nil {
		return nil, err
	}
	return values[id], nil
}

// ReadRuntimeModels establishes one global parent lock order for full binding
// replacement. Calling single-model reads in user supplied order can deadlock.
func (s *Service) ReadRuntimeModels(tx identity.Tx, ids []uint64) (map[uint64]*RuntimeModel, error) {
	r, err := repository(tx)
	if err != nil {
		return nil, err
	}
	ids = slices.Clone(ids)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	providerIDs := []uint64{}
	parents := map[uint64]uint64{}
	for _, id := range ids {
		d, e := r.Definition(id, false)
		if e != nil {
			return nil, e
		}
		if d == nil {
			return nil, missing()
		}
		parents[id] = d.ProviderID
		providerIDs = append(providerIDs, d.ProviderID)
	}
	slices.Sort(providerIDs)
	providerIDs = slices.Compact(providerIDs)
	providers := map[uint64]*Provider{}
	for _, id := range providerIDs {
		p, e := r.Provider(id)
		if e != nil {
			return nil, e
		}
		if e = s.provider(p); e != nil {
			return nil, e
		}
		providers[id] = p
	}
	values := map[uint64]*RuntimeModel{}
	for _, id := range ids {
		d, e := r.Definition(id, true)
		if e != nil {
			return nil, e
		}
		if e = s.definition(d); e != nil {
			return nil, e
		}
		if d.ProviderID != parents[id] {
			return nil, integrity()
		}
		p := providers[d.ProviderID]
		values[id] = &RuntimeModel{ProviderID: p.ID, DefinitionID: d.ID, ProviderType: p.Type, ProviderName: p.Name, Name: d.Name, Protocol: d.Protocol, RemoteModelID: d.RemoteModelID, Config: p.Config, IdentityConfig: p.IdentityConfig, AuthMethod: p.AuthMethod, Capabilities: d.Capabilities, Thinking: d.Thinking, Parameters: d.Parameters, ContextWindow: d.ContextWindow, MaxOutput: d.MaxOutput, Available: p.Enabled && d.Enabled && (p.AuthMethod == "none" || p.HasSecret)}
	}
	return values, nil
}

// RuntimeHash canonicalizes typed facts; no broad configuration revision or
// credential version participates, so a same-identity key rotation is harmless.
func RuntimeHash(value any) (string, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

// OpenRuntimeClient only obtains the current key for the frozen remote identity.
// The factory runs after the database transaction and must not retain plaintext
// in persisted diagnostics. The host reauthorizes its subject before calling.
func (s *Service) OpenRuntimeClient(ctx context.Context, frozen RuntimeRoute, factory func(RuntimeRoute, string) (modelcore.Client, error)) (modelcore.Client, error) {
	if s.Store == nil || factory == nil {
		return nil, unavailable()
	}
	store, err := s.Store()
	if err != nil {
		return nil, err
	}
	var secret string
	err = store.Transact(ctx, func(tx identity.Tx) error {
		v, e := s.ReadRuntimeModel(tx, frozen.DefinitionID)
		if e != nil {
			return e
		}
		if v == nil {
			return unavailable()
		}
		current := v.Route()
		// The model selection belongs to the turn. Changes to its catalog
		// label, remote model ID or protocol do not replace that selection.
		current.RemoteModelID, current.Protocol = frozen.RemoteModelID, frozen.Protocol
		// Timeouts are frozen request behavior, not credential identity. Endpoint,
		// CA, region and auth method must still refer to the original identity.
		current.Config.ConnectTimeout = frozen.Config.ConnectTimeout
		current.Config.RequestTimeout = frozen.Config.RequestTimeout
		a, e := RuntimeHash(current)
		if e != nil {
			return e
		}
		b, e := RuntimeHash(frozen)
		if e != nil {
			return e
		}
		if a != b {
			return unavailable()
		}
		if v.AuthMethod == "none" {
			return nil
		}
		if s.Cipher == nil {
			return unavailable()
		}
		r, e := repository(tx)
		if e != nil {
			return e
		}
		cipher, e := r.Secret(v.ProviderID)
		if e != nil {
			return e
		}
		secret, e = s.Cipher(fmt.Sprintf("models/provider/%d/authentication", v.ProviderID), cipher, false)
		return e
	})
	if err != nil {
		return nil, err
	}
	return factory(frozen, secret)
}
