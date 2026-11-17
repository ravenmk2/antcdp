package mysql

import (
	"context"
	"testing"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

// Commit a second transaction after the unlocked session lookup, before the
// execution transaction takes its parent locks. No scheduling sleeps are needed.
type executionRaceStore struct {
	identity.Store
	beforeLock func() error
}

func (s *executionRaceStore) Transact(ctx context.Context, fn func(identity.Tx) error) error {
	return s.Store.Transact(ctx, func(tx identity.Tx) error {
		return fn(&executionRaceTx{identityTx: tx.(*identityTx), store: s})
	})
}

type executionRaceTx struct {
	*identityTx
	store *executionRaceStore
}

func (t *executionRaceTx) Agents() a.Repository {
	return &executionRaceRepository{Repository: t.identityTx.Agents(), store: t.store}
}

type executionRaceRepository struct {
	a.Repository
	store *executionRaceStore
}

func (r *executionRaceRepository) Definition(id uint64, lock bool) (*a.Definition, error) {
	if lock && r.store.beforeLock != nil {
		change := r.store.beforeLock
		r.store.beforeLock = nil
		if err := change(); err != nil {
			return nil, err
		}
	}
	return r.Repository.Definition(id, lock)
}

func runtimeExecutionRace(t *testing.T, f *agentIntegrationFixture, agent uint64) {
	for _, change := range []string{"title", "queued_input", "stop", "fence"} {
		t.Run(change, func(t *testing.T) {
			session := runtimeSession(t, f, agent)
			id := session.Configuration.ID
			x := runtimeClaim(t, f, id, "execution lookup race")
			store := &executionRaceStore{Store: f.Store}
			store.beforeLock = func() error {
				switch change {
				case "title":
					config, err := f.Agents.GetSessionConfiguration(f.Context, f.AdminToken, id)
					if err != nil {
						return err
					}
					_, err = f.Agents.PatchSessionConfiguration(f.Context, f.AdminToken, id, config.Tag, a.SessionPatch{Title: a.Field[string]{Set: true, Value: "Renamed during execution lookup"}})
					return err
				case "queued_input":
					_, err := f.Agents.SubmitInput(f.Context, f.AdminToken, id, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "next turn"}}})
					return err
				case "stop":
					_, err := f.Agents.StopRun(f.Context, f.AdminToken, uint64(x.Ref.RunID), cryptox.ID(), a.StopRunWrite{})
					return err
				default:
					_, err := f.Store.db.ExecContext(f.Context, "UPDATE agent_run SET fence_version=fence_version+1 WHERE id=?", uint64(x.Ref.RunID))
					return err
				}
			}
			service := &a.Service{Store: func() (identity.Store, error) { return store, nil }, Sandboxes: f.Agents.Sandboxes}
			got, err := service.AuthorizeExecution(f.Context, x.Ref)
			if store.beforeLock != nil {
				t.Fatal("concurrent change was not exercised")
			}
			switch change {
			case "stop":
				modelsExpectCode(t, err, "RUN_NOT_EXECUTABLE")
			case "fence":
				modelsExpectCode(t, err, "EXECUTION_FENCED")
			default:
				if err != nil || got.Ref != x.Ref || got.Model.SelectionHash != x.Model.SelectionHash {
					t.Fatalf("metadata change interrupted frozen execution: %v", err)
				}
				runtimeEnd(t, f, x)
			}
		})
	}
}
