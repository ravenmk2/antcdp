package agents

import (
	"context"

	"github.com/ravenmk2/antcdp/internal/modules/cloudcomputers"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/sandboxes"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func (s *CloudService) ReconcileResources(ctx context.Context, limit int) error {
	return s.foundation().Reconcile(ctx, limit)
}

// This bridge adapts application configuration to the standalone sandbox service.
// The service itself has no dependency on Agent state or cloud computers.
func (s *CloudService) foundation() *sandboxes.Service {
	return &sandboxes.Service{Epoch: s.Epoch, Recovery: &s.resourceRecovery, InstallationID: s.InstallationID, Transact: func(ctx context.Context, fn func(sandboxes.Repository) error) error {
		store, err := s.Host.Store()
		if err != nil {
			return err
		}
		return store.Transact(ctx, func(tx identity.Tx) error {
			provider, ok := tx.(interface{ SandboxState() sandboxes.Repository })
			if !ok {
				return unavailable()
			}
			return fn(provider.SandboxState())
		})
	}, Open: func(ctx context.Context, connection, generation uint64) (sandboxcore.Provider, error) {
		var config CloudConnection
		err := s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error {
			row, err := repo.Connection(false)
			if err != nil {
				return err
			}
			if row == nil || row.ID != connection || row.BackendGeneration != generation {
				return &sandboxcore.Error{Code: "SANDBOX_BACKEND_FENCED"}
			}
			config, err = s.runtimeConnection(row)
			return err
		})
		if err != nil {
			return nil, err
		}
		return s.openProvider(ctx, config)
	}}
}

func (s *CloudService) product() *cloudcomputers.Service {
	return &cloudcomputers.Service{Epoch: s.Epoch, Sandboxes: s.foundation(), InstallationID: s.InstallationID, DecodeConnection: s.runtimeConnection, OpenProvider: s.openProvider, ProtectedTargets: s.ProtectedTargets, EndpointProtection: s.endpointProtection,
		Transact: func(ctx context.Context, fn func(cloudcomputers.Repository) error) error {
			return s.cloudBackground(ctx, func(_ identity.Tx, _ Repository, _ StateRepository, repo CloudRepository) error { return fn(repo) })
		},
		PrepareWorkspace: func(ctx context.Context, v *cloudcomputers.Access, agent uint64) error {
			if s.PrepareWorkspace == nil {
				return unavailable()
			}
			return s.PrepareWorkspace(ctx, cloudAccessAdapter(v), agent)
		},
		VerifyEnvironment: func(ctx context.Context, v *cloudcomputers.Access) (SandboxCapabilities, []DiagnosticCheck, error) {
			if s.VerifyEnvironment == nil {
				return SandboxCapabilities{}, nil, unavailable()
			}
			return s.VerifyEnvironment(ctx, cloudAccessAdapter(v))
		},
	}
}
func cloudAccessAdapter(v *cloudcomputers.Access) *SandboxAccess {
	return &SandboxAccess{Provider: v.Provider, Resource: v.Resource, ComputerID: v.ComputerID, BackendGeneration: v.BackendGeneration, InstanceID: v.InstanceID, StorageGeneration: v.StorageGeneration, OperationID: v.OperationID, OperationFence: v.OperationFence, CWD: v.CWD}
}
