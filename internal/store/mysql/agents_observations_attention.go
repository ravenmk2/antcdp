package mysql

import a "github.com/ravenmk2/antcdp/internal/modules/agents"

// The same local admission predicate is used by attention lists and counts.
// It does not probe remote models or interpret administrator scope declarations.
const agentLocalAdmission = `s.archived_at IS NULL AND EXISTS(SELECT 1 FROM agent d JOIN agent_model_binding b ON b.agent_id=d.id JOIN model_definition m ON m.id=b.model_definition_id JOIN model_provider mp ON mp.id=m.provider_id WHERE d.id=s.agent_id AND d.enabled=1 AND b.id=s.selected_model_binding_id AND b.removed_at IS NULL AND m.enabled=1 AND mp.enabled=1 AND (mp.auth_method='none' OR mp.secret_ciphertext IS NOT NULL) AND JSON_CONTAINS(b.thinking_options,JSON_QUOTE(s.selected_thinking_option_key)) AND JSON_UNQUOTE(JSON_EXTRACT(m.capabilities,'$.text_input'))='supported' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.locked_model_config,'$.capabilities.tool_calling')),'unknown')<>'supported' OR JSON_UNQUOTE(JSON_EXTRACT(m.capabilities,'$.tool_calling'))='supported') AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.locked_model_config,'$.capabilities.image_input')),'unknown')<>'supported' OR JSON_UNQUOTE(JSON_EXTRACT(m.capabilities,'$.image_input'))='supported'))`
const agentQuestionCount = `(SELECT COUNT(*) FROM agent_interaction i WHERE i.session_id=s.id AND i.kind='question' AND i.status IN ('waiting','continued'))`
const agentApprovalCount = `(SELECT COUNT(*) FROM agent_interaction i WHERE i.session_id=s.id AND s.agent_type='interactive' AND i.kind='approval' AND i.status='pending' AND i.wait_deadline_at>UTC_TIMESTAMP(3))`
const agentUnviewedCount = `(SELECT COUNT(*) FROM agent_run ar WHERE ar.session_id=s.id AND ar.root_run_id IS NULL AND ar.ended_seq>COALESCE(p.viewed_through_seq,0) AND ar.status IN ('succeeded','waiting_input','failed','cancelled','interrupted'))`
const agentAttentionCounts = `IF(` + agentLocalAdmission + `,` + agentQuestionCount + `,0) AS questions,IF(` + agentLocalAdmission + `,` + agentApprovalCount + `,0) AS approvals,` + agentUnviewedCount + ` AS unviewed`

func (t *agentsTx) AttentionFor(session, user uint64) (a.SessionAttention, error) {
	var out a.SessionAttention
	err := t.tx.GetContext(t.ctx, &out, "SELECT "+agentAttentionCounts+" FROM agent_session s LEFT JOIN agent_session_preference p ON p.session_id=s.id AND p.user_id=? WHERE s.id=?", user, session)
	return out, err
}
func (t *agentsTx) AttentionPage(user uint64, kind string, q a.ObservationQuery) ([]a.AttentionRow, int, error) {
	columns := `s.id AS session_id,s.agent_id,s.title,s.last_activity_at,COALESCE(p.viewed_through_seq,0) AS viewed,` + agentAttentionCounts + `,(SELECT MIN(i.created_at) FROM agent_interaction i WHERE i.session_id=s.id AND ((i.kind='question' AND i.status IN ('waiting','continued')) OR (i.kind='approval' AND i.status='pending' AND i.wait_deadline_at>UTC_TIMESTAMP(3)))) AS first_response_at,(SELECT MIN(i.wait_deadline_at) FROM agent_interaction i WHERE i.session_id=s.id AND i.kind='approval' AND i.status='pending' AND i.wait_deadline_at>UTC_TIMESTAMP(3)) AS next_approval_expires_at`
	from := ` FROM agent_session s LEFT JOIN agent_session_preference p ON p.session_id=s.id AND p.user_id=? WHERE s.agent_type='interactive' AND s.session_kind='root' AND s.executor_user_id=? AND s.archived_at IS NULL`
	filter, order := "unviewed>0", "(SELECT ar.finished_at FROM agent_run ar WHERE ar.session_id=x.session_id AND ar.root_run_id IS NULL AND ar.ended_seq IS NOT NULL ORDER BY ar.ended_seq DESC LIMIT 1) DESC,(SELECT ar.id FROM agent_run ar WHERE ar.session_id=x.session_id AND ar.root_run_id IS NULL AND ar.ended_seq IS NOT NULL ORDER BY ar.ended_seq DESC LIMIT 1) DESC,session_id DESC"
	if kind == "response_required" {
		filter = "questions+approvals>0"
		order = "first_response_at,session_id"
	}
	base := " FROM (SELECT " + columns + from + ") x WHERE " + filter
	var total int
	if err := t.tx.GetContext(t.ctx, &total, "SELECT COUNT(*)"+base, user, user); err != nil {
		return nil, 0, err
	}
	rows := []a.AttentionRow{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT x.*"+base+" ORDER BY "+order+" LIMIT ? OFFSET ?", user, user, q.PageSize, (q.Page-1)*q.PageSize)
	return rows, total, err
}
