package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestGitLabVariants(t *testing.T) {
	for _, test := range []struct{ name, body, kind, repo string }{
		{"system14_push", `{"event_name":"push","project_id":42,"ref":"refs/heads/main","before":"a","after":"b"}`, "gitlab.push", "42"},
		{"system_repository_update", `{"event_name":"repository_update","project_id":42,"changes":[{"ref":"refs/heads/main"}]}`, "gitlab.repository_update", "42"},
		{"project_push", `{"object_kind":"push","project":{"id":42},"ref":"refs/heads/main"}`, "gitlab.push", "42"},
		{"tag_create", `{"object_kind":"tag_push","project_id":42,"before":"000000","after":"abc"}`, "gitlab.tag.created", "42"},
		{"tag_delete", `{"object_kind":"tag_push","project_id":42,"before":"abc","after":"000000"}`, "gitlab.tag.deleted", "42"},
		{"tag_unknown", `{"object_kind":"tag_push","project_id":42,"before":"abc","after":"def"}`, "", "42"},
		{"pipeline", `{"object_kind":"pipeline","project":{"id":42},"object_attributes":{"id":99,"status":"success"}}`, "gitlab.pipeline.status_changed", "42"},
		{"ci_legacy", `{"object_kind":"build","project_id":42,"build_id":99,"commit":{"id":88},"build_status":"success"}`, "gitlab.ci_job.status_changed", "42"},
		{"note_legacy", `{"object_kind":"note","project_id":42,"object_attributes":{"id":99,"note":"text"}}`, "gitlab.note.created", "42"},
		{"note_create", `{"object_kind":"note","project_id":42,"object_attributes":{"action":"create"}}`, "gitlab.note.created", "42"},
		{"note_update", `{"object_kind":"note","project_id":42,"object_attributes":{"action":"update"}}`, "gitlab.note.updated", "42"},
		{"note_unknown", `{"object_kind":"note","project_id":42,"object_attributes":{"action":"delete"}}`, "", "42"},
		{"future_event", `{"object_kind":"future","project_id":42}`, "", "42"},
		{"large_id", `{"object_kind":"push","project_id":9007199254740993}`, "gitlab.push", "9007199254740993"},
	} {
		t.Run(test.name, func(t *testing.T) {
			e, err := NormalizeGitLab(1, http.Header{}, []byte(test.body), time.Now())
			if err != nil || e.Type != test.kind || e.RepositoryID != test.repo {
				t.Fatalf("normalized event: %+v, %v", e, err)
			}
			if string(e.Raw) != test.body || e.MessageID != nil || e.OccurredAt != nil {
				t.Fatal("fabricated metadata or changed raw event", e)
			}
			if test.kind == "" && e.RoutingResult != "unsupported" {
				t.Fatal("unknown event must be retained as unsupported")
			}
		})
	}
	for action, leaf := range map[string]string{"open": "created", "update": "updated", "reopen": "reopened", "close": "closed", "merge": "merged", "approved": ""} {
		t.Run("mr_"+action, func(t *testing.T) {
			body := fmt.Sprintf(`{"object_kind":"merge_request","project":{"id":1},"object_attributes":{"action":%q,"target_project_id":42,"id":99,"updated_at":"2021-11-22 12:00:00 UTC"}}`, action)
			e, err := NormalizeGitLab(1, http.Header{}, []byte(body), time.Now())
			want := ""
			if leaf != "" {
				want = "gitlab.merge_request." + leaf
			}
			if err != nil || e.Type != want || e.RepositoryID != "42" || e.OccurredAt == nil {
				t.Fatalf("MR target/version compatibility: %+v %v", e, err)
			}
		})
	}
}

func TestGitLabDeliveryIdentity(t *testing.T) {
	body := []byte(`{"object_kind":"push","project_id":1}`)
	h := http.Header{}
	h.Set("X-Gitlab-Event-UUID", "same-event")
	h.Set("X-Gitlab-Token", "never-store-this")
	e, err := NormalizeGitLab(1, h, body, time.Now())
	if err != nil || e.MessageID != nil {
		t.Fatal("event UUID must not deduplicate delivery", err)
	}
	var metadata map[string]any
	if json.Unmarshal(e.Metadata, &metadata) != nil || len(metadata) != 2 {
		t.Fatal("unexpected metadata", string(e.Metadata))
	}
	h.Set("Idempotency-Key", "retry-key")
	e, err = NormalizeGitLab(1, h, body, time.Now())
	if err != nil || e.MessageID == nil || *e.MessageID != "idempotency-key:retry-key" {
		t.Fatal("idempotency key", e, err)
	}
	h.Set("webhook-id", "delivery-key")
	e, err = NormalizeGitLab(1, h, body, time.Now())
	if err != nil || *e.MessageID != "webhook-id:delivery-key" {
		t.Fatal("preferred delivery id", e, err)
	}
	h.Add("webhook-id", "another")
	if _, err = NormalizeGitLab(1, h, body, time.Now()); err == nil {
		t.Fatal("ambiguous delivery id accepted")
	}
}
