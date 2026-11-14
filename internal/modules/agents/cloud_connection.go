package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *CloudService) cloudAccess(ctx context.Context, raw string, admin bool, fn func(identity.Tx, Repository, StateRepository, CloudRepository, *identity.Auth, *Result) error) (*Result, error) {
	return s.Host.access(ctx, raw, admin, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		cr, e := CloudStateFor(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, st, cr, a, out)
	})
}
func (s *CloudService) cloudBackground(ctx context.Context, fn func(identity.Tx, Repository, StateRepository, CloudRepository) error) error {
	return s.Host.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		cr, e := CloudStateFor(tx)
		if e != nil {
			return e
		}
		return fn(tx, r, st, cr)
	})
}
func (s *CloudService) cloudCommand(ctx context.Context, raw, key, command, scope string, input any, fn func(identity.Tx, Repository, StateRepository, CloudRepository, *identity.Auth, *Result, *Receipt) error) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(tx identity.Tx, r Repository, st StateRepository, cr CloudRepository, a *identity.Auth, out *Result) error {
		if !keyPattern.MatchString(key) {
			return httpx.Invalid("Idempotency-Key", "invalid_format")
		}
		body, e := agentcore.CanonicalJSON(input)
		if e != nil {
			return e
		}
		digest := sha256.Sum256([]byte(s.Host.ETag("cloud/request/" + string(body))))
		kind, id := splitScope(scope)
		receipt, e := r.Receipt(idString(a.User.ID), kind, id, command, key)
		if e != nil {
			return e
		}
		if receipt != nil {
			if !hmac.Equal(receipt.Hash, digest[:]) {
				return httpx.E(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求")
			}
			var saved savedResult
			if json.Unmarshal(receipt.Result, &saved) != nil {
				return integrity()
			}
			out.Data, out.Tag, out.Location, out.Status, out.Replayed = saved.Data, saved.Tag, saved.Location, receipt.ResponseStatus, true
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		receipt = &Receipt{ActorKind: "user", ActorID: idString(a.User.ID), ScopeKind: kind, ScopeID: id, Command: command, Key: key, Hash: digest[:], Status: "pending", Result: json.RawMessage(`{}`), CreatedAt: now}
		if e = r.InsertReceipt(receipt); e != nil {
			return e
		}
		if e = fn(tx, r, st, cr, a, out, receipt); e != nil {
			return e
		}
		data, e := json.Marshal(out.Data)
		if e != nil {
			return e
		}
		receipt.Result, e = json.Marshal(savedResult{data, out.Tag, out.Location})
		if e != nil {
			return e
		}
		receipt.Status, receipt.ResponseStatus, receipt.CompletedAt = "completed", out.Status, &now
		if e = r.SaveReceipt(receipt); e != nil {
			return e
		}
		target := uint64(0)
		if receipt.TargetID != nil {
			target = *receipt.TargetID
		}
		return audit(ctx, tx, a, command, kind, target)
	})
}

func normalizeConnection(w *ConnectionWrite) error {
	w.Endpoint = strings.TrimRight(strings.TrimSpace(w.Endpoint), "/")
	if w.Endpoint != "" {
		u, e := url.Parse(w.Endpoint)
		if e != nil || u == nil || len(w.Endpoint) > 2048 || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || (u.Scheme != "http" && u.Scheme != "https") || strings.ContainsAny(w.Endpoint, "\r\n\x00\\") {
			return httpx.Invalid("endpoint", "invalid_url")
		}
		if u.Port() != "" {
			n, e := strconv.Atoi(u.Port())
			if e != nil || n < 1 || n > 65535 {
				return httpx.Invalid("endpoint", "invalid_url")
			}
		}
	}
	if w.AccessMode == "" {
		w.AccessMode = "direct"
	}
	if w.AccessMode != "direct" && w.AccessMode != "server_proxy" {
		return httpx.Invalid("access_mode", "unsupported")
	}
	if w.ConnectTimeout == 0 {
		w.ConnectTimeout = 10
	}
	if w.OperationTimeout == 0 {
		w.OperationTimeout = 300
	}
	if w.ConnectTimeout < 1 || w.ConnectTimeout > 30 || w.OperationTimeout < 10 || w.OperationTimeout > 600 {
		return httpx.Invalid("timeout", "out_of_range")
	}
	return nil
}
func (s *CloudService) connectionSecret(row *SandboxConnectionRow, w *models.AuthenticationWrite) error {
	if w == nil {
		return nil
	}
	if w.Method != "api_key" {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	switch w.Secret.Operation {
	case "keep":
		if w.Secret.Value != nil {
			return httpx.Invalid("authentication.secret", "unexpected_value")
		}
		return nil
	case "clear":
		if w.Secret.Value != nil {
			return httpx.Invalid("authentication.secret", "unexpected_value")
		}
		row.SecretCiphertext, row.SecretFormatVersion, row.SecretKeyVersion = nil, nil, nil
	case "replace":
		if w.Secret.Value == nil || len(*w.Secret.Value) < 1 || len(*w.Secret.Value) > 8192 || strings.ContainsAny(*w.Secret.Value, "\r\n\x00") {
			return httpx.Invalid("authentication.secret", "invalid_value")
		}
		if s.Cipher == nil {
			return unavailable()
		}
		value, e := s.Cipher("sandboxes/connection/authentication", *w.Secret.Value, true)
		if e != nil {
			return e
		}
		version, key := uint64(2), "v1"
		row.SecretCiphertext, row.SecretFormatVersion, row.SecretKeyVersion = []byte(value), &version, &key
	default:
		return httpx.Invalid("authentication.secret.operation", "unsupported")
	}
	row.SecretRevision++
	return nil
}
func (s *CloudService) connectionView(row *SandboxConnectionRow) ConnectionView {
	caps := unknownSandboxCapabilities()
	var diagnostic struct {
		Version uint64 `json:"config_version,string"`
	}
	if json.Unmarshal(row.LastDiagnostic, &diagnostic) == nil && diagnostic.Version == row.ConfigVersion {
		_ = json.Unmarshal(row.VerifiedCapabilities, &caps)
	}
	return ConnectionView{Endpoint: row.Endpoint, AccessMode: row.AccessMode, ConnectTimeout: row.ConnectTimeout, OperationTimeout: row.OperationTimeout, Authentication: models.Authentication{Method: "api_key", HasSecret: len(row.SecretCiphertext) > 0}, BackendGeneration: row.BackendGeneration, MaintenanceState: row.MaintenanceState, Capabilities: caps, LastDiagnostic: row.LastDiagnostic, LastDiagnosticAt: row.LastDiagnosticAt, Version: strings.Trim(s.Host.tag("sandbox-connection", 1, row.RowVersion), `"`)}
}
func (s *CloudService) GetConnection(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		row, e := cr.Connection(false)
		if e != nil {
			return e
		}
		if row == nil {
			return integrity()
		}
		out.Tag = s.Host.tag("sandbox-connection", 1, row.RowVersion)
		out.Data = s.connectionView(row)
		return nil
	})
}

type connectionConfirmation struct {
	Config, Backend, Topology uint64
	Count                     int
	Target                    string
	Expires                   int64
}

func (s *CloudService) connectionTarget(w ConnectionWrite) string {
	w.ConfirmationToken = ""
	b, _ := agentcore.CanonicalJSON(w)
	h := sha256.Sum256([]byte(s.Host.ETag("sandbox/change/" + string(b))))
	return hex.EncodeToString(h[:])
}
func (s *CloudService) PreviewConnection(ctx context.Context, raw string, w ConnectionWrite) (*Result, error) {
	if e := normalizeConnection(&w); e != nil {
		return nil, e
	}
	var target CloudConnection
	out, err := s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, cr CloudRepository, _ *identity.Auth, out *Result) error {
		row, e := cr.Connection(true)
		if e != nil {
			return e
		}
		if row == nil {
			return integrity()
		}
		if e = s.connectionSecret(row, w.Authentication); e != nil {
			return e
		}
		if w.Endpoint != "" {
			candidate := *row
			candidate.Endpoint = &w.Endpoint
			candidate.AccessMode, candidate.ConnectTimeout, candidate.OperationTimeout = w.AccessMode, w.ConnectTimeout, w.OperationTimeout
			target, e = s.runtimeConnection(&candidate)
			if e != nil {
				return e
			}
		}
		count, busy, e := cr.CloudTopology()
		if e != nil {
			return e
		}
		if w.Endpoint == "" && count > 0 {
			return httpx.E(409, "CLOUD_RESOURCES_EXIST", "永久删除所有云电脑后才能清除连接")
		}
		claims := connectionConfirmation{Config: row.ConfigVersion, Backend: row.BackendGeneration, Topology: row.TopologyVersion, Count: count, Target: s.connectionTarget(w), Expires: time.Now().Add(5 * time.Minute).Unix()}
		b, _ := json.Marshal(claims)
		payload := base64.RawURLEncoding.EncodeToString(b)
		token := payload + "." + base64.RawURLEncoding.EncodeToString([]byte(s.Host.ETag("sandbox-confirm/"+payload)))
		out.Data = map[string]any{"confirmation_token": token, "affected_computers": count, "busy_activities": busy, "expires_at": time.Unix(claims.Expires, 0).UTC(), "resets_storage": row.Endpoint != nil && *row.Endpoint != w.Endpoint}
		return nil
	})
	if err != nil || w.Endpoint == "" {
		return out, err
	}
	// No database locks or remote mutations are held during the connectivity
	// check. The signed preview is still fenced against changes at commit time.
	bounded, cancel := context.WithTimeout(ctx, target.ConnectTimeout+10*time.Second)
	defer cancel()
	provider, err := s.openProvider(bounded, target)
	if err != nil {
		return nil, err
	}
	if err = provider.Health(bounded, nil); err != nil {
		return nil, sandboxFailure(err)
	}
	return out, nil
}
func (s *CloudService) verifyConnectionConfirmation(row *SandboxConnectionRow, w ConnectionWrite, count int) error {
	parts := strings.Split(w.ConfirmationToken, ".")
	if len(parts) != 2 {
		return httpx.E(409, "CONNECTION_CONFIRMATION_REQUIRED", "请先查看影响范围并确认更换服务地址")
	}
	mac, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || !hmac.Equal(mac, []byte(s.Host.ETag("sandbox-confirm/"+parts[0]))) {
		return httpx.E(409, "CONNECTION_CONFIRMATION_INVALID", "确认已失效，请重新查看影响范围")
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	var v connectionConfirmation
	if e != nil || json.Unmarshal(b, &v) != nil || v.Config != row.ConfigVersion || v.Backend != row.BackendGeneration || v.Topology != row.TopologyVersion || v.Count != count || v.Target != s.connectionTarget(w) || v.Expires < time.Now().Unix() {
		return httpx.E(409, "CONNECTION_CONFIRMATION_INVALID", "配置或云电脑范围已变化，请重新确认")
	}
	return nil
}
func (s *CloudService) SaveConnection(ctx context.Context, raw, tag, key string, w ConnectionWrite) (*Result, error) {
	if e := normalizeConnection(&w); e != nil {
		return nil, e
	}
	return s.cloudCommand(ctx, raw, key, "sandbox_connection.update", "sandbox_connection", w, func(_ identity.Tx, _ Repository, st StateRepository, cr CloudRepository, a *identity.Auth, out *Result, _ *Receipt) error {
		row, e := cr.Connection(true)
		if e != nil {
			return e
		}
		if row == nil {
			return integrity()
		}
		if e = checkTag(tag, s.Host.tag("sandbox-connection", 1, row.RowVersion)); e != nil {
			return e
		}
		old := ""
		if row.Endpoint != nil {
			old = *row.Endpoint
		}
		changed := old != w.Endpoint
		now := time.Now().UTC().Truncate(time.Millisecond)
		if changed {
			count, busy, e := cr.CloudTopology()
			if e != nil {
				return e
			}
			if w.Endpoint == "" && count > 0 {
				return httpx.E(409, "CLOUD_RESOURCES_EXIST", "永久删除所有云电脑后才能清除连接")
			}
			if old != "" {
				if e = s.verifyConnectionConfirmation(row, w, count); e != nil {
					return e
				}
				if busy > 0 {
					return httpx.E(409, "CLOUD_COMPUTERS_BUSY", "仍有在途或结果未确认的活动，请等待收尾后重试")
				}
				row.MaintenanceState = "resetting"
				if e = cr.SaveConnection(row); e != nil {
					return e
				}
				row.BackendGeneration++
				if e = cr.ResetCloudResources(row.BackendGeneration, now); e != nil {
					return e
				}
				sessions, e := cr.CloudResetSessions()
				if e != nil {
					return e
				}
				for i := range sessions {
					receipt, e := cancelSessionQueue(st, &sessions[i], "SANDBOX_BACKEND_CHANGED", now)
					if e != nil {
						return e
					}
					out.Commits = append(out.Commits, receipt)
				}
			}
		}
		if e = s.connectionSecret(row, w.Authentication); e != nil {
			return e
		}
		if w.Endpoint != "" && len(row.SecretCiphertext) == 0 {
			return httpx.Invalid("authentication.secret", "required")
		}
		row.Endpoint = nil
		if w.Endpoint != "" {
			row.Endpoint = &w.Endpoint
		}
		row.AccessMode, row.ConnectTimeout, row.OperationTimeout = w.AccessMode, w.ConnectTimeout, w.OperationTimeout
		row.ConfigVersion++
		row.RowVersion++
		row.UpdatedAt = now
		row.UpdatedByUserID = &a.User.ID
		row.MaintenanceState = "normal"
		if e = cr.SaveConnection(row); e != nil {
			return e
		}
		out.Tag = s.Host.tag("sandbox-connection", 1, row.RowVersion)
		out.Data = s.connectionView(row)
		return nil
	})
}
