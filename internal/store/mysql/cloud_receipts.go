package mysql

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/commandstate"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func (t *agentsTx) CloudReceipt(actor, scopeKind, scopeID, command, key string) (*commandstate.Receipt, error) {
	v := &commandstate.Receipt{}
	if sandboxAdminCommand(command) {
		err := t.tx.GetContext(t.ctx, v, "SELECT id,actor_id,scope_kind,scope_id,command_kind,idempotency_key,request_hash,COALESCE(response_status,0) AS response_status,COALESCE(result,JSON_OBJECT()) AS result,created_at,completed_at FROM sandbox_admin_command_receipt WHERE actor_id=? AND scope_kind=? AND scope_id=? AND command_kind=? AND idempotency_key=? FOR UPDATE", actor, scopeKind, scopeID, command, key)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		v.ActorKind = "user"
		if v.CompletedAt != nil {
			v.Status = "completed"
		}
		return v, err
	}
	err := t.tx.GetContext(t.ctx, v, `SELECT id,actor_kind,actor_id,request_scope_kind AS scope_kind,request_scope_id AS scope_id,request_command AS command_kind,request_key AS idempotency_key,request_hash,status,COALESCE(response_status,0) AS response_status,COALESCE(response_result,CAST('{}' AS JSON)) AS result,request_operation_id AS operation_id,request_target_kind AS target_kind,request_target_id AS target_id,created_at,finished_at AS completed_at FROM cloud_computer_operation WHERE kind='command' AND actor_kind='user' AND actor_id=? AND request_scope_kind=? AND request_scope_id=? AND request_command=? AND request_key=? FOR UPDATE`, actor, scopeKind, scopeID, command, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return v, err
}
func (t *agentsTx) InsertCloudReceipt(v *commandstate.Receipt) error {
	if sandboxAdminCommand(v.Command) {
		r, err := t.tx.ExecContext(t.ctx, "INSERT INTO sandbox_admin_command_receipt(actor_id,scope_kind,scope_id,command_kind,idempotency_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?)", v.ActorID, v.ScopeKind, v.ScopeID, v.Command, v.Key, v.Hash, v.CreatedAt)
		return modelID(r, err, &v.ID)
	}
	r, err := t.tx.ExecContext(t.ctx, `INSERT INTO cloud_computer_operation(cloud_computer_id,kind,status,operation_token,backend_generation,sandbox_instance_id,storage_generation,intent,observation,actor_kind,actor_id,executor_epoch,fence_version,created_at,deadline_at,updated_at,request_scope_kind,request_scope_id,request_command,request_key,request_hash,response_result) VALUES(0,'command','pending',?,0,0,0,'{}','{}',?,?,'',1,?,DATE_ADD(?,INTERVAL 5 MINUTE),?,?,?,?,?,?,'{}')`, cryptox.ID(), v.ActorKind, v.ActorID, v.CreatedAt, v.CreatedAt, v.CreatedAt, v.ScopeKind, v.ScopeID, v.Command, v.Key, v.Hash)
	return modelID(r, err, &v.ID)
}
func (t *agentsTx) SaveCloudReceipt(v *commandstate.Receipt) error {
	if sandboxAdminCommand(v.Command) {
		_, err := t.tx.ExecContext(t.ctx, "UPDATE sandbox_admin_command_receipt SET response_status=?,result=?,completed_at=? WHERE id=?", v.ResponseStatus, v.Result, v.CompletedAt, v.ID)
		return err
	}
	_, err := t.named(`UPDATE cloud_computer_operation SET status=:status,response_status=:response_status,response_result=:result,request_operation_id=:operation_id,request_target_kind=:target_kind,request_target_id=:target_id,finished_at=:completed_at,updated_at=:completed_at WHERE id=:id AND kind='command'`, v)
	return err
}

func sandboxAdminCommand(command string) bool {
	return strings.HasPrefix(command, "sandbox_connection.") || strings.HasPrefix(command, "sandbox_spec.")
}
