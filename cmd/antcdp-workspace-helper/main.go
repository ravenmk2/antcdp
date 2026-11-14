// The helper is invoked only by the trusted host through its sandbox adapter.
// Workload commands run separately as an unprivileged identity.
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--workload-probe" && os.Geteuid() == 10001 {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if json.NewEncoder(os.Stdout).Encode(workspacefs.WorkloadProbe(ctx)) != nil {
			os.Exit(1)
		}
		return
	}
	result := workspacefs.Response{Version: workspacefs.Version, Code: "WORKSPACE_REQUEST_INVALID"}
	if len(os.Args) == 2 && os.Geteuid() == 0 {
		request, err := workspacefs.Decode(os.Args[1])
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
			result = workspacefs.DefaultEngine().Handle(ctx, request)
			cancel()
		}
	}
	if json.NewEncoder(os.Stdout).Encode(result) != nil || !result.OK {
		os.Exit(1)
	}
}
