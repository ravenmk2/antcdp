package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestImageCacheLeaseCancellationAndFencing(t *testing.T) {
	s, m, _, _ := imageCacheFixture(t)
	key := imageCacheKey("lease")
	started := make(chan struct{})
	resume := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := s.cachedImage(t.Context(), "remote", key, func(json.RawMessage) bool { return false }, func(context.Context) (json.RawMessage, error) {
			close(started)
			<-resume
			return json.RawMessage(`{"old":true}`), nil
		})
		done <- err
	}()
	<-started
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, err := s.cachedImage(ctx, "remote", key, func(json.RawMessage) bool { return false }, func(context.Context) (json.RawMessage, error) { t.Error("live lease stolen"); return nil, nil }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	m.mu.Lock()
	row := m.rows["remote"+string(key)]
	row.LeaseToken = "successor"
	row.Payload = json.RawMessage(`{"new":true}`)
	m.rows["remote"+string(key)] = row
	m.mu.Unlock()
	close(resume)
	if err := <-done; err == nil {
		t.Fatal("expired worker published")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if string(m.rows["remote"+string(key)].Payload) != `{"new":true}` {
		t.Fatal("successor overwritten")
	}
}

func TestImageRouteBackoffAndRetiredFileSafety(t *testing.T) {
	s, _, p, f := imageCacheFixture(t)
	client := &imageFileFake{scope: strings.Repeat("a", 64), err: modelcore.ErrImageFilesUnavailable}
	if _, err := s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f); err != nil {
		t.Fatal(err)
	}
	// A different request version must not probe the unsupported endpoint again.
	p.Variant = "new-version"
	p.ContentSHA256 = "different"
	result, err := s.resolveRemoteImage(t.Context(), agentcore.LockedModel{}, client, p, func(context.Context) (string, error) { t.Error("blocked route read bytes"); return "", nil })
	if err != nil || result.InlineUntil.IsZero() || client.uploads.Load() != 1 {
		t.Fatal(err, result)
	}
	var m *imageCacheMemory
	s, m, p, f = imageCacheFixture(t)
	client = &imageFileFake{scope: strings.Repeat("b", 64), expiry: time.Now().Add(time.Hour)}
	prepared, err := s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f)
	if err != nil {
		t.Fatal(err)
	}
	key := "remote" + string(imageCacheKey(client.scope+"\x00"+prepared.Variant))
	m.mu.Lock()
	row := m.rows[key]
	var remote remoteImage
	_ = json.Unmarshal(row.Payload, &remote)
	remote.File.ExpiresAt = time.Now().Add(10 * time.Minute)
	row.Payload, _ = json.Marshal(remote)
	m.rows[key] = row
	m.mu.Unlock()
	if _, err = s.prepareImage(t.Context(), agentcore.LockedModel{}, client, p, f); err != nil {
		t.Fatal(err)
	}
	if client.deletes.Load() != 0 || client.uploads.Load() != 2 {
		t.Fatal("in-flight file deleted")
	}
	m.mu.Lock()
	row = m.rows[key]
	m.mu.Unlock()
	if json.Unmarshal(row.Payload, &remote) != nil || len(remote.Retired) != 1 {
		t.Fatal("retired ownership lost")
	}
}

func TestJPEGOrientationBeforeResize(t *testing.T) {
	// EXIF little-endian SHORT orientation=6, with a rotated corner marker.
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	pic := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	pic.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, pic, nil); err != nil {
		t.Fatal(err)
	}
	raw := append([]byte{255, 216, 255, 225, 0, byte(len(exif) + 2)}, exif...)
	raw = append(raw, buf.Bytes()[2:]...)
	if jpegOrientation(raw) != 6 || jpegOrientation(raw[:10]) != 1 {
		t.Fatal("orientation parse")
	}
	rotated := orientImage(pic, 6)
	if rotated.Bounds().Dx() != 2 || rotated.Bounds().Dy() != 3 {
		t.Fatal(rotated.Bounds())
	}
	if r, _, _, _ := rotated.At(1, 0).RGBA(); r != 65535 {
		t.Fatal("wrong rotation")
	}
	for orientation := 1; orientation <= 8; orientation++ {
		if orientImage(pic, orientation) == nil {
			t.Fatal(orientation)
		}
	}
}

func TestFrozenImageProjectionReconstructsTransport(t *testing.T) {
	history := modelcore.Message{Role: "user", Content: "original", Images: []modelcore.ImagePart{{MIME: "image/png", ContentSHA256: strings.Repeat("a", 64)}}}
	request := modelcore.Request{Model: "vision", Protocol: modelcore.AnthropicMessages, Messages: []modelcore.Message{history}}
	request.Messages[0].Images = []modelcore.ImagePart{{MIME: "image/png", SourceSHA256: history.Images[0].ContentSHA256, ContentSHA256: strings.Repeat("b", 64), Variant: "stable-version", FileID: "file-owned", FileScope: strings.Repeat("c", 64), FileStyle: "messages"}}
	snapshot, err := snapshotRequest(request, agentcore.LockedModel{}, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var restored attemptSnapshot
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	rebuilt := request
	rebuilt.Messages = []modelcore.Message{history}
	for _, entry := range restored.Images {
		rebuilt.Messages[entry.Message].Images = entry.Parts
	}
	want, _ := agentcore.ContentHash(request)
	got, _ := agentcore.ContentHash(rebuilt)
	if got != want {
		t.Fatal("image wire metadata cannot be reconstructed")
	}
}
