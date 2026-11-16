package mysql

import (
	"time"

	i "github.com/ravenmk2/antcdp/internal/modules/integrations"
)

func (t *identityTx) ConnectionGrants(id uint64) ([]i.ConnectionGrant, error) {
	rows := []i.ConnectionGrant{}
	err := t.tx.SelectContext(t.ctx, &rows, `SELECT g.*, COALESCE(p.name,tm.name,'') AS subject_name
        FROM service_connection_grant g
        LEFT JOIN project p ON g.subject_kind='project' AND p.id=g.subject_id
        LEFT JOIN team tm ON g.subject_kind='team' AND tm.id=g.subject_id
        WHERE g.connection_id=? ORDER BY g.subject_kind,g.subject_id`, id)
	return rows, err
}

func (t *identityTx) SaveConnectionGrant(v *i.ConnectionGrant) error {
	v.UpdatedAt = time.Now().UTC().Truncate(time.Millisecond)
	v.CreatedAt = v.UpdatedAt
	_, err := t.tx.NamedExecContext(t.ctx, `INSERT INTO service_connection_grant
        (connection_id,subject_kind,subject_id,enabled,created_by_user_id,updated_by_user_id,created_at,updated_at)
        VALUES(:connection_id,:subject_kind,:subject_id,:enabled,:created_by_user_id,:updated_by_user_id,:created_at,:updated_at)
        ON DUPLICATE KEY UPDATE enabled=:enabled,row_version=row_version+1,
        updated_by_user_id=:updated_by_user_id,updated_at=:updated_at`, v)
	return err
}

func (t *identityTx) ConnectionGranted(id uint64, scope i.CredentialOwnership, active bool) (bool, error) {
	if scope.Type != "project" && scope.Type != "team" {
		return false, nil
	}
	var allowed bool
	err := t.tx.GetContext(t.ctx, &allowed, `SELECT EXISTS(
        SELECT 1 FROM service_connection c WHERE c.id=? AND (
            (?='project' AND EXISTS(SELECT 1 FROM project p WHERE p.id=? AND (?=FALSE OR p.archived_at IS NULL))) OR
            (?='team' AND EXISTS(SELECT 1 FROM team t WHERE t.id=? AND (?=FALSE OR t.dissolved_at IS NULL)))
        ) AND (
            (c.ownership_type='project' AND ?='project' AND c.project_id=?) OR
            (c.ownership_type='platform' AND EXISTS(SELECT 1 FROM service_connection_grant g
                WHERE g.connection_id=c.id AND g.subject_kind=? AND g.subject_id=? AND g.enabled=TRUE))
        ))`, id, scope.Type, scope.Owner, active, scope.Type, scope.Owner, active, scope.Type, scope.Owner, scope.Type, scope.Owner)
	return allowed, err
}

// Human membership yields personal credential visibility. Robots use only their
// Agent's scope; configuring them as an administrator never widens that scope.
func (t *identityTx) ConnectionUserScopes(uid uint64) ([]i.CredentialOwnership, error) {
	rows := []i.CredentialOwnership{}
	err := t.tx.SelectContext(t.ctx, &rows, `
        SELECT 'admin' AS kind, 0 AS owner_id FROM user u
            WHERE u.id=? AND u.deleted_at IS NULL AND u.account_type='human' AND u.role='admin'
        UNION
        SELECT 'project', p.id FROM project p JOIN user u ON u.id=?
            WHERE u.deleted_at IS NULL AND u.account_type='human' AND p.archived_at IS NULL AND (
                EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=u.id) OR
                EXISTS(SELECT 1 FROM project_team pt JOIN team tm ON tm.id=pt.team_id AND tm.dissolved_at IS NULL
                    JOIN team_member m ON m.team_id=tm.id AND m.user_id=u.id WHERE pt.project_id=p.id))
        UNION
        SELECT 'team', tm.id FROM team tm JOIN team_member m ON m.team_id=tm.id JOIN user u ON u.id=m.user_id
            WHERE u.id=? AND u.deleted_at IS NULL AND u.account_type='human' AND tm.dissolved_at IS NULL
        UNION
        SELECT a.scope_kind, COALESCE(a.scope_id,0) FROM agent a JOIN user u ON u.id=a.robot_user_id
            WHERE u.id=? AND u.deleted_at IS NULL AND u.account_type='robot' AND a.deleted_at IS NULL`, uid, uid, uid, uid)
	return rows, err
}

func (t *identityTx) ConnectionJobReferences(connection, credential uint64) (int, error) {
	var count int
	query := "SELECT COUNT(*) FROM job_resource_grant WHERE connection_id=? AND status='active'"
	args := []any{connection}
	if credential != 0 {
		query += " AND credential_id=?"
		args = append(args, credential)
	}
	err := t.tx.GetContext(t.ctx, &count, query, args...)
	return count, err
}
