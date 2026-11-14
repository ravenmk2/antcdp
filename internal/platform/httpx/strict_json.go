package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// DecodeStrict requires one bounded JSON object with no duplicate keys, including
// inside arbitrary parameter maps. It leaves existing endpoint decoding unchanged.
func DecodeStrict(c *gin.Context, value any, limit int64) bool {
	if c.ContentType() != "application/json" {
		Write(c, E(http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 请求"))
		return false
	}
	if limit <= 0 {
		limit = 64 << 10
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			Write(c, E(413, "PAYLOAD_TOO_LARGE", "请求内容过大"))
		} else {
			Write(c, E(400, "BAD_REQUEST", "请求读取失败"))
		}
		return false
	}
	if err = validateJSONObject(data); err != nil {
		Write(c, E(400, "BAD_REQUEST", "请求必须是键名唯一的 JSON 对象"))
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(value); err != nil {
		if strings.HasPrefix(err.Error(), "json: unknown field") {
			Write(c, Invalid("body", "unknown_field"))
		} else {
			Write(c, E(400, "BAD_REQUEST", "请求格式不正确"))
		}
		return false
	}
	return true
}

func validateJSONObject(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return errors.New("object required")
	}
	if err := validateJSONContainer(decoder, '{', 1); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("trailing content")
	}
	return nil
}

func validateJSONContainer(decoder *json.Decoder, kind json.Delim, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting limit exceeded")
	}
	keys := make(map[string]struct{})
	for decoder.More() {
		if kind == '{' {
			token, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := token.(string)
			if !ok {
				return errors.New("invalid object key")
			}
			if _, exists := keys[key]; exists {
				return errors.New("duplicate key")
			}
			keys[key] = struct{}{}
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		if delimiter, ok := token.(json.Delim); ok {
			if delimiter != '{' && delimiter != '[' {
				return errors.New("unexpected delimiter")
			}
			if err := validateJSONContainer(decoder, delimiter, depth+1); err != nil {
				return err
			}
		}
	}
	ending, err := decoder.Token()
	if err != nil {
		return err
	}
	want := json.Delim('}')
	if kind == '[' {
		want = ']'
	}
	if ending != want {
		return errors.New("unmatched delimiter")
	}
	return nil
}
