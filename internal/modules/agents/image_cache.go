package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// Short transactions own the lease; file/network work never holds SQL locks.
// Token fencing prevents an expired worker from publishing over its successor.
func (s *Service) cachedImage(ctx context.Context, kind string, key []byte, valid func(json.RawMessage) bool, build func(context.Context) (json.RawMessage, error)) (json.RawMessage, error) {
	for {
		var payload json.RawMessage
		token := ""
		err := s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
			now := time.Now().UTC()
			if e := st.EnsureImageCache(kind, key, now); e != nil {
				return e
			}
			row, e := st.ImageCache(kind, key, true)
			if e != nil {
				return e
			}
			if row == nil {
				return integrity()
			}
			if row.State == "ready" && valid(row.Payload) {
				payload = append(json.RawMessage(nil), row.Payload...)
				row.LastUsedAt = now
				return st.SaveImageCache(kind, row)
			}
			if row.LeaseUntil != nil && now.Before(*row.LeaseUntil) {
				return nil
			}
			token = NewStorageKey()
			until := now.Add(3 * time.Minute)
			row.State = "building"
			row.LeaseToken = token
			row.LeaseUntil = &until
			row.LastUsedAt = now
			row.UpdatedAt = now
			return st.SaveImageCache(kind, row)
		})
		if err != nil {
			return nil, err
		}
		if payload != nil {
			return payload, nil
		}
		if token == "" {
			timer := time.NewTimer(100 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
			continue
		}
		buildCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		result, buildErr := build(buildCtx)
		cancel()
		finish, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err = s.background(finish, func(_ identity.Tx, _ Repository, st StateRepository) error {
			row, e := st.ImageCache(kind, key, true)
			if e != nil {
				return e
			}
			if row == nil || row.LeaseToken != token {
				return httpx.E(409, "IMAGE_CACHE_FENCED", "图像缓存准备已失效")
			}
			row.LeaseToken = ""
			row.LeaseUntil = nil
			row.UpdatedAt = time.Now().UTC()
			row.State = "empty"
			if buildErr == nil {
				row.State = "ready"
				row.Payload = result
			}
			return st.SaveImageCache(kind, row)
		})
		finishCancel()
		if err != nil {
			return nil, err
		}
		return result, buildErr
	}
}

// Authorize the original source even when a remote reference needs no disk IO.
func (s *Service) authorizeImage(ctx context.Context, ref *agentcore.ExecutionRef, record *agentcore.CompactionRecord, part modelcore.ImagePart) (*FileRow, uint64, error) {
	if s.Files == nil {
		return nil, 0, unavailable()
	}
	hash, err := hex.DecodeString(part.ContentSHA256)
	if err != nil || len(hash) != 32 {
		return nil, 0, integrity()
	}
	var file *FileRow
	var lease ResourceReferenceRow
	err = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		var x executionRows
		var e error
		if record != nil {
			x, _, e = s.compactionExecution(tx, r, st, *record)
		} else if ref != nil {
			x, e = s.lockExecution(tx, r, st, *ref, true)
		} else {
			return integrity()
		}
		if e != nil {
			return e
		}
		file, e = st.FileByHash(x.RootSession.ID, hash)
		if e != nil {
			return e
		}
		if file == nil || file.MediaType != part.MIME || !isImage(file.MediaType) || file.SizeBytes == nil || *file.SizeBytes > modelcore.MaxImageBytes {
			return httpx.E(409, "FILE_UNAVAILABLE", "图像文件不可用")
		}
		now := time.Now().UTC()
		lease = ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		if ref != nil {
			lease.ExecutorEpoch = ref.Epoch
			lease.FenceVersion = ref.Fence
		}
		return st.InsertResourceReference(&lease)
	})
	return file, lease.ID, err
}

func (s *Service) imageBytes(ctx context.Context, key, hash string, size int64) (string, error) {
	return s.imageMemory.get(ctx, key+":"+hash, func() (string, error) {
		reader, err := s.Files.Open(key)
		if err != nil {
			return "", httpx.E(409, "FILE_UNAVAILABLE", "图像文件不可用")
		}
		defer func() { _ = reader.Close() }()
		data, err := io.ReadAll(io.LimitReader(contextReader{ctx, reader}, modelcore.MaxImageBytes+1))
		if err != nil {
			return "", err
		}
		digest := sha256.Sum256(data)
		if int64(len(data)) != size || hex.EncodeToString(digest[:]) != hash {
			return "", httpx.E(409, "FILE_INTEGRITY_FAILED", "图像文件完整性校验失败")
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})
}

func (s *Service) prepareImage(ctx context.Context, model agentcore.LockedModel, client modelcore.ImageFileClient, source modelcore.ImagePart, file *FileRow) (modelcore.ImagePart, error) {
	key := variantKey(source.ContentSHA256)
	payload, err := s.cachedImage(ctx, "variant", imageCacheKey(key), func(raw json.RawMessage) bool {
		var v imageVariant
		return json.Unmarshal(raw, &v) == nil && v.Part.Variant == key && v.StorageKey != ""
	}, func(ctx context.Context) (json.RawMessage, error) {
		encoded, e := s.imageBytes(ctx, file.StorageKey, source.ContentSHA256, int64(*file.SizeBytes))
		if e != nil {
			return nil, e
		}
		data, e := base64.StdEncoding.DecodeString(encoded)
		if e != nil {
			return nil, integrity()
		}
		part, output, e := requestImageVariant(data, source)
		if e != nil {
			return nil, e
		}
		v := imageVariant{Part: part, StorageKey: file.StorageKey}
		if part.ContentSHA256 != source.ContentSHA256 {
			// Deterministic private name also permits crash-safe reconstruction.
			v.StorageKey = hex.EncodeToString(imageCacheKey(key))[:32]
			v.Owned = true
			facts, e := s.Files.Inspect(ctx, v.StorageKey, modelcore.MaxImageBytes)
			if e != nil || hex.EncodeToString(facts.SHA256) != part.ContentSHA256 {
				if e = s.Files.Delete(v.StorageKey); e != nil {
					return nil, e
				}
				if _, e = s.Files.Write(ctx, v.StorageKey, bytes.NewReader(output), imageVariantLimit); e != nil {
					return nil, e
				}
			}
		}
		return json.Marshal(v)
	})
	if err != nil {
		return source, err
	}
	var variant imageVariant
	if json.Unmarshal(payload, &variant) != nil {
		return source, integrity()
	}
	part := variant.Part
	part.Origin = source.Origin
	// Originals may be identical but stored under another session's private key.
	if !variant.Owned {
		variant.StorageKey = file.StorageKey
	}
	load := func(ctx context.Context) (string, error) {
		encoded, e := s.imageBytes(ctx, variant.StorageKey, part.ContentSHA256, part.Bytes)
		if e == nil || !variant.Owned {
			return encoded, e
		}
		// Missing/corrupt derived bytes are rebuildable, original evidence is not.
		original, e := s.imageBytes(ctx, file.StorageKey, source.ContentSHA256, int64(*file.SizeBytes))
		if e != nil {
			return "", e
		}
		data, e := base64.StdEncoding.DecodeString(original)
		if e != nil {
			return "", integrity()
		}
		rebuilt, output, e := requestImageVariant(data, source)
		if e != nil {
			return "", e
		}
		if rebuilt.ContentSHA256 != part.ContentSHA256 {
			return "", integrity()
		}
		// Rebuild under the same cross-process cache lease.
		_, e = s.cachedImage(ctx, "variant", imageCacheKey(key), func(json.RawMessage) bool { return false }, func(ctx context.Context) (json.RawMessage, error) {
			if err := s.Files.Delete(variant.StorageKey); err != nil {
				return nil, err
			}
			if _, err := s.Files.Write(ctx, variant.StorageKey, bytes.NewReader(output), imageVariantLimit); err != nil {
				return nil, err
			}
			return payload, nil
		})
		if e != nil {
			return "", e
		}
		return s.imageBytes(ctx, variant.StorageKey, part.ContentSHA256, part.Bytes)
	}
	if client != nil && client.ImageFileScope() != "" {
		remote, e := s.resolveRemoteImage(ctx, model, client, part, load)
		if e != nil {
			return source, e
		}
		if remote.File.ID != "" && remote.InlineUntil.IsZero() {
			part.FileID = remote.File.ID
			part.FileScope = remote.Scope
			part.FileStyle = client.ImageFileStyle()
			return part, nil
		}
	}
	part.DataBase64, err = load(ctx)
	return part, err
}

func (s *Service) prepareImages(ctx context.Context, model agentcore.LockedModel, ref *agentcore.ExecutionRef, record *agentcore.CompactionRecord, request *modelcore.Request) error {
	hasImages := false
	for _, m := range request.Messages {
		hasImages = hasImages || len(m.Images) > 0
	}
	if !hasImages {
		return nil
	}
	var files modelcore.ImageFileClient
	if s.RuntimeModels != nil {
		client, e := s.RuntimeModels.Open(ctx, model)
		if e != nil {
			return e
		}
		files, _ = client.(modelcore.ImageFileClient)
	}
	dedup := map[string]modelcore.ImagePart{}
	for i := range request.Messages {
		for j := range request.Messages[i].Images {
			source := request.Messages[i].Images[j]
			if part, ok := dedup[source.ContentSHA256]; ok {
				part.Origin = source.Origin
				request.Messages[i].Images[j] = part
				continue
			}
			file, lease, e := s.authorizeImage(ctx, ref, record, source)
			if e != nil {
				return e
			}
			part, e := s.prepareImage(ctx, model, files, source, file)
			_ = s.releaseFileLease(ctx, lease)
			if e != nil {
				return e
			}
			dedup[source.ContentSHA256] = part
			request.Messages[i].Images[j] = part
		}
	}
	return nil
}
