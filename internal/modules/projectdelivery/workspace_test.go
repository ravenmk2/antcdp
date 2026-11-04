package projectdelivery

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestProjectReleaseQueryRejectsInvalidParametersBeforeAccess(t *testing.T) {
	for _, tc := range []struct {
		name  string
		query Query
		field string
	}{
		{"status", Query{Status: "completed"}, "status"},
		{"page", Query{Page: -1}, "query"},
		{"offset limit", Query{Page: 1000001}, "query"},
		{"unsupported size", Query{Size: 1}, "query"},
		{"search rune limit", Query{Search: strings.Repeat("项", 101)}, "query"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := &Service{}
			_, auth, err := service.ProjectReleases(context.Background(), "", 1, tc.query)
			var apiError *httpx.Error
			if !errors.As(err, &apiError) || apiError.Status != 422 || auth != nil || len(apiError.Details) != 1 || apiError.Details[0].Field != tc.field {
				t.Fatalf("invalid query reached access or lost its field error: %v", err)
			}
		})
	}
}
