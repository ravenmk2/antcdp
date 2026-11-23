package mysql

import (
	"database/sql"
	"errors"

	driver "github.com/go-sql-driver/mysql"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

const specColumns = "s.id,s.name,s.image,s.cpu_millicores,s.memory_mib,s.network_policy,s.config_version,s.row_version"

func (t *agentsTx) SandboxSpecs() ([]a.SandboxSpec, error) {
	rows := []a.SandboxSpec{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT "+specColumns+" FROM sandbox_spec s ORDER BY name,id")
	return rows, err
}

func (t *agentsTx) readSandboxSpec(query string, arg any) (*a.SandboxSpec, error) {
	var row a.SandboxSpec
	err := t.tx.GetContext(t.ctx, &row, query, arg)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &row, err
}
func (t *agentsTx) SandboxSpec(id uint64, lock bool) (*a.SandboxSpec, error) {
	q := "SELECT " + specColumns + " FROM sandbox_spec s WHERE s.id=?"
	if lock {
		q += " FOR UPDATE"
	}
	return t.readSandboxSpec(q, id)
}
func (t *agentsTx) BoundSandboxSpec(robot *uint64) (*a.SandboxSpec, error) {
	return t.readSandboxSpec("SELECT "+specColumns+" FROM cloud_computer_spec_binding b JOIN sandbox_spec s ON s.id=b.spec_id WHERE b.owner_key=COALESCE(?,0)", robot)
}
func (t *agentsTx) InsertSandboxSpec(s *a.SandboxSpec, user uint64) error {
	r, err := t.tx.ExecContext(t.ctx, "INSERT INTO sandbox_spec(name,image,cpu_millicores,memory_mib,network_policy,config_version,row_version,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", s.Name, s.Image, s.CPU, s.Memory, s.Network, user, user)
	return modelID(r, specNameError(err), &s.ID)
}
func (t *agentsTx) UpdateSandboxSpec(s *a.SandboxSpec, user uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE sandbox_spec SET name=?,image=?,cpu_millicores=?,memory_mib=?,network_policy=?,config_version=?,row_version=?,updated_by_user_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?", s.Name, s.Image, s.CPU, s.Memory, s.Network, s.ConfigVersion, s.RowVersion, user, s.ID)
	return specNameError(err)
}
func (t *agentsTx) DeleteSandboxSpec(id uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "DELETE FROM sandbox_spec WHERE id=?", id)
	return err
}
func (t *agentsTx) SpecReferences(id uint64) ([]a.SpecReference, error) {
	rows := []a.SpecReference{}
	err := t.tx.SelectContext(t.ctx, &rows, "SELECT a.id AS agent_id,COALESCE(a.name,'个人云电脑默认规格') AS name FROM cloud_computer_spec_binding b LEFT JOIN agent a ON a.robot_user_id=b.robot_user_id WHERE b.spec_id=? ORDER BY b.owner_key FOR SHARE OF b", id)
	return rows, err
}
func (t *agentsTx) SpecBinding(robot *uint64, lock bool) (*a.SpecBinding, error) {
	q := "SELECT id,robot_user_id,pool_capacity,spec_id,row_version FROM cloud_computer_spec_binding WHERE owner_key=COALESCE(?,0)"
	if lock {
		q += " FOR UPDATE"
	}
	var b a.SpecBinding
	err := t.tx.GetContext(t.ctx, &b, q, robot)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}
func (t *agentsTx) InsertSpecBinding(robot, spec *uint64, capacity *int, user uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "INSERT INTO cloud_computer_spec_binding(robot_user_id,spec_id,pool_capacity,row_version,updated_by_user_id,created_at,updated_at) VALUES(?,?,?,1,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", robot, spec, capacity, user)
	return err
}
func (t *agentsTx) UpdateSpecBinding(b *a.SpecBinding, user uint64) error {
	_, err := t.tx.ExecContext(t.ctx, "UPDATE cloud_computer_spec_binding SET spec_id=?,pool_capacity=?,row_version=?,updated_by_user_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?", b.SpecID, b.PoolCapacity, b.RowVersion, user, b.ID)
	return err
}
func specNameError(err error) error {
	var dbErr *driver.MySQLError
	if errors.As(err, &dbErr) && dbErr.Number == 1062 {
		return httpx.E(409, "NAME_CONFLICT", "沙箱规格名称已存在")
	}
	return err
}
