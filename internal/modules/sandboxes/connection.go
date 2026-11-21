package sandboxes

// Connection is a snapshot of deployment configuration and resource ownership.
type Connection struct {
	BackendType       string
	Endpoint          *string
	AccessMode        string
	APIKey            string `json:"-"`
	ConnectTimeout    int
	OperationTimeout  int
	BackendGeneration uint64
	MaintenanceState  string
}
