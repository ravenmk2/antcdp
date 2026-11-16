package statestore

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateNamespace(t *testing.T) {
	for _, namespace := range []string{"job:42", "job_run:01KABC", "job:source:部署", "job:" + strings.Repeat("项", 251)} {
		if err := ValidateNamespace(namespace); err != nil {
			t.Errorf("rejected valid namespace %q: %v", namespace, err)
		}
	}
	for _, namespace := range []string{"job", ":id", "job:", "Job:id", "job-run:id", "job:\xff", "job:" + strings.Repeat("项", 252), strings.Repeat("a", 33) + ":id"} {
		if err := ValidateNamespace(namespace); !errors.Is(err, ErrInvalidArgument) {
			t.Errorf("accepted invalid namespace %q: %v", namespace, err)
		}
	}
}
