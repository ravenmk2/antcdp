package sandboxes

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"
)

func (m *memory) ExpiredLeases(now time.Time, after uint64, limit int) ([]Lease, error) {
	out := []Lease{}
	for _, v := range m.leases {
		if v.ReleasedAt == nil && !now.Before(v.ExpiresAt) {
			out = append(out, clone(v))
		}
	}
	sort.Slice(out, func(i, j int) bool { return cursorLess(out[i].ID, out[j].ID, after) })
	return out[:min(limit, len(out))], nil
}

type memory struct {
	mu         sync.Mutex
	next       uint64
	instances  map[uint64]Instance
	leases     map[uint64]Lease
	executions map[uint64]Execution
	operations map[uint64]Operation
}

func newMemory() *memory {
	return &memory{instances: map[uint64]Instance{}, leases: map[uint64]Lease{}, executions: map[uint64]Execution{}, operations: map[uint64]Operation{}}
}
func clone[T any](value T) T {
	raw, _ := json.Marshal(value)
	var copy T
	_ = json.Unmarshal(raw, &copy)
	return copy
}
func (m *memory) transact(_ context.Context, fn func(Repository) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return fn(m)
}
func (m *memory) Instance(id uint64, _ bool) (*Instance, error) {
	v, ok := m.instances[id]
	if !ok {
		return nil, nil
	}
	copy := clone(v)
	return &copy, nil
}
func (m *memory) InsertInstance(v *Instance) error {
	m.next++
	v.ID = m.next
	m.instances[v.ID] = clone(*v)
	return nil
}
func (m *memory) SaveInstance(v *Instance) error { m.instances[v.ID] = clone(*v); return nil }
func (m *memory) InstanceByToken(token string) (*Instance, error) {
	for _, v := range m.instances {
		if v.CreationToken == token {
			copy := clone(v)
			return &copy, nil
		}
	}
	return nil, nil
}
func (m *memory) Lease(id uint64, _ bool) (*Lease, error) {
	v, ok := m.leases[id]
	if !ok {
		return nil, nil
	}
	copy := clone(v)
	return &copy, nil
}
func (m *memory) InsertLease(v *Lease) error {
	m.next++
	v.ID = m.next
	m.leases[v.ID] = clone(*v)
	return nil
}
func (m *memory) SaveLease(v *Lease) error { m.leases[v.ID] = clone(*v); return nil }
func (m *memory) Execution(id uint64, _ bool) (*Execution, error) {
	v, ok := m.executions[id]
	if !ok {
		return nil, nil
	}
	copy := clone(v)
	return &copy, nil
}
func (m *memory) InsertExecution(v *Execution) error {
	m.next++
	v.ID = m.next
	m.executions[v.ID] = clone(*v)
	return nil
}
func (m *memory) SaveExecution(v *Execution) error { m.executions[v.ID] = clone(*v); return nil }
func (m *memory) ExecutionByToken(token string) (*Execution, error) {
	for _, v := range m.executions {
		if v.Token == token {
			copy := clone(v)
			return &copy, nil
		}
	}
	return nil, nil
}
func (m *memory) Operation(id uint64, _ bool) (*Operation, error) {
	v, ok := m.operations[id]
	if !ok {
		return nil, nil
	}
	copy := clone(v)
	return &copy, nil
}
func (m *memory) InsertOperation(v *Operation) error {
	m.next++
	v.ID = m.next
	m.operations[v.ID] = clone(*v)
	return nil
}
func (m *memory) SaveOperation(v *Operation) error { m.operations[v.ID] = clone(*v); return nil }
func (m *memory) OperationByToken(token string) (*Operation, error) {
	for _, v := range m.operations {
		if v.Token == token {
			copy := clone(v)
			return &copy, nil
		}
	}
	return nil, nil
}
func (m *memory) Leases(id uint64) ([]Lease, error) {
	out := []Lease{}
	for _, v := range m.leases {
		if v.InstanceID == id && v.ReleasedAt == nil {
			out = append(out, clone(v))
		}
	}
	return out, nil
}
func (m *memory) Busy(id uint64, lease *uint64) (bool, error) {
	for _, v := range m.executions {
		if v.InstanceID == id && v.FinishedAt == nil && (lease == nil || v.LeaseID == *lease) {
			return true, nil
		}
	}
	for _, v := range m.operations {
		if v.InstanceID == id && v.FinishedAt == nil && (lease == nil || v.LeaseID != nil && *v.LeaseID == *lease) {
			return true, nil
		}
	}
	return false, nil
}
func (m *memory) PendingExecutions(after uint64, limit int) ([]Execution, error) {
	out := []Execution{}
	for _, v := range m.executions {
		if v.FinishedAt == nil {
			out = append(out, clone(v))
		}
	}
	sort.Slice(out, func(i, j int) bool { return cursorLess(out[i].ID, out[j].ID, after) })
	return out[:min(limit, len(out))], nil
}
func (m *memory) PendingOperations(after uint64, limit int) ([]Operation, error) {
	out := []Operation{}
	for _, v := range m.operations {
		if v.FinishedAt == nil {
			out = append(out, clone(v))
		}
	}
	sort.Slice(out, func(i, j int) bool { return cursorLess(out[i].ID, out[j].ID, after) })
	return out[:min(limit, len(out))], nil
}

func cursorLess(a, b, after uint64) bool {
	if (a > after) != (b > after) {
		return a > after
	}
	return a < b
}
