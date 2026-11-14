package mysql

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	driver "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type agentSkillsTx struct {
	ctx context.Context
	tx  *sqlx.Tx
}

func (t *identityTx) AgentSkills() r.SkillRepository { return &agentSkillsTx{t.ctx, t.tx} }

func (t *agentSkillsTx) ExpiredUnassociatedSkillFiles(now time.Time, limit int) ([]agents.FileRow, error) {
	rows := []agents.FileRow{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentFileColumns+" FROM agent_file WHERE purpose='skill_archive' AND content_domain='system_skill' AND upload_operation_id IS NULL AND state IN ('uploading','orphaned','deleting') AND expires_at<=? ORDER BY updated_at,id LIMIT ?", now, limit)
	return rows, err
}

const agentSkillColumns = "s.id,s.name,s.title,s.description,s.enabled,s.row_version,s.created_by_user_id,s.created_at,s.updated_at,(SELECT v.id FROM agent_skill_version v WHERE v.skill_id=s.id AND v.state='ready' ORDER BY v.created_at DESC,v.id DESC LIMIT 1) AS latest_version_id,(SELECT v.version_label FROM agent_skill_version v WHERE v.skill_id=s.id AND v.state='ready' ORDER BY v.created_at DESC,v.id DESC LIMIT 1) AS latest_version_label"
const agentSkillVersionColumns = "id,skill_id,version_label,state,upload_operation_id,archive_file_id,archive_sha256,content_sha256,expanded_size_bytes,file_count,manifest_schema_version,manifest,frontmatter,validation_report,change_note,row_version,created_by_user_id,created_at,deleted_at,deleted_by_user_id"

func (t *agentSkillsTx) named(q string, v any) (sql.Result, error) {
	result, e := t.tx.NamedExecContext(t.ctx, q, v)
	var dbErr *driver.MySQLError
	if errors.As(e, &dbErr) && dbErr.Number == 1062 {
		return result, httpx.E(409, "RESOURCE_CONFLICT", "技能名称、版本标签或发布记录已存在")
	}
	return result, e
}
func (t *agentSkillsTx) Skills(q r.Query) ([]r.Skill, int, error) {
	where := "1=1"
	args := []any{}
	if q.Enabled != nil {
		where += " AND s.enabled=?"
		args = append(args, *q.Enabled)
	}
	if q.Q != "" {
		like := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q) + "%"
		where += " AND (s.name LIKE ? ESCAPE '!' OR s.title LIKE ? ESCAPE '!')"
		args = append(args, like, like)
	}
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_skill s WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []r.Skill{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentSkillColumns+" FROM agent_skill s WHERE "+where+" ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?", args...)
	return rows, total, e
}
func (t *agentSkillsTx) Skill(id uint64, lock bool) (*r.Skill, error) {
	q := "SELECT " + agentSkillColumns + " FROM agent_skill s WHERE s.id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &r.Skill{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentSkillsTx) InsertSkill(v *r.Skill) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.UpdatedAt = v.CreatedAt
	result, e := t.named("INSERT INTO agent_skill(name,title,description,enabled,row_version,created_by_user_id,created_at,updated_at) VALUES(:name,:title,:description,:enabled,:row_version,:created_by_user_id,:created_at,:updated_at)", v)
	return modelID(result, e, &v.ID)
}
func (t *agentSkillsTx) SaveSkill(v *r.Skill) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	_, e := t.named("UPDATE agent_skill SET title=:title,description=:description,enabled=:enabled,row_version=:row_version,updated_at=:updated_at WHERE id=:id", v)
	return e
}
func (t *agentSkillsTx) DeleteSkill(id uint64) error {
	_, e := t.tx.ExecContext(t.ctx, "DELETE FROM agent_skill WHERE id=?", id)
	return e
}
func (t *agentSkillsTx) SkillReferenced(id uint64) (bool, error) {
	var used bool
	e := t.tx.GetContext(t.ctx, &used, "SELECT EXISTS(SELECT 1 FROM agent_skill_version WHERE skill_id=?) OR EXISTS(SELECT 1 FROM agent_operation WHERE kind='skill_validate' AND subject_kind='skill' AND subject_id=? AND status IN ('queued','running'))", id, id)
	return used, e
}
func (t *agentSkillsTx) SkillVersions(id uint64, q r.Query) ([]r.SkillVersion, int, error) {
	var total int
	if e := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*) FROM agent_skill_version WHERE skill_id=?", id); e != nil {
		return nil, 0, e
	}
	rows := []r.SkillVersion{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentSkillVersionColumns+" FROM agent_skill_version WHERE skill_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", id, q.PageSize, (q.Page-1)*q.PageSize)
	return rows, total, e
}
func (t *agentSkillsTx) SkillVersion(id uint64, lock bool) (*r.SkillVersion, error) {
	q := "SELECT " + agentSkillVersionColumns + " FROM agent_skill_version WHERE id=?"
	if lock {
		q += " FOR UPDATE"
	}
	v := &r.SkillVersion{}
	e := t.tx.GetContext(t.ctx, v, q, id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return v, e
}
func (t *agentSkillsTx) InsertSkillVersion(v *r.SkillVersion) error {
	v.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	result, e := t.named("INSERT INTO agent_skill_version(skill_id,version_label,state,upload_operation_id,archive_file_id,archive_sha256,content_sha256,expanded_size_bytes,file_count,manifest_schema_version,manifest,frontmatter,validation_report,change_note,row_version,created_by_user_id,created_at) VALUES(:skill_id,:version_label,:state,:upload_operation_id,:archive_file_id,:archive_sha256,:content_sha256,:expanded_size_bytes,:file_count,:manifest_schema_version,:manifest,:frontmatter,:validation_report,:change_note,:row_version,:created_by_user_id,:created_at)", v)
	return modelID(result, e, &v.ID)
}
func (t *agentSkillsTx) SaveSkillVersion(v *r.SkillVersion) error {
	_, e := t.named("UPDATE agent_skill_version SET state=:state,validation_report=:validation_report,row_version=:row_version,deleted_at=:deleted_at,deleted_by_user_id=:deleted_by_user_id WHERE id=:id", v)
	return e
}
func (t *agentSkillsTx) VersionReferenced(id, fileID uint64) (bool, error) {
	var busy bool
	e := t.tx.GetContext(t.ctx, &busy, "SELECT EXISTS(SELECT 1 FROM agent_resource_reference WHERE state<>'released' AND ((resource_kind='skill_version' AND resource_id=?) OR (resource_kind='file' AND resource_id=?))) OR EXISTS(SELECT 1 FROM agent_skill_binding b JOIN agent a ON a.id=b.agent_id WHERE b.skill_version_id=? AND a.deleted_at IS NULL)", id, fileID, id)
	return busy, e
}
func (t *agentSkillsTx) ActiveFileReaders(id uint64) (bool, error) {
	var busy bool
	e := t.tx.GetContext(t.ctx, &busy, "SELECT EXISTS(SELECT 1 FROM agent_resource_reference WHERE resource_kind='file' AND resource_id=? AND state<>'released')", id)
	return busy, e
}
func (t *agentSkillsTx) UploadBeingPublished(op uint64) (bool, error) {
	var busy bool
	e := t.tx.GetContext(t.ctx, &busy, "SELECT EXISTS(SELECT 1 FROM agent_resource_reference r JOIN agent_operation o ON o.staged_file_id=r.resource_id WHERE o.id=? AND r.resource_kind='file' AND r.holder_kind='skill_publish' AND r.state<>'released')", op)
	return busy, e
}
func (t *agentSkillsTx) PendingSkillOperations(limit int) ([]agents.PublicOperationRow, error) {
	rows := []agents.PublicOperationRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentPublicOperationColumns+" FROM agent_operation WHERE kind='skill_validate' AND status='queued' ORDER BY id LIMIT ?", limit)
	return rows, e
}
func (t *agentSkillsTx) RecoverSkillOperations(epoch string, now time.Time) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE agent_operation SET status='interrupted',error_code='EXECUTOR_RESTARTED',finished_at=?,updated_at=?,fence_version=fence_version+1 WHERE kind='skill_validate' AND status='running' AND (executor_epoch IS NULL OR executor_epoch<>?)", now, now, epoch)
	return e
}
func (t *agentSkillsTx) ExpireSkillOperations(now time.Time) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE agent_operation SET status='interrupted',error_code='OPERATION_RESULT_UNCONFIRMED',finished_at=?,updated_at=?,fence_version=fence_version+1 WHERE kind='skill_validate' AND status='running' AND deadline_at<=?", now, now, now)
	return e
}
func (t *agentSkillsTx) RetiredSkillVersions(limit int) ([]r.SkillVersion, error) {
	rows := []r.SkillVersion{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentSkillVersionColumns+" FROM agent_skill_version WHERE state='deleted' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(validation_report,'$.cleanup_state')),'pending')<>'completed' ORDER BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(validation_report,'$.cleanup_attempted_at')),''),id LIMIT ?", limit)
	return rows, e
}
func (t *agentSkillsTx) ExpiredSkillUploads(now time.Time, limit int) ([]agents.PublicOperationRow, error) {
	rows := []agents.PublicOperationRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentPublicOperationColumns+" FROM agent_operation WHERE kind='skill_validate' AND published_skill_version_id IS NULL AND expires_at<=? AND staged_file_id IN (SELECT id FROM agent_file WHERE state<>'deleted') ORDER BY expires_at,id LIMIT ?", now, limit)
	return rows, e
}
func (t *agentSkillsTx) RecoverSkillReaders(epoch string, now time.Time) error {
	_, e := t.tx.ExecContext(t.ctx, "UPDATE agent_resource_reference SET state='released',released_at=?,updated_at=?,last_verified_at=?,release_reason='EXECUTOR_RESTARTED',release_evidence=JSON_OBJECT('local_reader_closed',TRUE) WHERE holder_kind IN ('skill_preview','skill_archive_download','skill_validation','skill_publish','skill_runtime_load') AND executor_epoch<>? AND state<>'released'", now, now, now, epoch)
	return e
}
