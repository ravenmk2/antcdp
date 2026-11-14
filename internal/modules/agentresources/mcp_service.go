package agentresources

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtime "github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) mcpView(v *MCPServer) error {
	if json.Unmarshal(v.StoredConfig, &v.Config) != nil {
		return integrity()
	}
	if len(v.LastDiagnostic) > 0 && string(v.LastDiagnostic) != "null" {
		var record MCPDiagnosticRecord
		if json.Unmarshal(v.LastDiagnostic, &record) != nil {
			return integrity()
		}
		record.Diagnostic.Outdated = record.ConfigVersion != v.ConfigVersion || record.SecretRevision != v.SecretRevision
		v.LatestTest = &record.Diagnostic
	}
	v.Authentication = MCPAuthentication{Method: v.AuthMethod, HeaderName: v.AuthHeaderName, HasSecret: v.HasSecret}
	v.Version = strings.Trim(s.tag("mcp_server", v.ID, v.RowVersion), `"`)
	return nil
}
func mcpConfig(c MCPConfig, method string, header *string, secret string) runtime.Config {
	h := ""
	if header != nil {
		h = *header
	}
	return runtime.Config{URL: c.URL, AuthMethod: method, HeaderName: h, Secret: secret, Timeout: time.Duration(c.Timeout) * time.Second, RequestedProtocolVersions: c.ProtocolVersions}
}
func validateMCPConfig(c *MCPConfig) error {
	if c.Timeout == 0 {
		c.Timeout = 60
	}
	if c.Transport == "" {
		c.Transport = "streamable_http"
	}
	if c.Transport != "streamable_http" {
		return httpx.Invalid("config.transport", "unsupported")
	}
	if c.ProtocolVersions == nil {
		c.ProtocolVersions = []string{}
	}
	if e := runtime.ValidateConfig(mcpConfig(*c, "none", nil, "")); e != nil {
		return httpx.Invalid("config", "invalid")
	}
	return nil
}
func mcpStoreConfig(v *MCPServer, c MCPConfig) error {
	raw, e := json.Marshal(c)
	if e != nil {
		return e
	}
	v.Config = c
	v.StoredConfig = raw
	v.URL = c.URL
	v.Timeout = c.Timeout
	v.IdentityConfig, _ = json.Marshal(struct {
		URL    string  `json:"url"`
		Method string  `json:"auth_method"`
		Header *string `json:"header_name"`
	}{c.URL, v.AuthMethod, v.AuthHeaderName})
	return nil
}
func (s *Service) ListMCPServers(ctx context.Context, raw string, q Query) (*Result, error) {
	if e := validateQuery(&q); e != nil {
		return nil, e
	}
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		rows, total, e := repo.MCPServers(q)
		if e != nil {
			return e
		}
		for n := range rows {
			if e = s.mcpView(&rows[n]); e != nil {
				return e
			}
		}
		out.Data = rows
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: total}
		return nil
	})
}
func (s *Service) GetMCPServer(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		v, e := repo.MCPServer(id, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if e = s.mcpView(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("mcp_server", id, v.RowVersion)
		return nil
	})
}
func (s *Service) CreateMCPServer(ctx context.Context, raw, key string, input MCPServerCreate) (*Result, error) {
	return s.command(ctx, raw, key, "mcp_server.create", "mcp_servers", input, func(tx identity.Tx, a *identity.Auth, out *Result, _ uint64) error {
		if e := names(input.Name, input.Description); e != nil {
			return e
		}
		if input.Config == nil || input.Authentication == nil {
			return httpx.Invalid("config", "required")
		}
		config := *input.Config
		if e := validateMCPConfig(&config); e != nil {
			return e
		}
		if input.Enabled.Null || input.Code.Null {
			return httpx.Invalid("enabled", "not_nullable")
		}
		code := input.Code.Value
		if !input.Code.Set {
			var bytes [12]byte
			if _, e := rand.Read(bytes[:]); e != nil {
				return e
			}
			code = "mcp_" + hex.EncodeToString(bytes[:])
		}
		if !codePattern.MatchString(code) {
			return httpx.Invalid("code", "invalid_format")
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		v := &MCPServer{Code: code, Name: strings.TrimSpace(input.Name), Description: input.Description, Enabled: !input.Enabled.Set || input.Enabled.Value, SchemaVersion: 1, SecretRevision: 1, RowVersion: 1, ConfigVersion: 1, Creator: a.User.ID, CreatedAt: now, UpdatedAt: now, LastDiagnostic: json.RawMessage(`null`)}
		if e := validateMCPAuth(*input.Authentication, "", nil, false); e != nil {
			return e
		}
		v.AuthMethod = input.Authentication.Method
		v.AuthHeaderName = input.Authentication.HeaderName
		if e := mcpStoreConfig(v, config); e != nil {
			return e
		}
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		if e = repo.InsertMCPServer(v); e != nil {
			return e
		}
		if e = s.saveMCPAuth(repo, v, *input.Authentication); e != nil {
			return e
		}
		if e = repo.SaveMCPServer(v); e != nil {
			return e
		}
		if e = s.mcpView(v); e != nil {
			return e
		}
		out.Data = v
		out.Status = 201
		out.Tag = s.tag("mcp_server", v.ID, v.RowVersion)
		out.Location = fmt.Sprintf("/api/v1/admin/agents/mcp-servers/%d", v.ID)
		out.TargetKind = "mcp_server"
		out.TargetID = v.ID
		return nil
	})
}
func (s *Service) PatchMCPServer(ctx context.Context, raw string, id uint64, tag string, input MCPServerPatch) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, a *identity.Auth, out *Result) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		v, e := repo.MCPServer(id, true)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("mcp_server", id, v.RowVersion)); e != nil {
			return e
		}
		if e = s.mcpView(v); e != nil {
			return e
		}
		if input.Name.Null || input.Description.Null || input.Enabled.Null || input.Config.Null {
			return httpx.Invalid("body", "not_nullable")
		}
		if !input.Name.Set && !input.Description.Set && !input.Enabled.Set && !input.Config.Set {
			return httpx.Invalid("body", "empty_patch")
		}
		before := *v
		if input.Name.Set {
			v.Name = strings.TrimSpace(input.Name.Value)
		}
		if input.Description.Set {
			v.Description = input.Description.Value
		}
		if input.Enabled.Set {
			v.Enabled = input.Enabled.Value
		}
		if e = names(v.Name, v.Description); e != nil {
			return e
		}
		if input.Config.Set {
			c := input.Config.Value
			if e = validateMCPConfig(&c); e != nil {
				return e
			}
			identityChanged := c.URL != v.Config.URL
			if identityChanged {
				used, e := repo.MCPReferenced(id)
				if e != nil {
					return e
				}
				if used {
					return inUse()
				}
			}
			if !same(c, v.Config) {
				v.ConfigVersion++
				if e = mcpStoreConfig(v, c); e != nil {
					return e
				}
			}
		}
		if !same(before, v) {
			v.RowVersion++
			v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
			if e = repo.SaveMCPServer(v); e != nil {
				return e
			}
			if e = audit(ctx, tx, a, "mcp_server.update", "mcp_server", id); e != nil {
				return e
			}
		}
		if e = s.mcpView(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("mcp_server", id, v.RowVersion)
		return nil
	})
}
func validateMCPAuth(input MCPAuthenticationWrite, old string, oldHeader *string, exists bool) error {
	if input.Method != "none" && input.Method != "bearer" && input.Method != "custom_header" {
		return httpx.Invalid("authentication.auth_method", "unsupported")
	}
	if input.Method != "custom_header" && input.HeaderName != nil {
		return httpx.Invalid("authentication.header_name", "not_allowed")
	}
	switch input.Secret.Operation {
	case "keep":
		if !exists || input.Secret.Value != nil || input.Method != old || !same(input.HeaderName, oldHeader) {
			return httpx.Invalid("authentication.secret", "invalid_keep")
		}
	case "clear":
		if input.Secret.Value != nil {
			return httpx.Invalid("authentication.secret", "unexpected_value")
		}
	case "replace":
		if input.Secret.Value == nil || *input.Secret.Value == "" {
			return httpx.Invalid("authentication.secret.value", "required")
		}
	default:
		return httpx.Invalid("authentication.secret.operation", "unsupported")
	}
	if input.Method == "none" && input.Secret.Operation != "clear" {
		return httpx.Invalid("authentication.secret", "must_clear")
	}
	secret := ""
	if input.Method != "none" {
		secret = "validation-placeholder"
	}
	if input.Secret.Value != nil {
		secret = *input.Secret.Value
	}
	config := runtime.Config{URL: "https://mcp.example.test", AuthMethod: input.Method, Secret: secret, Timeout: time.Minute}
	if input.HeaderName != nil {
		config.HeaderName = *input.HeaderName
	}
	if runtime.ValidateConfig(config) != nil {
		return httpx.Invalid("authentication", "invalid")
	}
	return nil
}
func (s *Service) saveMCPAuth(repo MCPRepository, v *MCPServer, input MCPAuthenticationWrite) error {
	if input.Secret.Operation == "keep" {
		return nil
	}
	var cipher *string
	if input.Secret.Operation == "replace" {
		if s.Cipher == nil {
			return unavailable()
		}
		sealed, e := s.Cipher(fmt.Sprintf("agentresources/mcp/%d/authentication", v.ID), *input.Secret.Value, true)
		if e != nil {
			return e
		}
		cipher = &sealed
	}
	if e := repo.SaveMCPSecret(v.ID, cipher); e != nil {
		return e
	}
	v.HasSecret = cipher != nil
	v.AuthMethod = input.Method
	v.AuthHeaderName = input.HeaderName
	return nil
}
func (s *Service) SetMCPAuthentication(ctx context.Context, raw string, id uint64, tag, key string, input MCPAuthenticationWrite) (*Result, error) {
	return s.command(ctx, raw, key, "mcp_server.authentication", fmt.Sprintf("mcp_server:%d", id), input, func(tx identity.Tx, _ *identity.Auth, out *Result, _ uint64) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		v, e := repo.MCPServer(id, true)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("mcp_server", id, v.RowVersion)); e != nil {
			return e
		}
		if e = validateMCPAuth(input, v.AuthMethod, v.AuthHeaderName, true); e != nil {
			return e
		}
		if input.Secret.Operation != "keep" {
			if e = s.saveMCPAuth(repo, v, input); e != nil {
				return e
			}
			v.SecretRevision++
			v.RowVersion++
			v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
			var config MCPConfig
			if json.Unmarshal(v.StoredConfig, &config) != nil {
				return integrity()
			}
			if e = mcpStoreConfig(v, config); e != nil {
				return e
			}
			if e = repo.SaveMCPServer(v); e != nil {
				return e
			}
		}
		if e = s.mcpView(v); e != nil {
			return e
		}
		out.Data = v
		out.Tag = s.tag("mcp_server", id, v.RowVersion)
		return nil
	})
}
func (s *Service) DeleteMCPServer(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.command(ctx, raw, key, "mcp_server.delete", fmt.Sprintf("mcp_server:%d", id), struct {
		ID uint64 `json:"id,string"`
	}{id}, func(tx identity.Tx, _ *identity.Auth, out *Result, _ uint64) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		v, e := repo.MCPServer(id, true)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		if e = checkTag(tag, s.tag("mcp_server", id, v.RowVersion)); e != nil {
			return e
		}
		used, e := repo.MCPReferenced(id)
		if e != nil {
			return e
		}
		if used {
			return inUse()
		}
		if e = repo.DeleteMCPServer(id); e != nil {
			return e
		}
		out.Status = 204
		return nil
	})
}

func (s *Service) MCPDiagnostics(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, func(tx identity.Tx, _ *identity.Auth, out *Result) error {
		repo, e := mcpRepository(tx)
		if e != nil {
			return e
		}
		v, e := repo.MCPServer(id, false)
		if e != nil {
			return e
		}
		if v == nil {
			return missing()
		}
		var latest *MCPDiagnostic
		if len(v.LastDiagnostic) > 0 && string(v.LastDiagnostic) != "null" {
			var record MCPDiagnosticRecord
			if json.Unmarshal(v.LastDiagnostic, &record) != nil {
				return integrity()
			}
			record.Diagnostic.Outdated = record.ConfigVersion != v.ConfigVersion || record.SecretRevision != v.SecretRevision
			latest = &record.Diagnostic
		}
		out.Data = struct {
			Latest *MCPDiagnostic `json:"latest"`
		}{latest}
		return nil
	})
}
func (s *Service) decryptMCP(repo MCPRepository, v *MCPServer) (runtime.Config, error) {
	var config MCPConfig
	if json.Unmarshal(v.StoredConfig, &config) != nil {
		return runtime.Config{}, integrity()
	}
	secret := ""
	if v.AuthMethod != "none" {
		if !v.HasSecret || s.Cipher == nil {
			return runtime.Config{}, httpx.E(409, "MCP_CREDENTIAL_UNAVAILABLE", "MCP凭据不可用")
		}
		cipher, e := repo.MCPSecret(v.ID)
		if e != nil {
			return runtime.Config{}, e
		}
		secret, e = s.Cipher(fmt.Sprintf("agentresources/mcp/%d/authentication", v.ID), cipher, false)
		if e != nil {
			return runtime.Config{}, httpx.E(409, "MCP_CREDENTIAL_UNAVAILABLE", "MCP凭据不可用")
		}
	}
	return mcpConfig(config, v.AuthMethod, v.AuthHeaderName, secret), nil
}

// ReadMCPIdentity freezes configuration and credential revisions without exposing credentials.
func (s *Service) ReadMCPIdentity(tx identity.Tx, serverID uint64) (json.RawMessage, error) {
	repo, e := mcpRepository(tx)
	if e != nil {
		return nil, e
	}
	v, e := repo.MCPServer(serverID, false)
	if e != nil {
		return nil, e
	}
	if v == nil || !v.Enabled || v.AuthMethod != "none" && !v.HasSecret {
		return nil, httpx.E(409, "MCP_SERVER_UNAVAILABLE", "MCP 服务当前不可用")
	}
	var config MCPConfig
	if json.Unmarshal(v.StoredConfig, &config) != nil {
		return nil, integrity()
	}
	return json.Marshal(MCPSnapshot{ServerID: v.ID, ConfigVersion: v.ConfigVersion, SecretRevision: v.SecretRevision, Config: config, AuthMethod: v.AuthMethod, AuthHeaderName: v.AuthHeaderName})
}

// ReadAuthorizedMCPRuntime uses a private root snapshot rather than current
// enablement or bindings. Secrets remain live and are never persisted in it.
func (s *Service) ReadAuthorizedMCPRuntime(tx identity.Tx, serverID uint64, snapshot json.RawMessage) (runtime.Config, error) {
	var frozen MCPSnapshot
	if json.Unmarshal(snapshot, &frozen) != nil || frozen.ServerID != serverID || frozen.Config.URL == "" {
		return runtime.Config{}, integrity()
	}
	if frozen.AuthMethod == "none" {
		return mcpConfig(frozen.Config, "none", nil, ""), nil
	}
	repo, err := mcpRepository(tx)
	if err != nil {
		return runtime.Config{}, err
	}
	current, err := repo.MCPServer(serverID, false)
	if err != nil {
		return runtime.Config{}, err
	}
	// A rotated key is usable only for the same credential destination. Never
	// send a new destination's key to an endpoint retained by an older turn.
	if current == nil || current.URL != frozen.Config.URL || current.AuthMethod != frozen.AuthMethod || !same(current.AuthHeaderName, frozen.AuthHeaderName) {
		return runtime.Config{}, httpx.E(409, "MCP_CREDENTIAL_UNAVAILABLE", "原 MCP 连接的凭据已不可用")
	}
	current.StoredConfig, err = json.Marshal(frozen.Config)
	if err != nil {
		return runtime.Config{}, err
	}
	return s.decryptMCP(repo, current)
}
func (s *Service) ReadMCPRuntime(tx identity.Tx, serverID uint64) (runtime.Config, json.RawMessage, error) {
	identity, e := s.ReadMCPIdentity(tx, serverID)
	if e != nil {
		return runtime.Config{}, nil, e
	}
	repo, e := mcpRepository(tx)
	if e != nil {
		return runtime.Config{}, nil, e
	}
	v, e := repo.MCPServer(serverID, false)
	if e != nil {
		return runtime.Config{}, nil, e
	}
	config, e := s.decryptMCP(repo, v)
	return config, identity, e
}
