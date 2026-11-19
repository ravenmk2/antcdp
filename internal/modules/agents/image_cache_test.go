package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type imageCacheMemory struct {
	identity.Store
	Repository
	StateRepository
	mu   sync.Mutex
	rows map[string]ImageCacheRow
}
type imageCacheTx struct {
	identity.Tx
	memory *imageCacheMemory
}

func (t imageCacheTx) Agents() Repository          { return t.memory }
func (t imageCacheTx) AgentState() StateRepository { return t.memory }
func (m *imageCacheMemory) Transact(_ context.Context, fn func(identity.Tx) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return fn(imageCacheTx{memory: m})
}
func (m *imageCacheMemory) EnsureImageCache(kind string, key []byte, now time.Time) error {
	k := kind + string(key)
	if _, ok := m.rows[k]; !ok {
		m.rows[k] = ImageCacheRow{Key: key, State: "empty", Payload: json.RawMessage(`{}`), CreatedAt: now, UpdatedAt: now, LastUsedAt: now}
	}
	return nil
}
func (m *imageCacheMemory) ImageCache(kind string, key []byte, _ bool) (*ImageCacheRow, error) {
	row, ok := m.rows[kind+string(key)]
	if !ok {
		return nil, nil
	}
	return &row, nil
}
func (m *imageCacheMemory) SaveImageCache(kind string, row *ImageCacheRow) error {
	m.rows[kind+string(row.Key)] = *row
	return nil
}
func (m *imageCacheMemory) ImageCacheCandidates(kind string, before time.Time, _ int) ([]ImageCacheRow, error) {
	var rows []ImageCacheRow
	for key, row := range m.rows {
		if strings.HasPrefix(key, kind) && row.LastUsedAt.Before(before) {
			rows = append(rows, row)
		}
	}
	return rows, nil
}
func (m *imageCacheMemory) DeleteImageCache(kind string, key []byte, token string) error {
	if row := m.rows[kind+string(key)]; row.LeaseToken == token {
		delete(m.rows, kind+string(key))
	}
	return nil
}

func imageCacheFixture(t *testing.T) (*Service, *imageCacheMemory, modelcore.ImagePart, *FileRow) {
	t.Helper()
	memory := &imageCacheMemory{rows: map[string]ImageCacheRow{}}
	files, err := NewByteStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Files: files, Store: func() (identity.Store, error) { return memory, nil }}
	var buf bytes.Buffer
	if err = png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	key := NewStorageKey()
	facts, err := files.Write(t.Context(), key, &buf, 1024)
	if err != nil {
		t.Fatal(err)
	}
	part := modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(facts.SHA256)}
	return service, memory, part, &FileRow{StorageKey: key, SHA256: facts.SHA256, SizeBytes: &facts.Size, MediaType: part.MIME}
}

type imageFileFake struct {
	uploads atomic.Int32
	deletes atomic.Int32
	scope   string
	err     error
	expiry  time.Time
}

func (f *imageFileFake) ImageFileScope() string { return f.scope }
func (f *imageFileFake) ImageFileStyle() string { return "deepseek" }
func (f *imageFileFake) UploadImage(context.Context, modelcore.ImageUpload) (modelcore.RemoteImageFile, error) {
	f.uploads.Add(1)
	return modelcore.RemoteImageFile{ID: "file-fixture", ExpiresAt: f.expiry}, f.err
}
func (f *imageFileFake) DeleteImage(context.Context, string) error { f.deletes.Add(1); return nil }
func (f *imageFileFake) Generate(context.Context, modelcore.Request, modelcore.Emit) (modelcore.Response, error) {
	return modelcore.Response{}, nil
}

type imageFactory struct{ client modelcore.Client }

func (f imageFactory) Open(context.Context, agentcore.LockedModel) (modelcore.Client, error) {
	return f.client, nil
}

func TestImageCacheConcurrentRestartAndScope(t *testing.T) {
	service, memory, part, file := imageCacheFixture(t)
	client := &imageFileFake{scope: strings.Repeat("a", 64)}
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			worker := &Service{Files: service.Files, Store: service.Store}
			got, err := worker.prepareImage(t.Context(), agentcore.LockedModel{}, client, part, file)
			if err != nil || got.FileID != "file-fixture" || got.DataBase64 != "" {
				t.Error(got, err)
			}
		})
	}
	wg.Wait()
	if client.uploads.Load() != 1 {
		t.Fatal("duplicate upload", client.uploads.Load())
	}
	// No memory cache and no readable file: a durable remote hit needs zero disk IO.
	restarted := &Service{Files: service.Files, Store: service.Store}
	if err := service.Files.Delete(file.StorageKey); err != nil {
		t.Fatal(err)
	}
	got, err := restarted.prepareImage(t.Context(), agentcore.LockedModel{}, client, part, file)
	if err != nil || got.FileID != "file-fixture" {
		t.Fatal("restart reread original", err)
	}
	rotated := &imageFileFake{scope: strings.Repeat("b", 64)}
	if _, err = restarted.prepareImage(t.Context(), agentcore.LockedModel{}, rotated, part, file); err == nil {
		t.Fatal("foreign mapping reused")
	}
	if rotated.uploads.Load() != 0 {
		t.Fatal("invalid source uploaded")
	}
	memory.mu.Lock()
	for key, row := range memory.rows {
		row.LastUsedAt = time.Now().Add(-8 * 24 * time.Hour)
		memory.rows[key] = row
	}
	memory.mu.Unlock()
	restarted.RuntimeModels = imageFactory{client}
	if err = restarted.ProcessImageCacheMaintenance(t.Context(), 10); err != nil {
		t.Fatal(err)
	}
	if client.deletes.Load() != 1 {
		t.Fatal("owned remote not cleaned")
	}
}

func TestImageCacheFallbackAndExpiry(t *testing.T) {
	for _, failure := range []error{modelcore.ErrImageFilesUnavailable, modelcore.ErrRateLimited, modelcore.ErrAuthenticationFailed} {
		t.Run(failure.Error(), func(t *testing.T) {
			s, _, p, f := imageCacheFixture(t)
			client := &imageFileFake{scope: strings.Repeat("a", 64), err: failure}
			got, err := s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f)
			if errors.Is(failure, modelcore.ErrAuthenticationFailed) {
				if !errors.Is(err, failure) {
					t.Fatal(err)
				}
				return
			}
			if err != nil || got.DataBase64 == "" || got.FileID != "" {
				t.Fatal(got, err)
			}
			_, err = s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f)
			if err != nil || client.uploads.Load() != 1 {
				t.Fatal("backoff not reused", err)
			}
		})
	}
	s, m, p, f := imageCacheFixture(t)
	client := &imageFileFake{scope: strings.Repeat("a", 64), expiry: time.Now().Add(time.Hour)}
	if _, err := s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	for key, row := range m.rows {
		if strings.HasPrefix(key, "remote") {
			var r remoteImage
			_ = json.Unmarshal(row.Payload, &r)
			r.File.ExpiresAt = time.Now().Add(-time.Minute)
			row.Payload, _ = json.Marshal(r)
			m.rows[key] = row
		}
	}
	m.mu.Unlock()
	if _, err := s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f); err != nil || client.uploads.Load() != 2 {
		t.Fatal("expired reference reused", err)
	}
}

func TestImageMemoryDedupEvictionCancellation(t *testing.T) {
	var cache imageMemory
	var loads atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			_, err := cache.get(t.Context(), "same", func() (string, error) { loads.Add(1); return "verified", nil })
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if loads.Load() != 1 {
		t.Fatal(loads.Load())
	}
	for _, key := range []string{"large-a", "large-b", "large-c"} {
		if _, err := cache.get(t.Context(), key, func() (string, error) { return strings.Repeat("x", 24<<20), nil }); err != nil {
			t.Fatal(err)
		}
	}
	if cache.size > imageMemoryLimit || len(cache.entries) != 2 {
		t.Fatal("unbounded image memory", cache.size)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := cache.get(ctx, "new", func() (string, error) { t.Fatal("cancelled load executed"); return "", nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestImageVariantDeterministicAndLosslessSmallImage(t *testing.T) {
	for _, width := range []int{24, 3000} {
		picture := image.NewNRGBA(image.Rect(0, 0, width, 40))
		picture.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 128})
		var buffer bytes.Buffer
		if err := png.Encode(&buffer, picture); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(buffer.Bytes())
		source := modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(hash[:])}
		a, x, err := requestImageVariant(buffer.Bytes(), source)
		if err != nil {
			t.Fatal(err)
		}
		b, y, err := requestImageVariant(buffer.Bytes(), source)
		if err != nil || a != b || !bytes.Equal(x, y) {
			t.Fatal("unstable version", err)
		}
		if a.Width > 2048 || len(x) > imageVariantLimit || a.SourceSHA256 != source.ContentSHA256 {
			t.Fatal(a)
		}
		if width == 24 && !bytes.Equal(x, buffer.Bytes()) {
			t.Fatal("small image changed")
		}
	}
}

func TestImageVariantAcceptsAttachmentPixelLimit(t *testing.T) {
	const dimension = attachmentImageMaxDimension
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewGray(image.Rect(0, 0, dimension, dimension))); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(buffer.Bytes())
	source := modelcore.ImagePart{MIME: "image/png", ContentSHA256: hex.EncodeToString(hash[:])}
	part, data, err := requestImageVariant(buffer.Bytes(), source)
	if err != nil || part.Width != 2048 || part.Height != 2048 || len(data) > imageVariantLimit {
		t.Fatalf("could not prepare an image at the attachment pixel limit: %+v (%v)", part, err)
	}
}
