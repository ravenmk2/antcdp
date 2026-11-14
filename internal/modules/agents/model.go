// Package agents implements platform authorization and durable agent use cases.
package agents

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/commandstate"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/models"
)

type Field[T any] = models.Field[T]
type Pagination = models.Pagination
type Result struct {
	Data          any
	Tag, Location string
	Status        int
	Replayed      bool
	Pagination    *Pagination
	Auth          *identity.Auth            `json:"-"`
	Commits       []agentcore.CommitReceipt `json:"-"`
}
type Receipt = commandstate.Receipt
type CommandReceipt = commandstate.CommandReceipt
type ResourceRef = commandstate.ResourceRef

type RuntimePolicy struct {
	MaxSteps         int    `json:"max_steps"`
	MaxModelCalls    int    `json:"max_model_calls"`
	MaxToolCalls     int    `json:"max_tool_calls"`
	MaxChildren      int    `json:"max_children"`
	MaxParallelTools int    `json:"max_parallel_tools"`
	RunTimeout       int    `json:"run_timeout_seconds"`
	QueueTimeout     int    `json:"queue_timeout_seconds"`
	QuestionTimeout  int    `json:"question_timeout_seconds"`
	ApprovalTimeout  int    `json:"approval_timeout_seconds"`
	MaxInputTokens   uint64 `json:"max_input_tokens"`
	MaxOutputTokens  uint64 `json:"max_output_tokens"`
}
type NetworkPolicy struct {
	DefaultAction string   `json:"default_action"`
	PresetIDs     []string `json:"preset_ids"`
	AllowTargets  []string `json:"allow_targets"`
	DenyTargets   []string `json:"deny_targets"`
}
type Definition struct {
	ScopeKind             string          `db:"scope_kind" json:"scope_kind"`
	ScopeID               *uint64         `db:"scope_id" json:"scope_id,string"`
	RobotUserID           *uint64         `db:"robot_user_id" json:"robot_user_id,string"`
	PoolCapacity          *int            `db:"pool_capacity" json:"pool_capacity"`
	ConfigVersion         uint64          `db:"config_version" json:"-"`
	DeletedAt             *time.Time      `db:"deleted_at" json:"deleted_at"`
	ID                    uint64          `db:"id" json:"id,string"`
	Code                  string          `db:"code" json:"code"`
	Name                  string          `db:"name" json:"name"`
	Description           string          `db:"description" json:"description"`
	Mode                  string          `db:"agent_type" json:"agent_type"`
	Enabled               bool            `db:"enabled" json:"enabled"`
	SystemPrompt          string          `db:"system_prompt" json:"system_prompt"`
	DefaultModelBindingID *uint64         `db:"default_model_binding_id" json:"default_model_binding_id,string"`
	RuntimePolicy         RuntimePolicy   `db:"-" json:"runtime_policy"`
	Version               string          `db:"-" json:"version"`
	CreatedAt             time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt             time.Time       `db:"updated_at" json:"updated_at"`
	SchemaVersion         uint64          `db:"config_schema_version" json:"-"`
	RowVersion            uint64          `db:"row_version" json:"-"`
	Creator               uint64          `db:"created_by_user_id" json:"-"`
	BudgetJSON            json.RawMessage `db:"runtime_policy" json:"-"`
	QuestionTTL           int             `db:"-" json:"-"`
	ApprovalTTL           int             `db:"-" json:"-"`
	QueueTTL              int             `db:"-" json:"-"`
	RunTTL                int             `db:"-" json:"-"`
	ModelCount            int             `db:"model_binding_count" json:"-"`
	ToolCount             int             `db:"tool_binding_count" json:"-"`
	MCPCount              int             `db:"mcp_binding_count" json:"-"`
}
type DefinitionSummary struct {
	ID                    uint64    `json:"id,string"`
	Code                  string    `json:"code"`
	Name                  string    `json:"name"`
	Description           string    `json:"description"`
	Mode                  string    `json:"agent_type"`
	Enabled               bool      `json:"enabled"`
	DefaultModelBindingID *uint64   `json:"default_model_binding_id,string"`
	ScopeKind             string    `json:"scope_kind"`
	ScopeID               *uint64   `json:"scope_id,string"`
	RobotUserID           *uint64   `json:"robot_user_id,string"`
	PoolCapacity          *int      `json:"pool_capacity"`
	ModelCount            int       `json:"model_binding_count"`
	ToolCount             int       `json:"tool_binding_count"`
	MCPCount              int       `json:"mcp_binding_count"`
	Version               string    `json:"version"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}
type DefinitionCreate struct {
	CloudEnvironment *CloudEnvironment `json:"cloud_environment"`
	Name             string            `json:"name"`
	Mode             string            `json:"agent_type"`
	ScopeKind        string            `json:"scope_kind"`
	ScopeID          *string           `json:"scope_id"`
	PoolCapacity     *int              `json:"pool_capacity"`
	Description      string            `json:"description"`
	SystemPrompt     string            `json:"system_prompt"`
	Enabled          Field[bool]       `json:"enabled"`
	RuntimePolicy    *RuntimePolicy    `json:"runtime_policy"`
}
type DefinitionPatch struct {
	Name          Field[string]        `json:"name"`
	Description   Field[string]        `json:"description"`
	SystemPrompt  Field[string]        `json:"system_prompt"`
	Enabled       Field[bool]          `json:"enabled"`
	RuntimePolicy Field[RuntimePolicy] `json:"runtime_policy"`
	PoolCapacity  Field[int]           `json:"pool_capacity"`
}
type Query struct {
	Page, PageSize     int
	Q, Mode, ScopeKind string
	Enabled            *bool
	ProjectID          uint64
	CatalogUserID      uint64
	CatalogAdmin       bool
}
type ModelBindingWrite struct {
	ModelID             string          `json:"model_definition_id"`
	ThinkingOptions     []string        `json:"thinking_options"`
	DefaultThinking     string          `json:"default_thinking"`
	GenerationOverrides json.RawMessage `json:"generation_overrides"`
}
type ModelBindingsWrite struct {
	Items           []ModelBindingWrite `json:"items"`
	DefaultModelID  string              `json:"default_model_id"`
	DefaultThinking string              `json:"default_thinking_option_key"`
}
type ModelBinding struct {
	ID                  uint64          `db:"id" json:"id,string"`
	AgentID             uint64          `db:"agent_id" json:"-"`
	ModelID             uint64          `db:"model_definition_id" json:"model_definition_id,string"`
	ThinkingOptions     []string        `db:"-" json:"thinking_options"`
	DefaultThinking     string          `db:"default_thinking" json:"default_thinking"`
	GenerationOverrides json.RawMessage `db:"generation_overrides" json:"generation_overrides"`
	ThinkingJSON        json.RawMessage `db:"thinking_options" json:"-"`
	SortOrder           int             `db:"sort_order" json:"-"`
	CreatedAt           time.Time       `db:"created_at" json:"-"`
	UpdatedAt           time.Time       `db:"updated_at" json:"-"`
	RemovedAt           *time.Time      `db:"removed_at" json:"-"`
}
type ToolBindingWrite struct {
	ToolKey     string          `json:"tool_key"`
	Policy      string          `json:"policy"`
	Constraints json.RawMessage `json:"parameter_constraints"`
}
type ToolBinding struct {
	ID            uint64          `db:"id" json:"id,string"`
	AgentID       uint64          `db:"agent_id" json:"-"`
	ToolKey       string          `db:"tool_key" json:"tool_key"`
	Policy        string          `db:"policy" json:"policy"`
	Constraints   json.RawMessage `db:"parameter_constraints" json:"parameter_constraints"`
	Kind          string          `db:"tool_kind" json:"-"`
	Config        json.RawMessage `db:"config" json:"-"`
	SchemaVersion uint64          `db:"config_schema_version" json:"-"`
	SortOrder     int             `db:"sort_order" json:"-"`
	CreatedAt     time.Time       `db:"created_at" json:"-"`
	UpdatedAt     time.Time       `db:"updated_at" json:"-"`
	RemovedAt     *time.Time      `db:"removed_at" json:"-"`
}
type ToolBindingsWrite struct {
	Items []ToolBindingWrite `json:"items"`
}
type ProjectOption struct {
	ID   uint64 `db:"id" json:"id,string"`
	Name string `db:"name" json:"name"`
}
type ToolSource struct {
	Kind     string  `json:"kind"`
	ServerID *uint64 `json:"server_id,string,omitempty"`
}
type Availability struct {
	Available bool    `json:"available"`
	Reason    *string `json:"reason"`
}
type ToolDescriptor struct {
	Definition        modelcore.Tool  `json:"-"`
	ParallelSafe      bool            `json:"-"`
	Key               string          `json:"tool_key"`
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Source            ToolSource      `json:"source"`
	ExecutionClass    string          `json:"execution_class"`
	SupportedPolicies []string        `json:"supported_policies"`
	RequiresSandbox   bool            `json:"requires_sandbox"`
	ConstraintsSchema json.RawMessage `json:"parameter_constraints_schema"`
	SchemaFingerprint string          `json:"input_schema_fingerprint"`
	Availability      Availability    `json:"availability"`
	// ProjectTarget resolves the actual project from the resource arguments.
	// Operation-specific checks use the supplied root authorization snapshot.
	// Resource lookup may read current existence, but must not reload grants.
	ProjectTarget func(context.Context, identity.Tx, agentcore.Authorization, json.RawMessage) (uint64, error) `json:"-"`
}

// Catalog callbacks execute within the current authorized host transaction.
// Resource implementations may import agents; agents never import them.
type ResourceCatalog struct {
	Skill                   func(identity.Tx, uint64, uint64) (*SkillSnapshot, error)
	MCPArguments            func(json.RawMessage, json.RawMessage) error
	MCPServer               func(identity.Tx, uint64) error
	MCPIdentity             func(identity.Tx, uint64) (json.RawMessage, error)
	DiscoverMCP             func(context.Context, uint64, json.RawMessage) ([]agentcore.ToolSpec, error)
	Tools                   func(context.Context, identity.Tx, Query) ([]ToolDescriptor, int, error)
	Tool                    func(context.Context, identity.Tx, string) (*ToolDescriptor, error)
	ValidateToolConstraints func(context.Context, identity.Tx, ToolDescriptor, json.RawMessage) error
	AuthorizeTool           func(context.Context, identity.Tx, agentcore.ExecutionContext, ToolDescriptor, json.RawMessage, json.RawMessage) (json.RawMessage, error)
}
type Service struct {
	Identity            *identity.Service
	Store               func() (identity.Store, error)
	ETag                func(string) string
	Models              *models.Service
	Catalog             ResourceCatalog
	Committed           func(context.Context, agentcore.CommitReceipt)
	Files               *ByteStore
	Skills              agentcore.SkillSource
	CancelRun           func(agentcore.ID)
	Epoch               string
	RuntimeModels       agentcore.ModelClientFactory
	Tokens              agentcore.TokenCounter
	Compactor           *agentcore.Compactor
	Sandboxes           *CloudService
	ManagementOperation func(context.Context, string, uint64) (*Result, error)
	fileReleaseMu       sync.Mutex
	pendingFileReleases map[uint64]bool
}
type Repository interface {
	Definitions(Query) ([]Definition, int, error)
	Definition(uint64, bool) (*Definition, error)
	InsertDefinition(*Definition) error
	SaveDefinition(*Definition) error
	DefinitionReferenced(uint64) (bool, error)
	ModelBindings(uint64, bool) ([]ModelBinding, error)
	SaveModelBindings(uint64, []ModelBinding, time.Time) error
	MCPBindings(uint64, bool) ([]MCPBinding, error)
	SaveMCPBindings(uint64, []MCPBinding, time.Time) error
	ToolBindings(uint64, bool) ([]ToolBinding, error)
	SaveToolBindings(uint64, []ToolBinding, time.Time) error
	SkillBindings(uint64) ([]SkillBinding, error)
	SaveSkillBindings(uint64, []SkillBinding, time.Time) error
	CanUseAgent(agentID, userID uint64, admin bool) (bool, error)
	ScopeExists(kind string, id *uint64) (bool, error)
	AvailableProjects(userID uint64, admin bool) ([]ProjectOption, error)
	CanReadActiveProject(projectID, userID uint64, admin bool) (bool, error)
	AccountResourceGrants(userID uint64, admin bool) ([]agentcore.ResourceGrant, error)
	AgentHasActiveWork(uint64) (bool, error)
	AgentSessionIDs(uint64) ([]uint64, error)
	ModelReferenced(string, uint64) (bool, error)
	Receipt(actor, scopeKind, scopeID, command, key string) (*Receipt, error)
	InsertReceipt(*Receipt) error
	SaveReceipt(*Receipt) error
}
