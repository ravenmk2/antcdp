package mysql

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/events"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func eventRegistryIntegration(t *testing.T, f *agentIntegrationFixture, s *events.Service, projectID, robotID uint64) {
	ctx := f.Context
	groups, _, err := s.Catalog(ctx, f.AdminToken)
	if err != nil || len(groups) != 1 || groups[0].Code != "gitlab" || len(groups[0].Types) != 13 {
		t.Fatal("GitLab catalog", groups, err)
	}
	// Exercise the embedded schemas against the actual normalizer, including sparse legacy hooks.
	bodies := map[string]string{
		"gitlab.push":                    `{"event_name":"push","project_id":9007199254740993}`,
		"gitlab.tag.created":             `{"object_kind":"tag_push","before":"000","after":"abc"}`,
		"gitlab.tag.deleted":             `{"object_kind":"tag_push","before":"abc","after":"000"}`,
		"gitlab.pipeline.status_changed": `{"object_kind":"pipeline"}`,
		"gitlab.ci_job.status_changed":   `{"object_kind":"build"}`,
		"gitlab.note.created":            `{"object_kind":"note"}`,
		"gitlab.note.updated":            `{"object_kind":"note","object_attributes":{"action":"update"}}`,
		"gitlab.repository_update":       `{"event_name":"repository_update","changes":[{"ref":"refs/heads/main"}]}`,
	}
	for leaf, action := range map[string]string{"created": "open", "updated": "update", "merged": "merge", "closed": "close", "reopened": "reopen"} {
		bodies["gitlab.merge_request."+leaf] = fmt.Sprintf(`{"object_kind":"merge_request","object_attributes":{"action":%q}}`, action)
	}
	for _, typ := range groups[0].Types {
		body := bodies[typ.Code]
		e, err := events.NormalizeGitLab(1, http.Header{}, []byte(body), time.Now())
		if err != nil || e.Type != typ.Code {
			t.Fatal(typ.Code, err)
		}
		err = f.Store.Transact(ctx, func(tx identity.Tx) error {
			_, err := s.ReceiveGitLab(ctx, tx, 1, http.Header{}, []byte(body))
			return err
		})
		if err != nil {
			t.Fatal(typ.Code, err)
		}
	}
	const badDelivery = "bad-pipeline"
	err = f.Store.Transact(ctx, func(tx identity.Tx) error {
		_, err := s.ReceiveGitLab(ctx, tx, 1, http.Header{"Webhook-Id": {badDelivery}}, []byte(`{"object_kind":"pipeline","project_id":42,"object_attributes":{"status":[]}}`))
		return err
	})
	var badPipeline *httpx.Error
	if !errors.As(err, &badPipeline) || len(badPipeline.Details) != 1 || badPipeline.Details[0].Field != "data/pipeline/status" {
		t.Fatal("invalid pipeline status", err)
	}
	var invalidCount int
	if err = f.Store.db.GetContext(ctx, &invalidCount, "SELECT COUNT(*) FROM event_record WHERE source_message_id=?", "webhook-id:"+badDelivery); err != nil || invalidCount != 0 {
		t.Fatal("rejected GitLab delivery persisted", invalidCount, err)
	}
	for _, q := range []string{
		`INSERT INTO event_group(id,name,sort_order) VALUES ('build','Build',1)`,
		`INSERT INTO event_type(id,event_group,name,description,origin) VALUES ('custom.build.finished','build','Build finished','','custom')`,
		`INSERT INTO event_type_version(event_type,schema_version,data_schema,created_at) VALUES
 ('custom.build.finished',1,'{"type":"object","required":["result"],"properties":{"result":{"type":"string"}}}',UTC_TIMESTAMP(3)),
 ('custom.build.finished',2,'{"type":"object","required":["result"],"properties":{"result":{"type":"integer"}}}',UTC_TIMESTAMP(3))`,
	} {
		if _, err = f.Store.db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	groups, _, err = s.Catalog(ctx, f.AdminToken)
	if err != nil || len(groups) != 2 || groups[1].Code != "build" || len(groups[1].Types) != 1 || groups[1].Types[0].Code != "custom.build.finished" {
		t.Fatal("custom catalog", groups, err)
	}
	w := events.Write{Name: "Build events", Enabled: true, EventTypes: []string{"custom.unknown"}, RunAsUserID: robotID, Script: "function main(){}"}
	_, _, err = s.Save(ctx, f.AdminToken, projectID, 0, w)
	modelsExpectCode(t, err, "VALIDATION_FAILED")
	w.EventTypes = []string{"custom.build.finished"}
	sub, _, err := s.Save(ctx, f.AdminToken, projectID, 0, w)
	if err != nil {
		t.Fatal(err)
	}
	receive := func(version uint32, id, data string) (map[string]any, error) {
		event := events.Record{SourceKind: "custom", SourceID: 1, Type: w.EventTypes[0], MessageID: &id, PayloadHash: fmt.Sprintf("%x", sha256.Sum256([]byte(data))), SchemaVersion: version, Data: json.RawMessage(data), Raw: json.RawMessage(data), Metadata: json.RawMessage("{}"), ReceivedAt: time.Now().UTC()}
		var out map[string]any
		err := f.Store.Transact(ctx, func(tx identity.Tx) error {
			var e error
			out, e = s.Receive(tx, &event, func(events.Repository) ([]events.Reference, error) {
				return []events.Reference{{ScopeKind: "project", ScopeID: projectID, Basis: json.RawMessage("{}")}}, nil
			})
			return e
		})
		return out, err
	}
	for _, tc := range []struct {
		version        uint32
		id, data, want string
	}{
		{1, "v1", `{"result":"ok"}`, "routed"},
		{1, "v1", `{"result":"ok"}`, "duplicate"},
		{2, "v2", `{"result":9007199254740993}`, "routed"},
	} {
		got, err := receive(tc.version, tc.id, tc.data)
		if err != nil || got["status"] != tc.want {
			t.Fatal(tc, got, err)
		}
	}
	_, err = receive(1, "invalid", `{"result":123}`)
	var validation *httpx.Error
	if !errors.As(err, &validation) || validation.Status != 422 || len(validation.Details) != 1 || validation.Details[0].Field != "data/result" {
		t.Fatal("schema mismatch", err)
	}
	_, err = receive(3, "missing-version", `{"result":123}`)
	modelsExpectCode(t, err, "EVENT_INTEGRITY_ERROR")
	var count int
	if err = f.Store.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM event_record WHERE source_kind='custom' AND group_code='build'"); err != nil || count != 2 {
		t.Fatal("stored custom events", count, err)
	}
	if err = f.Store.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM event_record WHERE source_kind='custom'"); err != nil || count != 2 {
		t.Fatal("failed messages persisted", count, err)
	}
	queue, _, err := s.Consumptions(ctx, f.AdminToken, projectID, events.Filter{SubscriptionID: sub.ID})
	if err != nil || len(queue) != 2 {
		t.Fatal("custom queue", queue, err)
	}
}
