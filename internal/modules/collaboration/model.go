// Package collaboration implements project and team membership use cases.
package collaboration

import (
	"fmt"
	"time"
)

type Kind string

const (
	Project Kind = "project"
	Team    Kind = "team"
)

func (k Kind) Valid() bool { return k == Project || k == Team }

type Resource struct {
	ID                uint64     `db:"id" json:"id,string"`
	Code              string     `db:"code" json:"code"`
	Name              string     `db:"name" json:"name"`
	Summary           string     `db:"summary" json:"summary"`
	Description       string     `db:"description" json:"description"`
	IconKey           *string    `db:"icon_key" json:"icon_key"`
	IconFileID        *uint64    `db:"icon_file_id" json:"icon_file_id,string"`
	Creator           uint64     `db:"created_by_user_id" json:"created_by_user_id,string"`
	Version           uint64     `db:"row_version" json:"version,string"`
	MembershipVersion uint64     `db:"membership_version" json:"membership_version,string"`
	EndedAt           *time.Time `db:"ended_at" json:"ended_at"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`
	Role              string     `db:"direct_role" json:"direct_role"`
	IsMember          bool       `db:"is_member" json:"is_member"`
	MemberCount       int        `db:"member_count" json:"member_count"`
	Status            string     `json:"status"`
	ETag              string     `json:"etag"`
	MembershipETag    string     `json:"membership_etag"`
	DissolveETag      string     `json:"dissolve_etag,omitempty"`
	CanManage         bool       `json:"can_manage"`
}

func (r *Resource) Decorate(k Kind, admin bool) {
	r.Status = "active"
	if r.EndedAt != nil {
		r.Status = "archived"
		if k == Team {
			r.Status = "dissolved"
		}
	}
	r.ETag = fmt.Sprintf(`"%s-%d-v%d"`, k, r.ID, r.Version)
	r.MembershipETag = fmt.Sprintf(`"%s-members-%d-v%d"`, k, r.ID, r.MembershipVersion)
	r.DissolveETag = fmt.Sprintf(`"team-dissolve-%d-r%d-m%d"`, r.ID, r.Version, r.MembershipVersion)
	r.CanManage = r.EndedAt == nil && (admin || r.Role == "admin")
}

type Source struct {
	Type   string `json:"type"`
	TeamID uint64 `json:"team_id,string,omitempty"`
	Name   string `json:"team_name,omitempty"`
}
type Member struct {
	ID            uint64   `db:"id" json:"user_id,string"`
	Username      string   `db:"username" json:"username"`
	Name          string   `db:"display_name" json:"display_name"`
	Status        string   `db:"status" json:"account_status"`
	Role          string   `db:"role" json:"direct_role"`
	EffectiveRole string   `json:"effective_role"`
	TeamID        uint64   `db:"team_id" json:"-"`
	TeamName      string   `db:"team_name" json:"-"`
	Sources       []Source `json:"sources"`
}
type Icon struct {
	Type   string `json:"type"`
	Key    string `json:"key,omitempty"`
	FileID string `json:"file_id,omitempty"`
}
type Write struct {
	Code        string   `json:"code,omitempty"`
	Name        *string  `json:"name,omitempty"`
	Summary     *string  `json:"summary,omitempty"`
	Description *string  `json:"description,omitempty"`
	Icon        *Icon    `json:"icon,omitempty"`
	Admins      []string `json:"admin_user_ids,omitempty"`
}
type Query struct {
	Scope, Search, Status string
	Page, Size            int
	Unmanaged             bool
}
type Page struct {
	Items    []Resource `json:"items"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
}
type MemberPage struct {
	Items          []Member `json:"items"`
	Total          int      `json:"total"`
	Page           int      `json:"page"`
	PageSize       int      `json:"page_size"`
	MembershipETag string   `json:"membership_etag"`
}
type UserOption struct {
	ID       uint64 `db:"id" json:"id,string"`
	Username string `db:"username" json:"username"`
	Name     string `db:"display_name" json:"display_name"`
}
type TeamOption struct {
	ID      uint64 `json:"id,string"`
	Code    string `json:"code"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
}
type Repository interface {
	CollaborationUsers(Kind, uint64) ([]uint64, error)
	LockCollaboration(Kind, uint64, uint64) error
	Resource(Kind, uint64, uint64) (*Resource, error)
	Resources(Kind, uint64, Query) (Page, error)
	InsertResource(Kind, *Resource, []uint64) error
	SaveResource(Kind, *Resource) error
	Members(Kind, uint64) ([]Member, error)
	SetMember(Kind, uint64, uint64, string, time.Time) (bool, error)
	ProjectTeams(uint64, uint64) ([]Resource, error)
	TeamProjects(uint64, uint64, bool) ([]Resource, error)
	SetProjectTeam(uint64, uint64, bool, time.Time) (bool, error)
	EndTeam(uint64, time.Time) error
	BumpMembers(Kind, uint64) error
	CleanupShortcuts([]uint64, time.Time) error
	UserOptions(string) ([]UserOption, error)
}
