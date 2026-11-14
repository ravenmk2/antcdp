package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentadapters/eino"
	"github.com/ravenmk2/antcdp/internal/agentadapters/mcp"
	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modeladapters"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/modules/agentresources"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/models"
	webservice "github.com/ravenmk2/antcdp/internal/modules/webaccess"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/netguard"
	"github.com/ravenmk2/antcdp/internal/sandboxadapters/opensandbox"
	"github.com/ravenmk2/antcdp/internal/webaccess"
)

type agentApplication struct {
	Service   *agents.Service
	Resources *agentresources.Service
	Runtime   *agentcore.Runtime
	Hub       *agentcore.Hub
	Sandboxes *agents.CloudService
}

func newAgentApplication(dataDir string, installer *install.Service, accounts *identity.Service, modelsService *models.Service, webService *webservice.Service) (*agentApplication, error) {
	files, err := agents.NewByteStore(filepath.Join(dataDir, "agents", "files"))
	if err != nil {
		return nil, err
	}
	store := modelsService.Store
	epoch := cryptox.ID()
	hub := agentcore.NewHub(epoch)
	service := &agents.Service{Identity: accounts, Store: store, ETag: installer.AgentETag, Models: modelsService, Files: files, Epoch: epoch}
	resources := &agentresources.Service{Identity: accounts, Store: store, Cipher: installer.AgentResourceSecret, ETag: installer.AgentETag, Files: files, Epoch: epoch,
		MCPFactory: func(_ context.Context, config mcp.Config) (agentresources.MCPClient, error) {
			hosts, err := installer.OutboundProtectedHosts()
			if err != nil {
				return nil, err
			}
			return mcp.New(config, hosts)
		}}
	resources.MCPOpen = func(ctx context.Context, config mcp.Config) (agentresources.MCPSession, error) {
		hosts, err := installer.OutboundProtectedHosts()
		if err != nil {
			return nil, err
		}
		client, err := mcp.New(config, hosts)
		if err != nil {
			return nil, err
		}
		return client.Open(ctx)
	}
	sandboxes := &agents.CloudService{Host: service, Cipher: installer.SandboxSecret, ControlKey: installer.SandboxControlKey, InstallationID: installer.SandboxInstallationID, Epoch: epoch, Factory: opensandbox.Factory{}, ProtectedTargets: func() ([]string, error) { return agentSandboxProtectedTargets(installer) }}
	sandboxes.PrepareWorkspace = sandboxes.InitializeComputer
	sandboxes.VerifyEnvironment = sandboxes.VerifyWorkspaceEnvironment
	sandboxes.ExecutionReconciler = sandboxes.ReconcileExecutions
	service.Sandboxes = sandboxes
	service.Skills = agents.FrozenSkillSource{Host: service}
	service.ManagementOperation = func(ctx context.Context, raw string, id uint64) (*agents.Result, error) {
		result, err := resources.ResourceOperation(ctx, raw, id)
		if result == nil {
			return nil, err
		}
		return &agents.Result{Data: result.Data, Tag: result.Tag, Location: result.Location, Status: result.Status, Replayed: result.Replayed, Pagination: result.Pagination, Auth: result.Auth}, err
	}
	service.RuntimeModels = agentModelFactory{modelsService}
	service.Tokens = agentTokenCounter{}
	service.Compactor = &agentcore.Compactor{Store: service, Models: service, Tokens: service.Tokens, Hub: hub}
	catalog := &agentToolCatalog{resources: resources, web: webService}
	service.Catalog = agents.ResourceCatalog{Skill: resources.ReadSkillSnapshot, Tools: catalog.list, Tool: catalog.get, ValidateToolConstraints: catalog.validateConstraints, MCPArguments: mcp.ValidateArguments, MCPServer: resources.ValidateMCPServer, MCPIdentity: resources.ReadMCPIdentity, DiscoverMCP: resources.DiscoverMCP, AuthorizeTool: catalog.authorize}
	modelsService.ReferenceCheck = service.ModelReferenceCheck
	runtime := &agentcore.Runtime{Epoch: epoch, Store: service, Recovery: service, Engine: &eino.Engine{}, Hub: hub, Environment: sandboxes}
	router := &webaccess.Router{Source: webService, ClassifyURL: func(ctx context.Context, raw string, allowed []string) (bool, error) {
		hosts, err := installer.OutboundProtectedHosts()
		if err != nil {
			return false, err
		}
		return (netguard.Policy{AllowedInternalHosts: allowed, ProtectedHosts: hosts}).Classify(ctx, raw)
	}}
	dispatcher := &agentToolDispatcher{service: service, resources: resources, runtime: runtime, web: router}
	runner, err := agentcore.NewToolRunner(service, dispatcher, 32)
	if err != nil {
		return nil, err
	}
	runner.Hub = hub
	runtime.Hooks = func(_ context.Context, execution agentcore.ExecutionContext) (agentcore.EngineHooks, error) {
		return &agentcore.PersistentHooks{Execution: execution, Prepare: service.PrepareStep, Models: agentModelFactory{modelsService}, Store: service, Tools: runner, Hub: hub, Estimate: estimateAgentRequest}, nil
	}
	service.Committed = func(ctx context.Context, receipt agentcore.CommitReceipt) {
		hub.Committed(ctx, receipt)
		runtime.Notify()
	}
	service.CancelRun = runtime.Cancel
	return &agentApplication{Service: service, Resources: resources, Runtime: runtime, Hub: hub, Sandboxes: sandboxes}, nil
}

type agentModelFactory struct{ service *models.Service }

func (f agentModelFactory) Open(ctx context.Context, frozen agentcore.LockedModel) (modelcore.Client, error) {
	var route models.RuntimeRoute
	if json.Unmarshal(frozen.Connection, &route) != nil || route.ProviderID != uint64(frozen.ProviderID) || route.DefinitionID != uint64(frozen.DefinitionID) || route.RemoteModelID != frozen.RemoteModelID || route.Protocol != string(frozen.Protocol) || route.ProviderType != string(frozen.ProviderType) {
		return nil, httpx.E(409, "MODEL_STATE_INVALID", "会话模型配置不完整")
	}
	return f.service.OpenRuntimeClient(ctx, route, func(route models.RuntimeRoute, secret string) (modelcore.Client, error) {
		config := modeladapters.Config{Provider: frozen.ProviderType, Protocol: frozen.Protocol, BaseURL: route.Config.BaseURL, APIKey: secret, ConnectTimeout: time.Duration(route.Config.ConnectTimeout) * time.Second, RequestTimeout: time.Duration(route.Config.RequestTimeout) * time.Second}
		if route.Config.CustomCA != nil {
			config.CustomCAPEM = *route.Config.CustomCA
		}
		return modeladapters.NewClient(config, nil)
	})
}

// Byte count is a conservative reservation, not a provider usage claim. Native
// image bytes stay memory-only but participate in this upper bound explicitly.
func estimateAgentRequest(request modelcore.Request) (agentcore.Budget, error) {
	b, err := json.Marshal(request)
	if err != nil {
		return agentcore.Budget{}, err
	}
	input := uint64(len(b))
	for _, message := range request.Messages {
		for _, image := range message.Images {
			input += uint64(len(image.DataBase64))
		}
	}
	var output uint64
	if raw := request.Parameters["max_output_tokens"]; len(raw) > 0 {
		if err = json.Unmarshal(raw, &output); err != nil {
			return agentcore.Budget{}, err
		}
	}
	return agentcore.Budget{ModelCalls: 1, InputTokens: input, OutputTokens: output}, nil
}

type agentTokenCounter struct{}

func (agentTokenCounter) Count(request modelcore.Request) (uint64, error) {
	budget, err := estimateAgentRequest(request)
	return budget.InputTokens, err
}

func runAgents(ctx context.Context, installer *install.Service, app *agentApplication, logger *slog.Logger) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for installer.Status(ctx).State != install.Ready {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
	app.Runtime.OnError = func(error) {
		if ctx.Err() == nil {
			logger.Error("agent runtime operation failed")
		}
	}
	titleCtx, stopTitles := context.WithCancel(ctx)
	titlesDone := make(chan struct{})
	go func() {
		defer close(titlesDone)
		app.Service.RunSessionTitles(titleCtx, app.Runtime.OnError)
	}()
	defer func() { stopTitles(); <-titlesDone }()
	if err := app.Runtime.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error("agent runtime stopped")
	}
}

func maintainAgentResources(ctx context.Context, installer *install.Service, app *agentApplication, logger *slog.Logger) {
	defer app.Resources.CloseMCPDebug()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	recovered := false
	for {
		if ctx.Err() != nil {
			return
		}
		if installer.Status(ctx).State == install.Ready {
			if !recovered {
				err := app.Resources.RecoverSkills(ctx)
				if err == nil {
					recovered = true
				} else if ctx.Err() == nil {
					logger.Error("agent resource recovery failed")
				}
			}
			if recovered {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
	// Slow MCP endpoints cannot delay skill validation, file cleanup or timed
	// interactions. Each queue has one bounded worker, never overlapping itself.
	var workers sync.WaitGroup
	for _, process := range []func(context.Context) error{
		func(c context.Context) error { return app.Resources.ProcessSkills(c, 4) },
		func(c context.Context) error { return app.Resources.CleanupMCPDebug(c) },
		func(c context.Context) error { return app.Resources.CleanupSkills(c, 20) },
		func(c context.Context) error { return app.Service.ProcessFileMaintenance(c, 20) },
		func(c context.Context) error { return app.Service.ProcessPendingCompactions(c, 4) },
		func(c context.Context) error { return app.Sandboxes.ProcessPending(c, 8) },
		func(c context.Context) error { return app.Sandboxes.ProcessWorkspaceOperations(c, 8) },
		func(c context.Context) error { return app.Sandboxes.ProcessFileOperations(c, 8) },
	} {
		workers.Go(func() {
			poll := time.NewTicker(time.Second)
			defer poll.Stop()
			for {
				if ctx.Err() != nil {
					return
				}
				if installer.Status(ctx).State == install.Ready {
					if err := process(ctx); err != nil && ctx.Err() == nil {
						logger.Error("agent resource maintenance failed")
					}
				}
				select {
				case <-ctx.Done():
					return
				case <-poll.C:
				}
			}
		})
	}
	workers.Wait()
}
