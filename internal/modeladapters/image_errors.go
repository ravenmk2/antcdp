package modeladapters

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Classify only bounded structured errors that name one of our references.
// The provider's body is never exposed, logged or retained.
func rejectedImageFile(response *http.Response, request modelcore.Request) bool {
	if response.StatusCode != 400 && response.StatusCode != 404 && response.StatusCode != 422 {
		return false
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&body) != nil {
		return false
	}
	message := strings.ToLower(body.Error.Message)
	invalid := strings.Contains(message, "not found") || strings.Contains(message, "expired") || strings.Contains(message, "invalid file") || strings.Contains(message, "file_id is not supported")
	if !invalid {
		return false
	}
	for _, m := range request.Messages {
		for _, p := range m.Images {
			if p.FileID != "" && (strings.Contains(body.Error.Message, p.FileID) || strings.Contains(message, "file_id")) {
				return true
			}
		}
	}
	return false
}
