package modeladapters

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestImageFilesRoutesAndWire(t *testing.T) {
	for _, test := range []struct {
		provider modelcore.ProviderType
		protocol modelcore.Protocol
		path     string
	}{{modelcore.DeepSeek, modelcore.ChatCompletions, "/files"}, {modelcore.DeepSeek, modelcore.AnthropicMessages, "/anthropic/v1/files"}, {modelcore.Custom, modelcore.AnthropicMessages, "/v1/files"}} {
		t.Run(string(test.provider)+"/"+string(test.protocol), func(t *testing.T) {
			input := []byte("verified-image-fixture")
			hash := sha256.Sum256(input)
			digest := hex.EncodeToString(hash[:])
			uploads, deletes := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != test.path && r.URL.Path != test.path+"/file-fixture" {
					t.Error("wrong path", r.URL.Path)
				}
				if test.protocol == modelcore.ChatCompletions {
					if r.Header.Get("Authorization") != "Bearer fixture-secret" {
						t.Error("missing bearer")
					}
				} else if r.Header.Get("x-api-key") != "fixture-secret" || (test.provider == modelcore.DeepSeek && r.Header.Get("anthropic-beta") == "") || (test.provider == modelcore.Custom && r.Header.Get("anthropic-beta") != "") {
					t.Error("missing messages headers")
				}
				if r.Method == "DELETE" {
					deletes++
					w.WriteHeader(204)
					return
				}
				uploads++
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = r.MultipartForm.RemoveAll() }()
				file, header, err := r.FormFile("file")
				if err != nil {
					t.Error(err)
					return
				}
				defer func() { _ = file.Close() }()
				data, _ := io.ReadAll(file)
				if string(data) != string(input) || header.Header.Get("Content-Type") != "image/png" {
					t.Error("wrong upload")
				}
				if test.provider == modelcore.DeepSeek && (r.FormValue("purpose") != "user_data" || r.FormValue("expires_after[seconds]") != "604800") {
					t.Error("missing expiry")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "file-fixture", "size_bytes": len(data), "expires_at": time.Now().Add(24 * time.Hour).Unix()})
			}))
			defer server.Close()
			c, err := NewClient(Config{Provider: test.provider, Protocol: test.protocol, BaseURL: server.URL, APIKey: "fixture-secret"}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			remote, err := c.UploadImage(t.Context(), modelcore.ImageUpload{MIME: "image/png", SHA256: digest, Data: input})
			if err != nil || remote.ID != "file-fixture" {
				t.Fatal(remote, err)
			}
			part := modelcore.ImagePart{MIME: "image/png", ContentSHA256: digest, FileID: remote.ID, FileScope: c.ImageFileScope(), FileStyle: c.ImageFileStyle()}
			request := modelcore.Request{Protocol: test.protocol, Model: "vision", Messages: []modelcore.Message{{Role: "user", Content: "inspect", Images: []modelcore.ImagePart{part}}}, Parameters: map[string]json.RawMessage{"max_output_tokens": json.RawMessage(`64`)}}
			body, _, err := encodeBoundRequest(test.provider, request)
			if err != nil {
				t.Fatal(err)
			}
			text := string(body)
			if !strings.Contains(text, `"file_id":"file-fixture"`) || strings.Contains(text, "base64") || strings.Contains(text, "file_scope") || strings.Contains(text, "fixture-secret") {
				t.Fatal("invalid wire", text)
			}
			if err = c.DeleteImage(t.Context(), remote.ID); err != nil || uploads != 1 || deletes != 1 {
				t.Fatal(err, uploads, deletes)
			}
			other, _ := NewClient(Config{Provider: test.provider, Protocol: test.protocol, BaseURL: server.URL, APIKey: "rotated"}, server.Client())
			if c.ImageFileScope() == other.ImageFileScope() {
				t.Fatal("scope survived rotation")
			}
			if _, err = other.Generate(t.Context(), request, nil); !errors.Is(err, modelcore.ErrImageFileRejected) {
				t.Fatal("foreign scoped file accepted", err)
			}
		})
	}
}

func TestImageFilesFailureClassification(t *testing.T) {
	for _, status := range []int{404, 405, 501, 401, 403, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			c, _ := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: "https://example.test", APIKey: "secret"}, &http.Client{Transport: imageTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"private":"secret"}`))}, nil
			})})
			h := sha256.Sum256([]byte("image"))
			_, err := c.UploadImage(t.Context(), modelcore.ImageUpload{MIME: "image/png", SHA256: hex.EncodeToString(h[:]), Data: []byte("image")})
			expected := modelcore.ErrRemoteService
			switch status {
			case 404, 405, 501:
				expected = modelcore.ErrImageFilesUnavailable
			case 401, 403:
				expected = modelcore.ErrAuthenticationFailed
			case 429:
				expected = modelcore.ErrRateLimited
			}
			if !errors.Is(err, expected) || strings.Contains(err.Error(), "secret") {
				t.Fatal("wrong safe failure", err)
			}
		})
	}
	for _, test := range []struct {
		message string
		want    bool
	}{{"file_id file-known not found", true}, {"file-known expired", true}, {"model not found", false}, {"file-other not found", false}, {"maximum context exceeded", false}} {
		body, _ := json.Marshal(map[string]any{"error": map[string]string{"message": test.message}})
		response := &http.Response{StatusCode: 400, Body: io.NopCloser(strings.NewReader(string(body)))}
		if got := rejectedImageFile(response, modelcore.Request{Messages: []modelcore.Message{{Images: []modelcore.ImagePart{{FileID: "file-known"}}}}}); got != test.want {
			t.Fatal(test.message, got)
		}
	}
}

type imageTransport func(*http.Request) (*http.Response, error)

func (f imageTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFileUploadCancellation(t *testing.T) {
	c, _ := NewClient(Config{Provider: modelcore.DeepSeek, Protocol: modelcore.ChatCompletions, BaseURL: "https://example.test", APIKey: "secret"}, &http.Client{Transport: imageTransport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	h := sha256.Sum256([]byte("x"))
	_, err := c.UploadImage(ctx, modelcore.ImageUpload{MIME: "image/png", SHA256: hex.EncodeToString(h[:]), Data: []byte("x")})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestMessagesImageFileProviderHeaders(t *testing.T) {
	for _, provider := range []modelcore.ProviderType{modelcore.DeepSeek, modelcore.Custom} {
		c, _ := NewClient(Config{Provider: provider, Protocol: modelcore.AnthropicMessages, BaseURL: "https://example.test", APIKey: "key"}, &http.Client{Transport: imageTransport(func(r *http.Request) (*http.Response, error) {
			if got := r.Header.Get("anthropic-beta"); (provider == modelcore.DeepSeek) != (got == "files-api-2025-04-14") {
				t.Error("wrong Files compatibility header", provider, got)
			}
			return &http.Response{StatusCode: 400, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"file-known not found"}}`))}, nil
		})})
		request := testRequest(modelcore.AnthropicMessages)
		request.Messages[0].Images = []modelcore.ImagePart{{MIME: "image/png", ContentSHA256: strings.Repeat("a", 64), FileID: "file-known", FileScope: c.ImageFileScope(), FileStyle: c.ImageFileStyle()}}
		if _, err := c.Generate(t.Context(), request, nil); !errors.Is(err, modelcore.ErrImageFileRejected) {
			t.Fatal(err)
		}
	}
}
