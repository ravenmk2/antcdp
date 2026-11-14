package modeladapters

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

var imageFileID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,255}$`)

func (c *Client) ImageFileStyle() string {
	if c.config.Provider == modelcore.DeepSeek {
		return "deepseek"
	}
	if c.config.Provider == modelcore.Custom && c.config.Protocol == modelcore.AnthropicMessages {
		return "messages"
	}
	return ""
}

func (c *Client) imageFilesURL() string {
	base := strings.TrimSuffix(strings.TrimSuffix(c.endpoint, "/chat/completions"), "/messages")
	return base + "/files"
}

func (c *Client) ImageFileScope() string {
	if c.ImageFileStyle() == "" {
		return ""
	}
	h := sha256.Sum256([]byte(c.imageFilesURL() + "\x00" + c.ImageFileStyle() + "\x00" + c.config.APIKey))
	return hex.EncodeToString(h[:])
}

func (c *Client) imageFileRequest(ctx context.Context, method, endpoint, media string, body io.Reader) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, modelcore.ErrInvalidRequest
	}
	if media != "" {
		request.Header.Set("Content-Type", media)
	}
	if c.config.Protocol == modelcore.ChatCompletions {
		request.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	} else {
		request.Header.Set("x-api-key", c.config.APIKey)
		request.Header.Set("anthropic-version", "2023-06-01")
		if c.config.Provider == modelcore.DeepSeek {
			request.Header.Set("anthropic-beta", "files-api-2025-04-14")
		}
	}
	response, err := c.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, transportError(err)
	}
	return response, nil
}

func (c *Client) UploadImage(ctx context.Context, input modelcore.ImageUpload) (modelcore.RemoteImageFile, error) {
	var out modelcore.RemoteImageFile
	if c.ImageFileStyle() == "" {
		return out, modelcore.ErrImageFilesUnavailable
	}
	hash := sha256.Sum256(input.Data)
	if len(input.Data) == 0 || len(input.Data) > modelcore.MaxImageBytes || hex.EncodeToString(hash[:]) != input.SHA256 || (input.MIME != "image/png" && input.MIME != "image/jpeg" && input.MIME != "image/webp") {
		return out, modelcore.ErrInvalidRequest
	}
	var buffer bytes.Buffer
	form := multipart.NewWriter(&buffer)
	if c.ImageFileStyle() == "deepseek" {
		_ = form.WriteField("purpose", "user_data")
		_ = form.WriteField("expires_after[anchor]", "created_at")
		_ = form.WriteField("expires_after[seconds]", "604800")
	} else {
		_ = form.WriteField("expires_in_seconds", "604800")
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="image"`)
	header.Set("Content-Type", input.MIME)
	part, err := form.CreatePart(header)
	if err != nil {
		return out, err
	}
	if _, err = part.Write(input.Data); err != nil {
		return out, err
	}
	if err = form.Close(); err != nil {
		return out, err
	}
	started := time.Now().UTC()
	response, err := c.imageFileRequest(ctx, http.MethodPost, c.imageFilesURL(), form.FormDataContentType(), &buffer)
	if err != nil {
		return out, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == 404 || response.StatusCode == 405 || response.StatusCode == 501 {
		return out, modelcore.ErrImageFilesUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return out, &RemoteError{Status: response.StatusCode, Delay: retryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	var data struct {
		ID      string          `json:"id"`
		Bytes   int64           `json:"bytes"`
		Size    int64           `json:"size_bytes"`
		Expires json.RawMessage `json:"expires_at"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&data) != nil || !imageFileID.MatchString(data.ID) || (data.Bytes != int64(len(input.Data)) && data.Size != int64(len(input.Data))) {
		return out, modelcore.ErrInvalidResponse
	}
	out.ID = data.ID
	if len(data.Expires) > 0 && string(data.Expires) != "null" {
		var unix int64
		if json.Unmarshal(data.Expires, &unix) == nil {
			out.ExpiresAt = time.Unix(unix, 0).UTC()
		} else if json.Unmarshal(data.Expires, &out.ExpiresAt) != nil {
			return modelcore.RemoteImageFile{}, modelcore.ErrInvalidResponse
		}
	}
	// DeepSeek's Messages compatibility shape omits expiry. The explicit TTL
	// still applies; using the earlier request start gives a conservative bound.
	if out.ExpiresAt.IsZero() && c.config.Provider == modelcore.DeepSeek {
		out.ExpiresAt = started.Add(7 * 24 * time.Hour)
	}
	return out, nil
}

func (c *Client) DeleteImage(ctx context.Context, id string) error {
	if c.ImageFileStyle() == "" {
		return modelcore.ErrImageFilesUnavailable
	}
	if !imageFileID.MatchString(id) {
		return modelcore.ErrInvalidRequest
	}
	response, err := c.imageFileRequest(ctx, http.MethodDelete, c.imageFilesURL()+"/"+id, "", nil)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == 404 || response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	return &RemoteError{Status: response.StatusCode}
}
