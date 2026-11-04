package projectdelivery

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

func (s *Scope) Scan(v any) error {
	b, ok := v.([]byte)
	if !ok {
		return fmt.Errorf("invalid scope storage")
	}
	return json.Unmarshal(b, s)
}
func (s Scope) Value() (driver.Value, error) { return json.Marshal(s) }

type Model struct {
	ProjectID       uint64            `db:"project_id" json:"project_id,string"`
	Version         uint64            `db:"row_version" json:"-"`
	VariantsVersion uint64            `db:"variants_version" json:"-"`
	Rules           []BranchRule      `db:"-" json:"rules"`
	Types           []BranchType      `db:"-" json:"types"`
	ETag            string            `db:"-" json:"etag"`
	CanManage       bool              `db:"-" json:"can_manage"`
	Connections     []ScopeConnection `db:"-" json:"repository_connections"`
}
type ScopeConnection struct {
	ID   uint64 `json:"id,string"`
	Name string `json:"name"`
}
type Variant struct {
	ReleaseTagPrefix    string     `db:"release_tag_prefix" json:"release_tag_prefix"`
	ID                  uint64     `db:"id" json:"id,string"`
	ProjectID           uint64     `db:"project_id" json:"project_id,string"`
	Code                string     `db:"code" json:"code"`
	Name                string     `db:"name" json:"name"`
	Summary             string     `db:"summary" json:"summary"`
	Kind                string     `db:"kind" json:"kind"`
	Branch              string     `db:"main_branch" json:"main_branch"`
	Scope               Scope      `db:"repository_scope" json:"repository_scope"`
	Version             uint64     `db:"row_version" json:"-"`
	EnvironmentsVersion uint64     `db:"environments_version" json:"environments_version,string"`
	Creator             uint64     `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt           time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt           time.Time  `db:"updated_at" json:"updated_at"`
	ArchivedAt          *time.Time `db:"archived_at" json:"archived_at"`
	ETag                string     `db:"-" json:"etag"`
	CanManage           bool       `db:"-" json:"can_manage"`
	Validity            string     `db:"-" json:"binding_validity"`
	Reason              string     `db:"-" json:"binding_reason"`
	BranchType          string     `db:"-" json:"main_branch_type"`
	RepositoryCount     int        `db:"-" json:"repository_count"`
	EnvironmentCount    int        `db:"environment_count" json:"environment_count"`
}

func (v Variant) Type() string {
	if v.Kind == "standard" {
		return "mainline"
	}
	return "custom"
}

type Environment struct {
	ID              uint64    `db:"id" json:"id,string"`
	ProjectID       uint64    `db:"project_id" json:"project_id,string"`
	VariantID       uint64    `db:"variant_id" json:"variant_id,string"`
	Code            string    `db:"code" json:"code"`
	Name            string    `db:"name" json:"name"`
	Summary         string    `db:"summary" json:"summary"`
	BranchType      string    `db:"branch_type" json:"branch_type"`
	Branch          string    `db:"branch_name" json:"branch_name"`
	Scope           Scope     `db:"repository_scope" json:"repository_scope"`
	Version         uint64    `db:"row_version" json:"-"`
	Creator         uint64    `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt       time.Time `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time `db:"updated_at" json:"updated_at"`
	ETag            string    `db:"-" json:"etag"`
	CanManage       bool      `db:"-" json:"can_manage"`
	Validity        string    `db:"-" json:"binding_validity"`
	Reason          string    `db:"-" json:"binding_reason"`
	RepositoryCount int       `db:"-" json:"repository_count"`
}
type Check struct {
	ID           uint64          `db:"id" json:"-"`
	ProjectID    uint64          `db:"project_id" json:"-"`
	SubjectKind  string          `db:"subject_kind" json:"-"`
	SubjectID    uint64          `db:"subject_id" json:"-"`
	RepositoryID uint64          `db:"project_repository_id" json:"repository_id,string"`
	Branch       string          `db:"branch_name" json:"branch_name"`
	CheckID      string          `db:"check_id" json:"check_id"`
	Status       string          `db:"status" json:"status"`
	Reason       string          `db:"reason" json:"reason"`
	Commit       string          `db:"commit_id" json:"commit_id"`
	Protected    *bool           `db:"is_protected" json:"protected"`
	Default      *bool           `db:"is_default" json:"default"`
	Snapshot     json.RawMessage `db:"snapshot" json:"-"`
	Actor        uint64          `db:"checked_by_user_id" json:"checked_by_user_id,string"`
	StartedAt    time.Time       `db:"started_at" json:"started_at,omitzero"`
	FinishedAt   time.Time       `db:"finished_at" json:"finished_at,omitzero"`
	Outdated     bool            `db:"-" json:"outdated"`
}
type Creation struct {
	ID            uint64          `db:"id" json:"id,string"`
	ProjectID     uint64          `db:"project_id" json:"project_id,string"`
	VariantID     uint64          `db:"variant_id" json:"variant_id,string"`
	RetryOf       *uint64         `db:"retry_of_id" json:"retry_of_id,string,omitempty"`
	Target        string          `db:"target_branch" json:"target_branch"`
	Source        string          `db:"default_source_branch" json:"default_source_branch"`
	Snapshot      json.RawMessage `db:"config_snapshot" json:"-"`
	Key           string          `db:"idempotency_key" json:"-"`
	RequestHash   []byte          `db:"request_hash" json:"-"`
	ExecutionHash []byte          `db:"execution_hash" json:"-"`
	Status        string          `db:"status" json:"status"`
	Version       uint64          `db:"row_version" json:"-"`
	Actor         uint64          `db:"created_by_user_id" json:"created_by_user_id,string"`
	CreatedAt     time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time       `db:"updated_at" json:"updated_at"`
	ExpiresAt     time.Time       `db:"expires_at" json:"expires_at"`
	StartedAt     *time.Time      `db:"started_at" json:"started_at"`
	FinishedAt    *time.Time      `db:"finished_at" json:"finished_at"`
	Lease         *time.Time      `db:"lease_expires_at" json:"-"`
	ETag          string          `db:"-" json:"etag"`
	Expired       bool            `db:"-" json:"expired"`
	CanExecute    bool            `db:"-" json:"can_execute"`
	CanReconcile  bool            `db:"-" json:"can_reconcile"`
	CanManage     bool            `db:"-" json:"can_manage"`
	VariantName   string          `db:"-" json:"variant_name"`
	Counts        map[string]int  `db:"-" json:"counts"`
}
type CreationItem struct {
	ID                uint64          `db:"id" json:"id,string"`
	CreationID        uint64          `db:"creation_id" json:"creation_id,string"`
	RepositoryID      uint64          `db:"project_repository_id" json:"repository_id,string"`
	RepositoryVersion uint64          `db:"repository_version" json:"-"`
	ConnectionID      uint64          `db:"connection_id" json:"connection_id,string"`
	RepoID            string          `db:"repo_id" json:"repo_id"`
	Path              string          `db:"repository_path" json:"repository_path"`
	Source            string          `db:"source_branch" json:"source_branch"`
	SourceCommit      string          `db:"source_commit_id" json:"source_commit_id"`
	TargetCommit      string          `db:"preview_target_commit_id" json:"preview_target_commit_id"`
	Preview           string          `db:"preview_state" json:"preview_state"`
	PreviewReason     string          `db:"preview_reason" json:"preview_reason"`
	Snapshot          json.RawMessage `db:"remote_snapshot" json:"-"`
	Action            string          `db:"action" json:"action"`
	Status            string          `db:"status" json:"status"`
	Reason            string          `db:"reason" json:"reason"`
	Commit            string          `db:"result_commit_id" json:"result_commit_id"`
	Reconciliation    json.RawMessage `db:"reconciliation" json:"reconciliation"`
	StartedAt         *time.Time      `db:"started_at" json:"started_at"`
	FinishedAt        *time.Time      `db:"finished_at" json:"finished_at"`
}
type Query struct {
	Page, Size     int
	Search, Status string
	VariantID      uint64
}
type Page[T any] struct {
	Items           []T    `json:"items"`
	Total           int    `json:"total"`
	Page            int    `json:"page"`
	Size            int    `json:"page_size"`
	MutationVersion string `json:"mutation_version,omitempty"`
	ScopeToken      string `json:"scope_token,omitempty"`
	CanManage       bool   `json:"can_manage"`
}
type Repository interface {
	DeliveryModel(uint64) (*Model, error)
	SaveDeliveryModel(*Model) error
	Variants(uint64, Query) ([]Variant, int, error)
	Variant(uint64, uint64) (*Variant, error)
	SaveVariant(*Variant, bool) error
	DeleteVariant(uint64, uint64) error
	Environments(uint64, uint64) ([]Environment, error)
	Environment(uint64, uint64, uint64) (*Environment, error)
	SaveEnvironment(*Environment, bool) error
	DeleteEnvironment(uint64, uint64, uint64) error
	BumpVariants(uint64) error
	BumpEnvironments(uint64) error
	DeliveryBusy(uint64, uint64, uint64) (bool, error)
	BranchChecks(uint64, string, uint64) ([]Check, error)
	SaveBranchCheck(*Check) error
	Creations(uint64, Query) ([]Creation, int, error)
	Creation(uint64, uint64) (*Creation, error)
	CreationByKey(uint64, uint64, string) (*Creation, error)
	CreationItems(uint64) ([]CreationItem, error)
	SaveCreation(*Creation, bool) error
	SaveCreationItem(*CreationItem, bool) error
	RecoverCreations(time.Time) error
}
