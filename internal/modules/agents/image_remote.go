package agents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type remoteImage struct {
	File        modelcore.RemoteImageFile   `json:"file"`
	Retired     []modelcore.RemoteImageFile `json:"retired,omitempty"`
	Scope       string                      `json:"scope"`
	Model       agentcore.LockedModel       `json:"model"`
	InlineUntil time.Time                   `json:"inline_until,omitempty"`
}

func (s *Service) resolveRemoteImage(ctx context.Context, model agentcore.LockedModel, client modelcore.ImageFileClient, part modelcore.ImagePart, load func(context.Context) (string, error)) (remoteImage, error) {
	scope := client.ImageFileScope()
	key := imageCacheKey(scope + "\x00" + part.Variant)
	raw, err := s.cachedImage(ctx, "remote", key, func(raw json.RawMessage) bool {
		var v remoteImage
		if json.Unmarshal(raw, &v) != nil || v.Scope != scope {
			return false
		}
		return v.InlineUntil.IsZero() && v.File.ID != "" && (v.File.ExpiresAt.IsZero() || time.Now().Add(20*time.Minute).Before(v.File.ExpiresAt)) || time.Now().Before(v.InlineUntil)
	}, func(ctx context.Context) (json.RawMessage, error) {
		var previous remoteImage
		if err := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			row, e := st.ImageCache("remote", key, false)
			if e != nil {
				return e
			}
			if row == nil {
				return integrity()
			}
			return json.Unmarshal(row.Payload, &previous)
		}); err != nil {
			return nil, err
		}
		previous.Scope, previous.Model = scope, model
		blocked, err := s.imageRouteBlocked(ctx, scope, nil)
		if err != nil {
			return nil, err
		}
		if blocked {
			previous.InlineUntil = time.Now().UTC().Add(time.Hour)
			return json.Marshal(previous)
		}
		// An expiring ID may still serve an in-flight request. Retain it until its
		// provider expiry or a full idle retention interval; do not eagerly delete.
		retired := []modelcore.RemoteImageFile{}
		for _, old := range append(previous.Retired, previous.File) {
			if old.ID != "" && (old.ExpiresAt.IsZero() || time.Now().Before(old.ExpiresAt)) {
				retired = append(retired, old)
			}
		}
		if len(retired) >= 32 {
			previous.InlineUntil = time.Now().UTC().Add(time.Hour)
			return json.Marshal(previous)
		}
		encoded, err := load(ctx)
		if err != nil {
			return nil, err
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, integrity()
		}
		remote, err := client.UploadImage(ctx, modelcore.ImageUpload{MIME: part.MIME, SHA256: part.ContentSHA256, Data: data})
		result := remoteImage{File: remote, Retired: retired, Scope: scope, Model: model}
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, modelcore.ErrAuthenticationFailed) {
				return nil, err
			}
			if !errors.Is(err, modelcore.ErrImageFilesUnavailable) && !errors.Is(err, modelcore.ErrRateLimited) && !errors.Is(err, modelcore.ErrTransport) && !errors.Is(err, modelcore.ErrRemoteService) && !errors.Is(err, modelcore.ErrRequestRejected) {
				return nil, err
			}
			if errors.Is(err, modelcore.ErrImageFilesUnavailable) {
				until := time.Now().UTC().Add(24 * time.Hour)
				if _, err = s.imageRouteBlocked(ctx, scope, &until); err != nil {
					return nil, err
				}
			}
			result.File = modelcore.RemoteImageFile{}
			result.InlineUntil = time.Now().UTC().Add(time.Hour)
		} else if !remote.ExpiresAt.IsZero() && !time.Now().Add(20*time.Minute).Before(remote.ExpiresAt) {
			// Keep ownership for cleanup even when a provider returns too short a TTL.
			result.InlineUntil = time.Now().UTC().Add(time.Hour)
		}
		return json.Marshal(result)
	})
	var result remoteImage
	if err == nil && json.Unmarshal(raw, &result) != nil {
		err = integrity()
	}
	return result, err
}
