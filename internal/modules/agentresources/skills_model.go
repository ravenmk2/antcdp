package agentresources

import (
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

type Skill struct {
	ID                 uint64    `db:"id" json:"id,string"`
	Name               string    `db:"name" json:"name"`
	Title              string    `db:"title" json:"title"`
	Description        string    `db:"description" json:"description"`
	Enabled            bool      `db:"enabled" json:"enabled"`
	Version            string    `db:"-" json:"version"`
	CreatedAt          time.Time `db:"created_at" json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at" json:"updated_at"`
	RowVersion         uint64    `db:"row_version" json:"-"`
	Creator            uint64    `db:"created_by_user_id" json:"-"`
	LatestVersionID    *uint64   `db:"latest_version_id" json:"latest_version_id,string"`
	LatestVersionLabel *string   `db:"latest_version_label" json:"latest_version_label"`
}
type SkillSummary struct {
	Skill
	LatestVersionID    *uint64 `json:"latest_version_id,string"`
	LatestVersionLabel *string `json:"latest_version_label"`
}
type SkillCreate struct {
	Name        string      `json:"name"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Enabled     Field[bool] `json:"enabled"`
}
type SkillPatch struct {
	Title       Field[string] `json:"title"`
	Description Field[string] `json:"description"`
	Enabled     Field[bool]   `json:"enabled"`
}
type SkillVersion struct {
	ID                uint64                   `db:"id" json:"id,string"`
	SkillID           uint64                   `db:"skill_id" json:"skill_id,string"`
	Label             string                   `db:"version_label" json:"version_label"`
	ChangeNote        string                   `db:"change_note" json:"change_note"`
	ContentSHA        string                   `db:"-" json:"content_sha256"`
	ArchiveSHA        string                   `db:"-" json:"archive_sha256"`
	Manifest          skillpackage.Manifest    `db:"-" json:"manifest"`
	Frontmatter       skillpackage.Frontmatter `db:"-" json:"frontmatter"`
	State             string                   `db:"state" json:"state"`
	Version           string                   `db:"-" json:"version"`
	Creator           uint64                   `db:"created_by_user_id" json:"created_by,string"`
	CreatedAt         time.Time                `db:"created_at" json:"created_at"`
	DeletedAt         *time.Time               `db:"deleted_at" json:"deleted_at"`
	DeletedBy         *uint64                  `db:"deleted_by_user_id" json:"-"`
	UploadOperationID uint64                   `db:"upload_operation_id" json:"-"`
	ArchiveFileID     uint64                   `db:"archive_file_id" json:"-"`
	ArchiveHash       []byte                   `db:"archive_sha256" json:"-"`
	ContentHash       []byte                   `db:"content_sha256" json:"-"`
	ExpandedSize      uint64                   `db:"expanded_size_bytes" json:"-"`
	FileCount         int                      `db:"file_count" json:"-"`
	SchemaVersion     uint64                   `db:"manifest_schema_version" json:"-"`
	ManifestJSON      json.RawMessage          `db:"manifest" json:"-"`
	FrontmatterJSON   json.RawMessage          `db:"frontmatter" json:"-"`
	ReportJSON        json.RawMessage          `db:"validation_report" json:"-"`
	RowVersion        uint64                   `db:"row_version" json:"-"`
}
type SkillVersionSummary struct {
	ID         uint64     `json:"id,string"`
	SkillID    uint64     `json:"skill_id,string"`
	Label      string     `json:"version_label"`
	ChangeNote string     `json:"change_note"`
	ContentSHA string     `json:"content_sha256"`
	State      string     `json:"state"`
	Version    string     `json:"version"`
	Creator    uint64     `json:"created_by,string"`
	CreatedAt  time.Time  `json:"created_at"`
	DeletedAt  *time.Time `json:"deleted_at"`
}
type SkillPublish struct {
	UploadID   string `json:"upload_operation_id"`
	Label      string `json:"version_label"`
	ChangeNote string `json:"change_note"`
}
type SkillCreateFromUpload struct {
	UploadID    string  `json:"upload_operation_id"`
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Label       string  `json:"version_label"`
	ChangeNote  string  `json:"change_note"`
}
type SkillUpload struct {
	OperationID uint64                    `json:"operation_id,string"`
	SkillID     *uint64                   `json:"skill_id,string"`
	UploadedBy  uint64                    `json:"uploaded_by,string"`
	Filename    string                    `json:"filename"`
	Size        uint64                    `json:"size_bytes,string"`
	ExpiresAt   *time.Time                `json:"expires_at"`
	Status      string                    `json:"validation_status"`
	Name        *string                   `json:"normalized_name"`
	Frontmatter *skillpackage.Frontmatter `json:"frontmatter"`
	Manifest    *skillpackage.Manifest    `json:"manifest"`
	Issues      []skillpackage.Issue      `json:"issues"`
	PublishedID *uint64                   `json:"published_skill_version_id,string"`
}
type SkillUploadSnapshot struct {
	Filename     string  `json:"filename"`
	Size         uint64  `json:"size_bytes,string"`
	ArchiveSHA   string  `json:"archive_sha256"`
	ExpectedName *string `json:"expected_name"`
}
type SkillValidation struct {
	Name        *string                   `json:"normalized_name"`
	Manifest    *skillpackage.Manifest    `json:"manifest"`
	Frontmatter *skillpackage.Frontmatter `json:"frontmatter"`
	ContentSHA  *string                   `json:"content_sha256"`
	Issues      []skillpackage.Issue      `json:"issues"`
}
type SkillEntry struct {
	Path      string  `json:"path"`
	Kind      string  `json:"kind"`
	Size      *uint64 `json:"size_bytes,string"`
	SHA256    *string `json:"sha256"`
	MediaType *string `json:"media_type"`
}
type SkillRepository interface {
	ExpiredUnassociatedSkillFiles(time.Time, int) ([]agents.FileRow, error)
	Skills(Query) ([]Skill, int, error)
	Skill(uint64, bool) (*Skill, error)
	InsertSkill(*Skill) error
	SaveSkill(*Skill) error
	DeleteSkill(uint64) error
	SkillReferenced(uint64) (bool, error)
	SkillVersions(uint64, Query) ([]SkillVersion, int, error)
	SkillVersion(uint64, bool) (*SkillVersion, error)
	InsertSkillVersion(*SkillVersion) error
	SaveSkillVersion(*SkillVersion) error
	VersionReferenced(uint64, uint64) (bool, error)
	ActiveFileReaders(uint64) (bool, error)
	UploadBeingPublished(uint64) (bool, error)
	PendingSkillOperations(int) ([]agents.PublicOperationRow, error)
	RecoverSkillOperations(string, time.Time) error
	ExpireSkillOperations(time.Time) error
	RetiredSkillVersions(int) ([]SkillVersion, error)
	ExpiredSkillUploads(time.Time, int) ([]agents.PublicOperationRow, error)
	RecoverSkillReaders(string, time.Time) error
}

func skillsRepository(tx identity.Tx) (SkillRepository, error) {
	p, ok := tx.(interface{ AgentSkills() SkillRepository })
	if !ok {
		return nil, unavailable()
	}
	return p.AgentSkills(), nil
}
