// Package papi maintains the embedded contracts for agent platform APIs.
package papi

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

const (
	ListTool = "papi_list"
	DescTool = "papi_desc"
	CallTool = "papi_call"

	Unavailable       = "PAPI_UNAVAILABLE"
	InvalidArguments  = "PAPI_INVALID_ARGUMENTS"
	DefinitionChanged = "PAPI_DEFINITION_CHANGED"
	MaxSchemaBytes    = 8 << 10
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)

//go:embed operations/*.json
var definitions embed.FS

func IsTool(key string) bool { return key == ListTool || key == DescTool || key == CallTool }

func ValidCode(code string) bool { return len(code) <= 96 && codePattern.MatchString(code) }

type Operation struct {
	Code              string          `json:"api_code"`
	Title             string          `json:"title"`
	Summary           string          `json:"summary"`
	Description       string          `json:"description"`
	Effect            string          `json:"effect"`
	InputSchema       json.RawMessage `json:"input_schema"`
	ExampleArgs       json.RawMessage `json:"example_args"`
	ResultDescription string          `json:"result_description"`

	fingerprint string
	schema      *inputSchema
	binding     binding
}

func (op *Operation) RequiresSandbox() bool { return op.binding.requiresSandbox }

type binding struct {
	requiresSandbox bool
	revision        string
	maxArgsBytes    int
	authorize       func(context.Context, agentcore.ExecutionContext, json.RawMessage) error
	run             OperationHandler
}

type Registry struct {
	operations map[string]*Operation
	codes      []string
}

type OperationHandler func(context.Context, agentcore.ExecutionContext, agentcore.ID, json.RawMessage) (json.RawMessage, error)

type GitOperations struct {
	List, Init, Ensure OperationHandler
	MergeRequests      GitLabMROperations
}

type GitLabMROperations struct {
	Create, List, Get, Update, Merge OperationHandler
}

func New() (*Registry, error) {
	unavailable := func(context.Context, agentcore.ExecutionContext, agentcore.ID, json.RawMessage) (json.RawMessage, error) {
		return nil, &Failure{Code: Unavailable}
	}
	return NewWithGit(GitOperations{
		List: unavailable, Init: unavailable, Ensure: unavailable,
		MergeRequests: GitLabMROperations{Create: unavailable, List: unavailable, Get: unavailable, Update: unavailable, Merge: unavailable},
	})
}

func NewWithGit(git GitOperations) (*Registry, error) {
	return loadRegistry(definitions, map[string]binding{
		"operations/git_repo_list.json":    {revision: "1", maxArgsBytes: 1024, run: git.List},
		"operations/git_repo_init.json":    {revision: "2", maxArgsBytes: 32 << 10, requiresSandbox: true, run: git.Init},
		"operations/svc_cred_ensure.json":  {revision: "1", maxArgsBytes: 128, requiresSandbox: true, run: git.Ensure},
		"operations/gitlab_mr_create.json": {revision: "1", maxArgsBytes: 128 << 10, run: git.MergeRequests.Create},
		"operations/gitlab_mr_list.json":   {revision: "1", maxArgsBytes: 16 << 10, run: git.MergeRequests.List},
		"operations/gitlab_mr_get.json":    {revision: "1", maxArgsBytes: 256, run: git.MergeRequests.Get},
		"operations/gitlab_mr_update.json": {revision: "1", maxArgsBytes: 128 << 10, run: git.MergeRequests.Update},
		"operations/gitlab_mr_merge.json":  {revision: "1", maxArgsBytes: 512, run: git.MergeRequests.Merge},
		"operations/echo.json": {revision: "1", maxArgsBytes: 8 << 10,
			run: func(_ context.Context, _ agentcore.ExecutionContext, _ agentcore.ID, args json.RawMessage) (json.RawMessage, error) {
				return args, nil
			}},
	})
}

func loadRegistry(files fs.FS, bindings map[string]binding) (*Registry, error) {
	paths, err := fs.Glob(files, "operations/*.json")
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 || len(paths) != len(bindings) {
		return nil, errors.New("platform API definitions and handlers must be paired")
	}
	r := &Registry{operations: make(map[string]*Operation, len(paths))}
	for _, path := range paths {
		bound := bindings[path]
		op, err := loadOperation(files, path, bound)
		if err != nil {
			return nil, fmt.Errorf("platform API %s: %w", path, err)
		}
		if _, exists := r.operations[op.Code]; exists {
			return nil, fmt.Errorf("duplicate platform API %q", op.Code)
		}
		r.operations[op.Code] = op
		r.codes = append(r.codes, op.Code)
	}
	slices.Sort(r.codes)
	return r, nil
}

func loadOperation(files fs.FS, path string, bound binding) (*Operation, error) {
	data, err := fs.ReadFile(files, path)
	if err != nil {
		return nil, err
	}
	if _, err = decodeObject(data); err != nil {
		return nil, err
	}
	var op Operation
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&op); err != nil {
		return nil, err
	}
	if !ValidCode(op.Code) || op.Title == "" || len(op.Title) > 128 || op.Summary == "" || len(op.Summary) > 512 || op.Description == "" || len(op.Description) > 4096 || op.ResultDescription == "" || len(op.ResultDescription) > 4096 || (op.Effect != "read" && op.Effect != "write") || bound.run == nil || bound.revision == "" || bound.maxArgsBytes <= 0 {
		return nil, errors.New("invalid operation definition or handler")
	}
	op.binding = bound
	op.schema, err = compileSchema(op.InputSchema)
	if err != nil {
		return nil, err
	}
	if err = op.validate(op.ExampleArgs, nil); err != nil {
		return nil, fmt.Errorf("example arguments: %w", err)
	}
	op.fingerprint, err = agentcore.ContentHash([]any{json.RawMessage(data), bound.revision, bound.maxArgsBytes})
	return &op, err
}

func (r *Registry) Operation(code string) *Operation {
	if r == nil {
		return nil
	}
	return r.operations[code]
}

func (r *Registry) Codes() []string { return slices.Clone(r.codes) }

func (r *Registry) Freeze(code string, constraints json.RawMessage) (agentcore.PAPIGrant, bool) {
	op := r.Operation(code)
	if op == nil {
		return agentcore.PAPIGrant{}, false
	}
	return agentcore.PAPIGrant{Code: code, Fingerprint: op.fingerprint, Constraints: string(constraints)}, true
}

type Summary struct {
	API     string `json:"api"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Effect  string `json:"effect"`
}

func (op *Operation) summary() Summary {
	return Summary{API: op.Code, Title: op.Title, Summary: op.Summary, Effect: op.Effect}
}

func (op *Operation) Matches(query string) bool {
	return query == "" || strings.Contains(strings.ToLower(op.Code+" "+op.Title+" "+op.Summary), query)
}
