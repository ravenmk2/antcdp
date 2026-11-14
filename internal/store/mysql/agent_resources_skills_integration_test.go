package mysql

import (
	"archive/zip"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"testing"
	"time"

	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"skill resources", skillResourceLifecycle}, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"skill upload creation", skillUploadCreationLifecycle}, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"nonrenewing observation", agentObservationLifecycle})
}
func skillFixtureArchive(t *testing.T, name string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, entry := range []struct{ name, body string }{{name + "/SKILL.md", "---\nname: " + name + "\ndescription: Inspect source code when asked to review.\n---\n# Review\nRead references/checklist.md first.\n"}, {name + "/references/checklist.md", "Inspect the tests.\n"}} {
		f, e := writer.CreateHeader(&zip.FileHeader{Name: entry.name, Method: zip.Store})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = io.WriteString(f, entry.body); e != nil {
			t.Fatal(e)
		}
	}
	if e := writer.Close(); e != nil {
		t.Fatal(e)
	}
	return buf.Bytes()
}
func skillResourceLifecycle(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw := f.Context, f.AdminToken
	svc := &r.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, ETag: func(v string) string {
		mac := hmac.New(sha256.New, cryptox.Derive(f.Key, "agentresources-etags"))
		mac.Write([]byte(v))
		return hex.EncodeToString(mac.Sum(nil))
	}, Files: f.Agents.Files, Epoch: "skill-integration"}
	created, e := svc.CreateSkill(ctx, raw, cryptox.ID(), r.SkillCreate{Name: "source-review", Title: "源码核对"})
	if e != nil {
		t.Fatal(e)
	}
	skill := created.Data.(*r.Skill)
	archive := skillFixtureArchive(t, skill.Name)
	key := cryptox.ID()
	upload, e := svc.UploadSkill(ctx, raw, key, "review.zip", strconv.FormatUint(skill.ID, 10), bytes.NewReader(archive))
	if e != nil {
		t.Fatal(e)
	}
	if upload.Status != 202 || upload.OperationID == nil {
		t.Fatal("upload admission")
	}
	uploadID := *upload.OperationID
	replay, e := svc.UploadSkill(ctx, raw, key, "review.zip", strconv.FormatUint(skill.ID, 10), bytes.NewReader(archive))
	if e != nil || !replay.Replayed {
		t.Fatal("upload replay", e)
	}
	queued, e := svc.GetSkillUpload(ctx, raw, uploadID)
	if e != nil || queued.Data.(r.SkillUpload).Status != "queued" {
		t.Fatal("queued upload", e)
	}
	otherPassword := "skill-other-admin-password"
	other, _, e := f.Identity.CreateUser(ctx, raw, identity.CreateRequest{Username: "skill_other_admin", DisplayName: "Other skill admin", Role: "admin", Password: otherPassword}, identity.Metadata{})
	if e != nil {
		t.Fatal(e)
	}
	otherLogin, e := f.Identity.Login(ctx, other.Username, otherPassword, "", identity.Metadata{})
	if e != nil {
		t.Fatal(e)
	}
	nextPassword := "skill-other-admin-new-password"
	if e = f.Identity.ChangePassword(ctx, otherLogin.Token, otherPassword, nextPassword, identity.Metadata{}); e != nil {
		t.Fatal(e)
	}
	otherLogin, e = f.Identity.Login(ctx, other.Username, nextPassword, "", identity.Metadata{})
	if e != nil {
		t.Fatal(e)
	}
	_, e = svc.GetSkillUpload(ctx, otherLogin.Token, uploadID)
	modelsExpectCode(t, e, "NOT_FOUND")
	if e = svc.ProcessSkills(ctx, 4); e != nil {
		t.Fatal(e)
	}
	validated, e := svc.GetSkillUpload(ctx, raw, uploadID)
	if e != nil {
		t.Fatal(e)
	}
	draft := validated.Data.(r.SkillUpload)
	if draft.Status != "passed" || draft.Name == nil || *draft.Name != skill.Name || draft.Manifest == nil || draft.Manifest.FileCount != 2 {
		t.Fatal("validation", draft)
	}
	publishKey := cryptox.ID()
	publishInput := r.SkillPublish{UploadID: strconv.FormatUint(uploadID, 10), Label: "1.0", ChangeNote: "Initial version"}
	_, e = svc.PublishSkill(ctx, otherLogin.Token, skill.ID, created.Tag, publishKey, publishInput)
	modelsExpectCode(t, e, "NOT_FOUND")
	published, e := svc.PublishSkill(ctx, raw, skill.ID, created.Tag, publishKey, publishInput)
	if e != nil {
		t.Fatal(e)
	}
	version := published.Data.(*r.SkillVersion)
	if version.State != "ready" || version.ArchiveSHA == version.ContentSHA {
		t.Fatal("version identity")
	}
	replay, e = svc.PublishSkill(ctx, raw, skill.ID, created.Tag, publishKey, publishInput)
	if e != nil || !replay.Replayed {
		t.Fatal("publication replay", e)
	}
	if _, e = svc.GetSkillUpload(ctx, otherLogin.Token, uploadID); e != nil {
		t.Fatal("published upload visibility", e)
	}
	preview, e := svc.ReadSkillContent(ctx, raw, skill.ID, version.ID, "references/checklist.md")
	if e != nil || preview.Data.(map[string]any)["text"] != "Inspect the tests.\n" {
		t.Fatal("content preview", e)
	}
	entries, e := svc.ListSkillEntries(ctx, raw, skill.ID, version.ID, "", r.Query{})
	if e != nil || entries.Pagination.Total != 2 {
		t.Fatal("entries", e)
	}
	download, e := svc.OpenSkillArchive(ctx, raw, skill.ID, version.ID)
	if e != nil {
		t.Fatal(e)
	}
	bytesRead, e := io.ReadAll(download.Reader)
	if e != nil || !bytes.Equal(bytesRead, archive) {
		t.Fatal("archive download", e)
	}
	_, e = svc.DeleteSkillVersion(ctx, raw, skill.ID, version.ID, published.Tag, cryptox.ID())
	modelsExpectCode(t, e, "RESOURCE_IN_USE")
	if e = download.Reader.Close(); e != nil {
		t.Fatal(e)
	}
	deletionKey := cryptox.ID()
	deleted, e := svc.DeleteSkillVersion(ctx, raw, skill.ID, version.ID, published.Tag, deletionKey)
	if e != nil || deleted.Status != 204 {
		t.Fatal("version deletion", e)
	}
	_, e = svc.OpenSkillArchive(ctx, raw, skill.ID, version.ID)
	modelsExpectCode(t, e, "SKILL_VERSION_DELETED")
	if e = svc.CleanupSkills(ctx, 10); e != nil {
		t.Fatal(e)
	}
	record, e := svc.GetSkillVersion(ctx, raw, skill.ID, version.ID)
	if e != nil || record.Data.(*r.SkillVersion).State != "deleted" || record.Data.(*r.SkillVersion).Manifest.FileCount != 2 {
		t.Fatal("tombstone metadata", e)
	}
	var state string
	if e = f.Store.db.GetContext(ctx, &state, "SELECT state FROM agent_file WHERE id=?", version.ArchiveFileID); e != nil || state != "deleted" {
		t.Fatal("archive cleanup", state, e)
	}
	bad, e := svc.UploadSkill(ctx, raw, cryptox.ID(), "bad.zip", "", strings.NewReader("invalid ZIP"))
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.ProcessSkills(ctx, 4); e != nil {
		t.Fatal(e)
	}
	badView, e := svc.GetSkillUpload(ctx, raw, *bad.OperationID)
	if e != nil || badView.Data.(r.SkillUpload).Status != "failed" {
		t.Fatal("invalid archive", e)
	}
	if _, e = svc.DeleteSkillUpload(ctx, raw, *bad.OperationID, cryptox.ID()); e != nil {
		t.Fatal(e)
	}
	if e = svc.CleanupSkills(ctx, 10); e != nil {
		t.Fatal(e)
	}
	if _, e = f.Store.db.ExecContext(ctx, "UPDATE agent_file SET expires_at=? WHERE purpose='skill_archive' AND upload_operation_id IS NULL AND state IN ('uploading','orphaned')", time.Now().Add(-time.Hour)); e != nil {
		t.Fatal(e)
	}
	if e = svc.CleanupSkills(ctx, 10); e != nil {
		t.Fatal(e)
	}
	var unfinished int
	if e = f.Store.db.GetContext(ctx, &unfinished, "SELECT COUNT(*) FROM agent_file WHERE purpose='skill_archive' AND upload_operation_id IS NULL AND state<>'deleted'"); e != nil || unfinished != 0 {
		t.Fatal("unassociated upload cleanup", e)
	}
	serialized, _ := json.Marshal(record.Data)
	if bytes.Contains(serialized, []byte("content_storage_key")) {
		t.Fatal("private storage key disclosed")
	}
}
func skillUploadCreationLifecycle(t *testing.T, f *agentIntegrationFixture) {
	ctx, raw := f.Context, f.AdminToken
	svc := &r.Service{Identity: f.Identity, Store: func() (identity.Store, error) { return f.Store, nil }, ETag: f.Agents.ETag, Files: f.Agents.Files, Epoch: "skill-create-test"}
	stage := func(name string) uint64 {
		t.Helper()
		result, err := svc.UploadSkill(ctx, raw, cryptox.ID(), "skill.zip", "", bytes.NewReader(skillFixtureArchive(t, name)))
		if err != nil {
			t.Fatal(err)
		}
		if err = svc.ProcessSkills(ctx, 4); err != nil {
			t.Fatal(err)
		}
		return *result.OperationID
	}
	id := stage("upload-created")
	view, err := svc.GetSkillUpload(ctx, raw, id)
	if err != nil {
		t.Fatal(err)
	}
	meta := view.Data.(r.SkillUpload).Frontmatter
	if meta == nil || meta.Name != "upload-created" || meta.Description == "" {
		t.Fatal("missing parsed metadata", meta)
	}
	key := cryptox.ID()
	input := r.SkillCreateFromUpload{UploadID: strconv.FormatUint(id, 10)}
	created, err := svc.CreateSkillFromUpload(ctx, raw, key, input)
	if err != nil {
		t.Fatal(err)
	}
	version := created.Data.(*r.SkillVersion)
	if version.Label != "0.1.0" || version.SkillID == 0 {
		t.Fatal("first version", version)
	}
	identityView, err := svc.GetSkill(ctx, raw, version.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	skill := identityView.Data.(*r.Skill)
	if skill.Name != meta.Name || skill.Title != meta.Name || skill.Description != meta.Description || skill.LatestVersionLabel == nil || *skill.LatestVersionLabel != "0.1.0" {
		t.Fatal("metadata defaults", skill)
	}
	replay, err := svc.CreateSkillFromUpload(ctx, raw, key, input)
	if err != nil || !replay.Replayed {
		t.Fatal("atomic create replay", err)
	}
	duplicate := stage(meta.Name)
	_, err = svc.CreateSkillFromUpload(ctx, raw, cryptox.ID(), r.SkillCreateFromUpload{UploadID: strconv.FormatUint(duplicate, 10)})
	modelsExpectCode(t, err, "RESOURCE_CONFLICT")
	view, err = svc.GetSkillUpload(ctx, raw, duplicate)
	if err != nil || view.Data.(r.SkillUpload).PublishedID != nil {
		t.Fatal("failed create consumed draft", err)
	}
	var count int
	if err = f.Store.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM agent_skill_version WHERE skill_id=?", skill.ID); err != nil || count != 1 {
		t.Fatal("duplicate publication", count, err)
	}
	title, description := "自定义展示名称", strings.Repeat("文", 1024)
	customID := stage("upload-customized")
	custom, err := svc.CreateSkillFromUpload(ctx, raw, cryptox.ID(), r.SkillCreateFromUpload{UploadID: strconv.FormatUint(customID, 10), Title: &title, Description: &description, Label: "2.3.4"})
	if err != nil {
		t.Fatal(err)
	}
	customVersion := custom.Data.(*r.SkillVersion)
	customView, err := svc.GetSkill(ctx, raw, customVersion.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	if customView.Data.(*r.Skill).Title != title || customView.Data.(*r.Skill).Description != description || customVersion.Frontmatter.Description == description {
		t.Fatal("mutable metadata changed original package")
	}
	preview, err := svc.ReadSkillContent(ctx, raw, customVersion.SkillID, customVersion.ID, "SKILL.md")
	if err != nil || !strings.Contains(preview.Data.(map[string]any)["text"].(string), "description: Inspect source") {
		t.Fatal("original ZIP preview", err)
	}
}

func agentObservationLifecycle(t *testing.T, f *agentIntegrationFixture) {
	ctx := f.Context
	seen := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	expiry := seen.Add(24 * time.Hour)
	if _, e := f.Store.db.ExecContext(ctx, "UPDATE `session` SET last_seen_at=?,expires_at=? WHERE token_hash=?", seen, expiry, cryptox.Digest(f.AdminToken)); e != nil {
		t.Fatal(e)
	}
	observed, e := f.Identity.ObserveAccess(ctx, f.AdminToken, nil)
	if e != nil {
		t.Fatal(e)
	}
	if !observed.Session.LastSeenAt.Equal(seen) || !observed.Session.ExpiresAt.Equal(expiry) {
		t.Fatal("observation extended session")
	}
	type sessionTimes struct {
		Seen   time.Time `db:"last_seen_at"`
		Expiry time.Time `db:"expires_at"`
	}
	var persisted sessionTimes
	if e = f.Store.db.GetContext(ctx, &persisted, "SELECT last_seen_at,expires_at FROM `session` WHERE token_hash=?", cryptox.Digest(f.AdminToken)); e != nil {
		t.Fatal(e)
	}
	if !persisted.Seen.Equal(seen) || !persisted.Expiry.Equal(expiry) {
		t.Fatal("observation persisted renewal")
	}
	renewed, e := f.Identity.BusinessAccess(ctx, f.AdminToken, nil, func(identity.Tx, *identity.Auth) error { return nil })
	if e != nil || !renewed.Session.LastSeenAt.After(seen) {
		t.Fatal("active request did not renew", e)
	}
}
