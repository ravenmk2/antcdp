package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Do not upload every new image to an endpoint known not to implement Files.
// Scope includes credentials; changing a route/key starts a fresh capability check.
func (s *Service) imageRouteBlocked(ctx context.Context, scope string, until *time.Time) (bool, error) {
	blocked := false
	key := imageCacheKey("route\x00" + scope)
	err := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		now := time.Now().UTC()
		if until != nil {
			if err := st.EnsureImageCache("remote", key, now); err != nil {
				return err
			}
		}
		row, err := st.ImageCache("remote", key, until != nil)
		if err != nil || row == nil {
			return err
		}
		var entry remoteImage
		if json.Unmarshal(row.Payload, &entry) != nil {
			return integrity()
		}
		if until != nil {
			entry = remoteImage{Scope: scope, InlineUntil: *until}
			row.Payload, err = json.Marshal(entry)
			if err != nil {
				return err
			}
			row.State = "ready"
			row.LastUsedAt = now
			row.UpdatedAt = now
			if err = st.SaveImageCache("remote", row); err != nil {
				return err
			}
		}
		blocked = entry.Scope == scope && now.Before(entry.InlineUntil)
		return nil
	})
	return blocked, err
}
