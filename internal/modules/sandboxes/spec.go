package sandboxes

import "encoding/json"

// Spec is a named creation profile. Its version is captured when provisioning is queued.
type Spec struct {
	ID            uint64          `db:"id" json:"id,string"`
	Name          string          `db:"name" json:"name"`
	Image         string          `db:"image" json:"image"`
	CPU           int             `db:"cpu_millicores" json:"cpu_millicores"`
	Memory        int             `db:"memory_mib" json:"memory_mib"`
	Network       json.RawMessage `db:"network_policy" json:"network"`
	ConfigVersion uint64          `db:"config_version" json:"config_version,string"`
	RowVersion    uint64          `db:"row_version" json:"-"`
	Version       string          `db:"-" json:"version"`
}
