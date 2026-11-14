package collaboration

import (
	"context"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/media"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// IconFile has its own persistence and lifecycle; only image processing is shared.
type IconFile struct {
	ID         uint64     `db:"id"`
	Key        string     `db:"storage_key"`
	Hash       []byte     `db:"sha256"`
	Size       int        `db:"size_bytes"`
	UploaderID uint64     `db:"uploaded_by_user_id"`
	State      string     `db:"state"`
	ExpiresAt  *time.Time `db:"expires_at"`
	OrphanedAt *time.Time `db:"orphaned_at"`
	CreatedAt  time.Time  `db:"created_at"`
}
type IconRepository interface {
	Icons([]uint64, bool) (map[uint64]*IconFile, error)
	InsertIcon(*IconFile) error
	IconState(uint64, string, time.Time) error
	DeleteIcon(uint64) error
	IconOwner(uint64) (Kind, uint64, error)
	ExpiredIcons(time.Time) ([]IconFile, error)
	IconKeyExists(string) (bool, error)
}

func iconUnavailable() error {
	return httpx.E(409, "ICON_UPLOAD_UNAVAILABLE", "图标草稿不可用，请重新上传")
}
func bindIcon(tx identity.Tx, actor uint64, before, after *uint64) error {
	if ptrEqual(before, after) {
		return nil
	}
	r := tx.(IconRepository)
	ids := []uint64{}
	if before != nil {
		ids = append(ids, *before)
	}
	if after != nil {
		ids = append(ids, *after)
	}
	rows, err := r.Icons(ids, true)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if after != nil {
		v := rows[*after]
		if v == nil || v.UploaderID != actor || v.State != "staged" || v.ExpiresAt == nil || !now.Before(*v.ExpiresAt) {
			return iconUnavailable()
		}
		if err = r.IconState(*after, "attached", now); err != nil {
			return err
		}
	}
	if before != nil {
		return r.IconState(*before, "orphaned", now)
	}
	return nil
}
func (s *Service) StageIcon(ctx context.Context, raw string, f media.File) (*IconFile, *identity.Auth, error) {
	if !media.ValidIconKey(f.Key) || f.Size < 1 || f.Size > media.MaxOutput || len(f.Hash) != 32 {
		return nil, nil, httpx.Invalid("file", "invalid_image")
	}
	var out *IconFile
	a, e := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		now := time.Now().UTC()
		expiry := now.Add(24 * time.Hour)
		out = &IconFile{Key: f.Key, Hash: f.Hash, Size: f.Size, UploaderID: a.User.ID, State: "staged", ExpiresAt: &expiry, CreatedAt: now}
		return tx.(IconRepository).InsertIcon(out)
	})
	return out, a, e
}
func (s *Service) DeleteIconDraft(ctx context.Context, raw string, id uint64) (string, *identity.Auth, error) {
	key := ""
	a, e := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		r := tx.(IconRepository)
		rows, e := r.Icons([]uint64{id}, true)
		if e != nil {
			return e
		}
		v := rows[id]
		if v == nil || v.UploaderID != a.User.ID {
			return httpx.E(404, "NOT_FOUND", "图标草稿不存在")
		}
		if v.State != "staged" {
			return iconUnavailable()
		}
		key = v.Key
		return r.DeleteIcon(id)
	})
	return key, a, e
}
func (s *Service) ReadIcon(ctx context.Context, raw string, id uint64) (*IconFile, *identity.Auth, error) {
	var out *IconFile
	a, e := s.Identity.BusinessAccess(ctx, raw, nil, func(tx identity.Tx, a *identity.Auth) error {
		r := tx.(IconRepository)
		rows, e := r.Icons([]uint64{id}, false)
		if e != nil {
			return e
		}
		v := rows[id]
		missing := httpx.E(404, "NOT_FOUND", "图标不存在或不可见")
		if v == nil {
			return missing
		}
		switch v.State {
		case "staged":
			if v.UploaderID != a.User.ID || v.ExpiresAt == nil || !time.Now().Before(*v.ExpiresAt) {
				return missing
			}
		case "attached":
			k, owner, e := r.IconOwner(id)
			if e != nil {
				return e
			}
			if owner == 0 {
				return missing
			}
			obj, e := tx.(Repository).Resource(k, owner, a.User.ID)
			if e != nil {
				return e
			}
			if access(obj, a, false) != nil {
				if k != Team {
					return missing
				}
				projects, e := tx.(Repository).TeamProjects(owner, a.User.ID, false)
				if e != nil {
					return e
				}
				if len(projects) == 0 {
					return missing
				}
			}
		default:
			return missing
		}
		out = v
		return nil
	})
	return out, a, e
}
func CleanIcons(ctx context.Context, store identity.Store, files media.Store, now time.Time) error {
	var removed []IconFile
	err := store.Transact(ctx, func(tx identity.Tx) error {
		r := tx.(IconRepository)
		rows, e := r.ExpiredIcons(now)
		if e != nil {
			return e
		}
		removed = rows
		for _, v := range rows {
			if e = r.DeleteIcon(v.ID); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, v := range removed {
		if err = files.Remove(v.Key); err != nil {
			return err
		}
	}
	keys, err := files.Candidates(ctx, now.Add(-24*time.Hour))
	if err != nil {
		return err
	}
	for _, key := range keys {
		var exists bool
		err = store.Transact(ctx, func(tx identity.Tx) error { var e error; exists, e = tx.(IconRepository).IconKeyExists(key); return e })
		if err != nil {
			return err
		}
		if !exists {
			if err = files.Remove(key); err != nil {
				return err
			}
		}
	}
	return nil
}
