package agents

import "time"

type AttachmentQuery struct {
	Page, PageSize int
	State          string
}
type ArtifactQuery struct {
	Page, PageSize int
	Q              string
	IncludeDeleted bool
}
type AttachmentView struct {
	ID           uint64     `json:"id,string"`
	SessionID    uint64     `json:"session_id,string"`
	FileID       uint64     `json:"file_id,string"`
	Filename     string     `json:"filename"`
	MediaType    string     `json:"media_type"`
	Size         uint64     `json:"size_bytes,string"`
	SHA256       string     `json:"sha256"`
	State        string     `json:"state"`
	UploadedBy   uint64     `json:"uploaded_by,string"`
	ExpiresAt    *time.Time `json:"expires_at"`
	BoundInputID *uint64    `json:"bound_input_id,string"`
	Version      string     `json:"version"`
	CreatedAt    time.Time  `json:"created_at"`
}
type FileMetadata struct {
	ID          uint64    `json:"id,string"`
	Filename    string    `json:"filename"`
	MediaType   string    `json:"media_type"`
	Size        *uint64   `json:"size_bytes,string"`
	SHA256      *string   `json:"sha256"`
	State       string    `json:"state"`
	Integrity   string    `json:"integrity_state"`
	CreatedAt   time.Time `json:"created_at"`
	DownloadURL *string   `json:"download_url"`
	Preview     bool      `json:"preview_available"`
}
type FileContent struct {
	Reader              ReadSeekCloser
	Filename, MediaType string
	Size                uint64
	Preview             bool
}
type ArtifactSource struct {
	ComputerID        uint64 `json:"cloud_computer_id,string"`
	BindingID         uint64 `json:"binding_id,string"`
	BackendGeneration uint64 `json:"backend_generation,string"`
	RuntimeGeneration uint64 `json:"runtime_generation,string"`
	StorageGeneration uint64 `json:"storage_generation,string"`
	VolumeID          string `json:"volume_id"`
	Path              string `json:"path"`
}
type ArtifactView struct {
	ID          uint64         `json:"id,string"`
	SessionID   uint64         `json:"session_id,string"`
	RunID       uint64         `json:"run_id,string"`
	ToolCallID  uint64         `json:"tool_call_id,string"`
	FileID      uint64         `json:"file_id,string"`
	Filename    string         `json:"filename"`
	Description string         `json:"description"`
	MediaType   string         `json:"media_type"`
	Size        uint64         `json:"size_bytes,string"`
	SHA256      string         `json:"sha256"`
	Source      ArtifactSource `json:"source"`
	CreatedAt   time.Time      `json:"created_at"`
	DeletedAt   *time.Time     `json:"deleted_at"`
	Version     string         `json:"version"`
}
