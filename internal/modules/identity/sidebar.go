package identity

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type Shortcut struct {
	ID         uint64  `db:"id" json:"id,string"`
	Code       string  `db:"code" json:"code"`
	Name       string  `db:"name" json:"name"`
	IconKey    *string `db:"icon_key" json:"icon_key"`
	IconFileID *uint64 `db:"icon_file_id" json:"icon_file_id,string"`
	Status     string  `db:"status" json:"status"`
	Order      int     `db:"sort_order" json:"sort_order"`
}
type ShortcutGroup struct {
	Items   []Shortcut `json:"items"`
	Version uint64     `json:"version,string"`
	ETag    string     `json:"etag"`
}
type Sidebar struct {
	Projects ShortcutGroup `json:"projects"`
	Teams    ShortcutGroup `json:"teams"`
}

// Optional collaboration storage port; existing account transaction test stores
// need not implement it. All calls stay inside the identity transaction.
type SidebarTx interface {
	Sidebar(uint64) (Sidebar, error)
	ReplaceShortcuts(uint64, string, []uint64, string, time.Time) (ShortcutGroup, error)
}

var sidebarTag = regexp.MustCompile(`^"sidebar-(projects|teams)-[1-9][0-9]*-v[1-9][0-9]*"$`)

func SidebarTag(kind string, userID, version uint64) string {
	return fmt.Sprintf(`"sidebar-%s-%d-v%d"`, kind, userID, version)
}
func ValidateShortcuts(kind string, raw []string, tag string) ([]uint64, error) {
	if kind != "projects" && kind != "teams" {
		return nil, httpx.Invalid("group", "invalid_value")
	}
	if tag == "" {
		return nil, httpx.E(428, "PRECONDITION_REQUIRED", "请先加载快捷方式")
	}
	if !sidebarTag.MatchString(tag) {
		return nil, httpx.Invalid("If-Match", "invalid_format")
	}
	if raw == nil || len(raw) > 200 {
		return nil, httpx.Invalid("ids", "invalid_length")
	}
	ids := make([]uint64, 0, len(raw))
	seen := map[uint64]bool{}
	for i, r := range raw {
		id, e := strconv.ParseUint(r, 10, 64)
		if e != nil || id == 0 || strconv.FormatUint(id, 10) != r || seen[id] {
			return nil, httpx.Invalid(fmt.Sprintf("ids.%d", i), "invalid_value")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids, nil
}
func (s *Service) Sidebar(ctx context.Context, raw string) (Sidebar, *Auth, error) {
	var out Sidebar
	a, e := s.execute(ctx, raw, policy{renew: true}, 0, func(tx Tx, a *Auth, _ *User) error {
		store, ok := tx.(SidebarTx)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "侧栏暂不可用")
		}
		var err error
		out, err = store.Sidebar(a.User.ID)
		return err
	})
	return out, a, e
}
func (s *Service) ReplaceShortcuts(ctx context.Context, raw, kind string, ids []string, tag string) (ShortcutGroup, *Auth, error) {
	var out ShortcutGroup
	parsed, e := ValidateShortcuts(kind, ids, tag)
	if e != nil {
		return out, nil, e
	}
	a, e := s.execute(ctx, raw, policy{renew: true}, 0, func(tx Tx, a *Auth, _ *User) error {
		store, ok := tx.(SidebarTx)
		if !ok {
			return httpx.E(503, "FEATURE_UNAVAILABLE", "侧栏暂不可用")
		}
		var err error
		out, err = store.ReplaceShortcuts(a.User.ID, kind, parsed, tag, s.now())
		return err
	})
	return out, a, e
}
