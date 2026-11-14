package modelcore

import (
	"context"
	"errors"
	"time"
)

var (
	ErrImageFilesUnavailable = errors.New("provider image files unavailable")
	ErrImageFileRejected     = errors.New("provider image file reference rejected")
)

// ImageFileClient is an optional capability of a model route. The scope is a
// non-secret hash of endpoint, protocol and credentials, never an access grant.
// Uploads happen during preparation, before a model attempt is frozen.
type ImageFileClient interface {
	ImageFileScope() string
	ImageFileStyle() string
	UploadImage(context.Context, ImageUpload) (RemoteImageFile, error)
	DeleteImage(context.Context, string) error
}

type ImageUpload struct {
	MIME   string
	SHA256 string
	Data   []byte
}

type RemoteImageFile struct {
	ID        string
	ExpiresAt time.Time
}
