package agentresources

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
)

type MCPConfig struct {
	URL              string   `json:"url"`
	Transport        string   `json:"transport"`
	Timeout          int      `json:"timeout_seconds"`
	ProtocolVersions []string `json:"requested_protocol_versions"`
}
type MCPAuthenticationWrite struct {
	Method     string             `json:"auth_method"`
	HeaderName *string            `json:"header_name"`
	Secret     models.SecretWrite `json:"secret"`
}
type MCPAuthentication struct {
	Method     string  `json:"auth_method"`
	HeaderName *string `json:"header_name"`
	HasSecret  bool    `json:"has_secret"`
}
type MCPServerCreate struct {
	Code           Field[string]           `json:"code"`
	Name           string                  `json:"name"`
	Description    string                  `json:"description"`
	Enabled        Field[bool]             `json:"enabled"`
	Config         *MCPConfig              `json:"config"`
	Authentication *MCPAuthenticationWrite `json:"authentication"`
}
type MCPServerPatch struct {
	Name        Field[string]    `json:"name"`
	Description Field[string]    `json:"description"`
	Enabled     Field[bool]      `json:"enabled"`
	Config      Field[MCPConfig] `json:"config"`
}
type MCPServer struct {
	AgentCount       int               `db:"agent_count" json:"agent_count"`
	LatestTest       *MCPDiagnostic    `db:"-" json:"latest_test"`
	ID               uint64            `db:"id" json:"id,string"`
	Code             string            `db:"code" json:"code"`
	Name             string            `db:"name" json:"name"`
	Description      string            `db:"description" json:"description"`
	Enabled          bool              `db:"enabled" json:"enabled"`
	Config           MCPConfig         `db:"-" json:"config"`
	Authentication   MCPAuthentication `db:"-" json:"authentication"`
	Version          string            `db:"-" json:"version"`
	CreatedAt        time.Time         `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time         `db:"updated_at" json:"updated_at"`
	URL              string            `db:"url" json:"-"`
	AuthMethod       string            `db:"auth_method" json:"-"`
	AuthHeaderName   *string           `db:"auth_header_name" json:"-"`
	IdentityConfig   json.RawMessage   `db:"identity_config" json:"-"`
	Timeout          int               `db:"timeout_seconds" json:"-"`
	StoredConfig     json.RawMessage   `db:"config" json:"-"`
	SchemaVersion    uint64            `db:"config_schema_version" json:"-"`
	HasSecret        bool              `db:"has_secret" json:"-"`
	SecretRevision   uint64            `db:"secret_revision" json:"-"`
	RowVersion       uint64            `db:"row_version" json:"-"`
	ConfigVersion    uint64            `db:"config_version" json:"-"`
	LastDiagnostic   json.RawMessage   `db:"last_diagnostic" json:"-"`
	LastDiagnosticAt *time.Time        `db:"last_diagnostic_at" json:"-"`
	Creator          uint64            `db:"created_by_user_id" json:"-"`
}
type MCPCheck struct {
	Name   string  `json:"name"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}
type MCPDiagnostic struct {
	Kind            string     `json:"kind"`
	Status          string     `json:"status"`
	DurationMS      int64      `json:"duration_ms"`
	StartedAt       time.Time  `json:"started_at"`
	FinishedAt      time.Time  `json:"finished_at"`
	Outdated        bool       `json:"outdated"`
	Checks          []MCPCheck `json:"checks"`
	ProtocolVersion string     `json:"protocol_version,omitempty"`
}
type MCPDiagnosticRecord struct {
	Diagnostic     MCPDiagnostic `json:"diagnostic"`
	ConfigVersion  uint64        `json:"config_version"`
	SecretRevision uint64        `json:"secret_revision"`
}
type MCPSnapshot struct {
	ServerID       uint64    `json:"server_id,string"`
	ConfigVersion  uint64    `json:"config_version"`
	SecretRevision uint64    `json:"secret_revision"`
	Config         MCPConfig `json:"config"`
	AuthMethod     string    `json:"auth_method"`
	AuthHeaderName *string   `json:"auth_header_name"`
}

type MCPRepository interface {
	MCPAgents(uint64, Query) ([]MCPAgent, int, error)
	MCPServers(Query) ([]MCPServer, int, error)
	MCPServer(uint64, bool) (*MCPServer, error)
	InsertMCPServer(*MCPServer) error
	SaveMCPServer(*MCPServer) error
	DeleteMCPServer(uint64) error
	MCPReferenced(uint64) (bool, error)
	MCPSecret(uint64) (string, error)
	SaveMCPSecret(uint64, *string) error
}
type MCPAgent struct {
	ID             uint64 `db:"id" json:"id,string"`
	Name           string `db:"name" json:"name"`
	Enabled        bool   `db:"enabled" json:"enabled"`
	BindingEnabled bool   `db:"binding_enabled" json:"binding_enabled"`
}

func mcpRepository(tx identity.Tx) (MCPRepository, error) {
	p, ok := tx.(interface{ AgentMCP() MCPRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.AgentMCP(), nil
}
