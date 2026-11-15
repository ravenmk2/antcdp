package sandboxes

import (
	"encoding/json"
	"time"
)

// The connection is a singleton. It contains no machine specifications.
type Connection struct {
	BackendType          string          `db:"backend_type"`
	ID                   uint64          `db:"id"`
	Endpoint             *string         `db:"endpoint"`
	AccessMode           string          `db:"access_mode"`
	ConnectTimeout       int             `db:"connect_timeout_seconds"`
	OperationTimeout     int             `db:"operation_timeout_seconds"`
	SecretCiphertext     []byte          `db:"secret_ciphertext"`
	SecretFormatVersion  *uint64         `db:"secret_format_version"`
	SecretKeyVersion     *string         `db:"secret_key_version"`
	SecretRevision       uint64          `db:"secret_revision"`
	ConfigVersion        uint64          `db:"config_version"`
	RowVersion           uint64          `db:"row_version"`
	BackendGeneration    uint64          `db:"backend_generation"`
	TopologyVersion      uint64          `db:"topology_version"`
	MaintenanceState     string          `db:"maintenance_state"`
	VerifiedCapabilities json.RawMessage `db:"verified_capabilities"`
	LastDiagnostic       json.RawMessage `db:"last_diagnostic"`
	LastDiagnosticAt     *time.Time      `db:"last_diagnostic_at"`
	UpdatedByUserID      *uint64         `db:"updated_by_user_id"`
	CreatedAt            time.Time       `db:"created_at"`
	UpdatedAt            time.Time       `db:"updated_at"`
}
