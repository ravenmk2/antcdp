package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// A rejected reference changes the next step's transport, never an admitted
// retry. Keep the old ID for owned-file cleanup; pin inline fallback for an hour.
func (s *Service) RepairImageFiles(ctx context.Context, step agentcore.PreparedStep) error {
	return s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		if _, err := s.lockExecution(tx, r, st, step.Ref, true); err != nil {
			return err
		}
		return invalidateImageFiles(st, step.Request)
	})
}

func invalidateImageFiles(st StateRepository, request modelcore.Request) error {
	for _, message := range request.Messages {
		for _, part := range message.Images {
			if part.FileID != "" {
				row, err := st.ImageCache("remote", imageCacheKey(part.FileScope+"\x00"+part.Variant), true)
				if err != nil {
					return err
				}
				if row == nil {
					continue
				}
				var remote remoteImage
				if json.Unmarshal(row.Payload, &remote) != nil {
					return integrity()
				}
				if remote.File.ID != part.FileID {
					continue
				}
				remote.InlineUntil = time.Now().UTC().Add(time.Hour)
				row.Payload, err = json.Marshal(remote)
				if err != nil {
					return err
				}
				row.UpdatedAt = time.Now().UTC()
				if err = st.SaveImageCache("remote", row); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
