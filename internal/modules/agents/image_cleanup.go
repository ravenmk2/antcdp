package agents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

// Idle cache retention is independent of original attachment retention. Only
// owned derived blobs and provider IDs in the exact credential scope are removed.
func (s *Service) ProcessImageCacheMaintenance(ctx context.Context, limit int) error {
	before := time.Now().UTC().Add(-7 * 24 * time.Hour)
	for _, kind := range []string{"variant", "remote"} {
		var candidates []ImageCacheRow
		err := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			var e error
			candidates, e = st.ImageCacheCandidates(kind, before, limit)
			return e
		})
		if err != nil {
			return err
		}
		for _, candidate := range candidates {
			token := NewStorageKey()
			claimed := false
			err = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
				row, e := st.ImageCache(kind, candidate.Key, true)
				if e != nil {
					return e
				}
				now := time.Now().UTC()
				if row == nil || !row.LastUsedAt.Before(before) || row.LeaseUntil != nil && now.Before(*row.LeaseUntil) {
					return nil
				}
				candidate = *row
				until := now.Add(3 * time.Minute)
				row.State = "deleting"
				row.LeaseToken = token
				row.LeaseUntil = &until
				claimed = true
				return st.SaveImageCache(kind, row)
			})
			if err != nil {
				return err
			}
			if !claimed {
				continue
			}
			work, cancel := context.WithTimeout(ctx, 2*time.Minute)
			removed := false
			if kind == "variant" {
				var variant imageVariant
				if json.Unmarshal(candidate.Payload, &variant) != nil {
					cancel()
					return integrity()
				}
				if variant.Owned {
					err = s.Files.Delete(variant.StorageKey)
				} else if variant.StorageKey == "" {
					err = s.Files.Delete(hex.EncodeToString(candidate.Key)[:32])
				}
				removed = err == nil
			} else {
				var remote remoteImage
				if json.Unmarshal(candidate.Payload, &remote) != nil {
					cancel()
					return integrity()
				}
				owned := append(remote.Retired, remote.File)
				removed = true
				var files modelcore.ImageFileClient
				for _, file := range owned {
					if file.ID == "" || !file.ExpiresAt.IsZero() && time.Now().After(file.ExpiresAt) {
						continue
					}
					if files == nil && s.RuntimeModels != nil {
						client, e := s.RuntimeModels.Open(work, remote.Model)
						if e == nil {
							files, _ = client.(modelcore.ImageFileClient)
						}
					}
					if files == nil || files.ImageFileScope() != remote.Scope || files.DeleteImage(work, file.ID) != nil {
						removed = false
						break
					}
				}
			}
			cancel()
			if err != nil {
				return err
			}
			err = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
				if removed {
					return st.DeleteImageCache(kind, candidate.Key, token)
				}
				row, e := st.ImageCache(kind, candidate.Key, true)
				if e != nil {
					return e
				}
				if row == nil || row.LeaseToken != token {
					return nil
				}
				// Retain undeletable ownership records, retry later without a tight loop.
				row.State = candidate.State
				row.LeaseToken = ""
				row.LeaseUntil = nil
				row.LastUsedAt = time.Now().UTC().Add(-6 * 24 * time.Hour)
				return st.SaveImageCache(kind, row)
			})
			if err != nil {
				return err
			}
		}
	}
	return nil
}
