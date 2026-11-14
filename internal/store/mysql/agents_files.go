package mysql

import (
	"strings"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
)

func (t *agentsTx) FileCleanupCandidates(now time.Time, limit int) ([]a.FileRow, error) {
	rows := []a.FileRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentFileColumns+" FROM agent_file WHERE purpose IN ('user_attachment','agent_artifact','tool_image') AND upload_operation_id IS NULL AND ((state IN ('uploading','staged','orphaned') AND expires_at<=?) OR state='deleting') ORDER BY id LIMIT ?", now, limit)
	return rows, e
}
func (t *agentsTx) FileHasBindings(id uint64) (bool, error) {
	var yes bool
	e := t.tx.GetContext(t.ctx, &yes, "SELECT EXISTS(SELECT 1 FROM agent_input_file WHERE file_id=?) OR EXISTS(SELECT 1 FROM agent_attachment WHERE file_id=? AND (state='bound' OR state='staged' AND expires_at>UTC_TIMESTAMP(3))) OR EXISTS(SELECT 1 FROM agent_artifact WHERE file_id=? AND deleted_at IS NULL)", id, id, id)
	return yes, e
}
func (t *agentsTx) OldDownloadReferences(epoch string, limit int) ([]a.ResourceReferenceRow, error) {
	rows := []a.ResourceReferenceRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentResourceReferenceColumns+" FROM agent_resource_reference WHERE holder_kind='download' AND executor_epoch<>? AND state IN ('active','unknown') ORDER BY id LIMIT ?", epoch, limit)
	return rows, e
}

func (t *agentsTx) Attachments(session, user uint64, q a.AttachmentQuery) ([]a.AttachmentRow, int, error) {
	where := "content_session_id=? AND state=?"
	args := []any{session, q.State}
	if q.State == "staged" {
		where += " AND uploaded_by_user_id=? AND expires_at>UTC_TIMESTAMP(3)"
		args = append(args, user)
	}
	var count int
	if e := t.tx.GetContext(t.ctx, &count, "SELECT COUNT(*) FROM agent_attachment WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	rows := []a.AttachmentRow{}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentAttachmentColumns+" FROM agent_attachment WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", args...)
	return rows, count, e
}
func (t *agentsTx) AttachmentsForFile(id uint64) ([]a.AttachmentRow, error) {
	rows := []a.AttachmentRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentAttachmentColumns+" FROM agent_attachment WHERE file_id=? ORDER BY id", id)
	return rows, e
}
func (t *agentsTx) ArtifactsForFile(id uint64) ([]a.ArtifactRow, error) {
	rows := []a.ArtifactRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentArtifactColumns+" FROM agent_artifact WHERE file_id=? ORDER BY id", id)
	return rows, e
}
func (t *agentsTx) FileActiveReferences(id uint64) (int, error) {
	var n int
	e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM agent_resource_reference WHERE resource_kind='file' AND resource_id=? AND state IN ('active','unknown')", id)
	return n, e
}
func (t *agentsTx) Artifacts(session uint64, run *uint64, q a.ArtifactQuery) ([]a.ArtifactRow, int, error) {
	where := "content_session_id=?"
	args := []any{session}
	order := "DESC"
	if run != nil {
		where += " AND run_id=?"
		args = append(args, *run)
		order = "ASC"
	}
	if !q.IncludeDeleted {
		where += " AND deleted_at IS NULL"
	}
	if q.Q != "" {
		where += " AND filename LIKE ? ESCAPE '!'"
		args = append(args, "%"+strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(q.Q)+"%")
	}
	var n int
	if e := t.tx.GetContext(t.ctx, &n, "SELECT COUNT(*) FROM agent_artifact WHERE "+where, args...); e != nil {
		return nil, 0, e
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows := []a.ArtifactRow{}
	e := t.tx.SelectContext(t.ctx, &rows, "SELECT "+agentArtifactColumns+" FROM agent_artifact WHERE "+where+" ORDER BY created_at "+order+",id "+order+" LIMIT ? OFFSET ?", args...)
	return rows, n, e
}
