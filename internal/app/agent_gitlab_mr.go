package app

import (
	"context"
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/papi"
)

func gitLabMRHandler[Args, Result any](s *integrations.Service, run func(*integrations.GitLabMRClient, context.Context, Args) (Result, error)) papi.OperationHandler {
	return func(ctx context.Context, x agentcore.ExecutionContext, _ agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
		// The schemas bound integers to the exact JSON number range. Normalize
		// forms such as 42.0 and 4.2e1 before decoding the typed arguments.
		var input map[string]any
		if json.Unmarshal(raw, &input) != nil {
			return nil, &papi.Failure{Code: papi.InvalidArguments}
		}
		projectRepoID, _ := input["project_repo_id"].(string)
		id, err := collaboration.ID(projectRepoID)
		if err != nil {
			return nil, &papi.Failure{Code: papi.InvalidArguments, Field: "/project_repo_id", Constraint: "positiveDecimalID"}
		}
		normalized, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		var args Args
		if json.Unmarshal(normalized, &args) != nil {
			return nil, &papi.Failure{Code: papi.InvalidArguments}
		}
		client, err := s.AgentGitLabMRClient(ctx, x.Authorization, id)
		if err != nil {
			return nil, err
		}
		result, err := run(client, ctx, args)
		if err != nil {
			return nil, err
		}
		return json.Marshal(result)
	}
}

type gitLabMRTarget struct {
	IID uint64 `json:"iid"`
}

type gitLabMRUpdateArgs struct {
	gitLabMRTarget
	integrations.GitLabMRUpdate
}

type gitLabMRMergeArgs struct {
	gitLabMRTarget
	SHA                string `json:"sha"`
	Squash             *bool  `json:"squash"`
	RemoveSourceBranch *bool  `json:"remove_source_branch"`
}

func gitLabMROperations(s *integrations.Service) papi.GitLabMROperations {
	return papi.GitLabMROperations{
		Create: gitLabMRHandler(s, (*integrations.GitLabMRClient).Create),
		List:   gitLabMRHandler(s, (*integrations.GitLabMRClient).List),
		Get: gitLabMRHandler(s, func(g *integrations.GitLabMRClient, ctx context.Context, in gitLabMRTarget) (integrations.GitLabMR, error) {
			return g.Get(ctx, in.IID)
		}),
		Update: gitLabMRHandler(s, func(g *integrations.GitLabMRClient, ctx context.Context, in gitLabMRUpdateArgs) (integrations.GitLabMR, error) {
			return g.Update(ctx, in.IID, in.GitLabMRUpdate)
		}),
		Merge: gitLabMRHandler(s, func(g *integrations.GitLabMRClient, ctx context.Context, in gitLabMRMergeArgs) (integrations.GitLabMR, error) {
			return g.Merge(ctx, in.IID, integrations.GitLabMRMerge{
				SHA: in.SHA, Squash: in.Squash, RemoveSourceBranch: in.RemoveSourceBranch,
			})
		}),
	}
}
