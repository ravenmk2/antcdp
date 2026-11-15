package sandboxcore

import (
	"context"
	"time"
)

// FileInfo describes provider observations, not a transactional revision. A
// metadata comparison does not provide atomic compare-and-swap semantics.
type FileInfo struct {
	Path       string    `json:"path"`
	Kind       string    `json:"kind"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
	Mode       int       `json:"mode"`
}

// Filesystem follows native sandbox file APIs. It requires neither a resident
// helper nor a particular image, user ID or workspace layout. Permissions use
// octal digits (e.g. 755), matching the first provider, OpenSandbox.
type Filesystem interface {
	FileTransport
	StatFile(context.Context, ResourceRef, string) (FileInfo, error)
	ListFiles(context.Context, ResourceRef, string) ([]FileInfo, error)
	SearchFiles(context.Context, ResourceRef, string, string) ([]FileInfo, error)
	MakeDirectory(context.Context, ResourceRef, string, int) error
	RemoveFile(context.Context, ResourceRef, string, bool) error
	MoveFile(context.Context, ResourceRef, string, string) error
	SetFilePermissions(context.Context, ResourceRef, string, int) error
	ReplaceFile(context.Context, ResourceRef, string, string, string) (int, error)
}
