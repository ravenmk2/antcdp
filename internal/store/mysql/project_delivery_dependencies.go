package mysql

import (
	"fmt"
	"slices"

	d "github.com/ravenmk2/antcdp/internal/modules/projectdelivery"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// The caller holds the project lock before unlinking any repository.
func (t *identityTx) unlinkDeliveryRepo(pid, id uint64) error {
	busy, e := t.DeliveryBusy(pid, 0, id)
	if e != nil {
		return e
	}
	if busy {
		return httpx.E(409, "BRANCH_OPERATION_IN_PROGRESS", "仓库正在创建分支，请稍后解除关联")
	}
	rows, _, e := t.Variants(pid, d.Query{Status: "all"})
	if e != nil {
		return e
	}
	value := fmt.Sprint(id)
	for n := range rows {
		v := &rows[n]
		if slices.Contains(v.Scope.IDs, value) {
			v.Scope.IDs = slices.DeleteFunc(v.Scope.IDs, func(s string) bool { return s == value })
			v.Version++
			if e = t.SaveVariant(v, false); e != nil {
				return e
			}
			if e = t.BumpVariants(pid); e != nil {
				return e
			}
		}
	}
	envs, e := t.Environments(pid, 0)
	if e != nil {
		return e
	}
	for n := range envs {
		v := &envs[n]
		if slices.Contains(v.Scope.IDs, value) {
			v.Scope.IDs = slices.DeleteFunc(v.Scope.IDs, func(s string) bool { return s == value })
			v.Version++
			if e = t.SaveEnvironment(v, false); e != nil {
				return e
			}
			if e = t.BumpEnvironments(v.VariantID); e != nil {
				return e
			}
		}
	}
	_, e = t.tx.ExecContext(t.ctx, "DELETE FROM project_branch_check WHERE project_id=? AND project_repository_id=?", pid, id)
	return e
}
