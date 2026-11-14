package webaccess

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	runtime "github.com/ravenmk2/antcdp/internal/webaccess"
)

func TestProbeDiagnosticCertaintyAndRedaction(t *testing.T) {
	for _, tc := range []struct {
		name           string
		err            error
		status, reason string
	}{
		{"success", nil, "succeeded", ""},
		{"known", runtime.Fail("WEB_ACCESS_AUTHENTICATION_REJECTED"), "failed", "WEB_ACCESS_AUTHENTICATION_REJECTED"},
		{"unknown", &runtime.Failure{Code: "WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN", Unknown: true}, "interrupted", "WEB_ACCESS_REMOTE_OUTCOME_UNKNOWN"},
		{"timeout", context.DeadlineExceeded, "interrupted", "WEB_ACCESS_TIMEOUT"},
		{"cancel", context.Canceled, "interrupted", "CANCELLED"},
		{"transport", errors.New("https://secret.example/?key=private"), "failed", "WEB_ACCESS_PROBE_FAILED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Now().UTC()
			v := probeDiagnostic("search", now, now, tc.err)
			if v.Status != tc.status || len(v.Checks) != 1 {
				t.Fatal(v)
			}
			if tc.reason != "" && (v.Checks[0].Reason == nil || *v.Checks[0].Reason != tc.reason) {
				t.Fatal(v)
			}
			data, err := json.Marshal(v)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), "private") || strings.Contains(string(data), "operation_id") || strings.Contains(string(data), `"id"`) {
				t.Fatal("unsafe diagnostic", string(data))
			}
		})
	}
}
