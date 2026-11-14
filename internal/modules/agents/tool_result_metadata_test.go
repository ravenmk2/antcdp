package agents

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
)

type metadataRepository struct {
	CloudRepository
	binding   *CloudLeaseRow
	execution *CloudExecutionRow
}

func (m metadataRepository) Lease(uint64, bool) (*CloudLeaseRow, error) {
	return m.binding, nil
}
func (m metadataRepository) CloudExecution(uint64, bool) (*CloudExecutionRow, error) {
	return m.execution, nil
}

type metadataTx struct {
	identity.Tx
	repo CloudRepository
}

func (m metadataTx) CloudState() CloudRepository { return m.repo }

func metadataFixture(t *testing.T) (SandboxExecutionMetadata, metadataTx, executionRows, *ToolCallRow) {
	t.Helper()
	meta := SandboxExecutionMetadata{ExecutionID: 7, ComputerID: 2, Command: "echo ok", CWD: "/data/sessions/4", State: "running", Background: true}
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := uint64(2)
	repo := metadataRepository{binding: &CloudLeaseRow{RootRunID: 5, ComputerID: workspaceID}, execution: &CloudExecutionRow{ID: 7, RootRunID: 5, RunID: 6, ToolCallID: 8, CWD: meta.CWD, IsBackground: true, LastObservation: raw}}
	x := executionRows{Root: &RunRow{ID: 5}, Agent: &Definition{ID: 9}}
	call := &ToolCallRow{ID: 8, RootRunID: 5, RunID: 6, ToolKey: "exec_command"}
	return meta, metadataTx{repo: repo}, x, call
}

func TestToolMetadataRejectsAmbiguousUntrustedProjection(t *testing.T) {
	meta, tx, x, call := metadataFixture(t)
	valid, err := EncodeSandboxExecutionMetadata(meta)
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string]string{
		"duplicate envelope":   `{"sandbox_execution":{},"sandbox_execution":{}}`,
		"duplicate nested":     strings.Replace(string(valid), `"cloud_computer_id":"2"`, `"cloud_computer_id":"2","cloud_computer_id":"2"`, 1),
		"case folded":          strings.Replace(string(valid), `"cloud_computer_id"`, `"Workspace_ID"`, 1),
		"unknown provider ref": strings.Replace(string(valid), `"truncated":false`, `"truncated":false,"provider_execution_id":"remote"`, 1),
		"null boolean":         strings.Replace(string(valid), `"background":true`, `"background":null`, 1),
		"missing field":        strings.Replace(string(valid), `,"stderr":""`, ``, 1),
		"trailing value":       string(valid) + `{}`,
		"wrong workspace":      strings.Replace(string(valid), `"cloud_computer_id":"2"`, `"cloud_computer_id":"88"`, 1),
		"wrong command":        strings.Replace(string(valid), "echo ok", "echo fake", 1),
		"invalid state":        strings.Replace(string(valid), `"state":"running"`, `"state":"succeeded"`, 1),
		"zero execution":       strings.Replace(string(valid), `"execution_id":"7"`, `"execution_id":"0"`, 1),
		"oversized":            strings.Repeat(" ", toolMetadataLimit) + string(valid),
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateToolMetadata(tx, x, call, json.RawMessage(raw), map[string]any{}); err == nil {
				t.Fatal("accepted untrusted metadata")
			}
		})
	}
	if err := validateToolMetadata(tx, x, call, valid, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	call.ToolKey = "read_file"
	if err := validateToolMetadata(tx, x, call, valid, map[string]any{}); err == nil {
		t.Fatal("arbitrary tool forged execution projection")
	}
}

func TestExecutionMetadataAllowsRootFamilyObservationButNotForgedLaunch(t *testing.T) {
	meta, tx, x, call := metadataFixture(t)
	call.ID, call.RunID = 100, 101
	if err := verifyExecutionMetadata(tx.repo, x.Root, call, meta); err == nil {
		t.Fatal("launch from another call accepted")
	}
	call.ToolKey = "process_status"
	exit := 0
	meta.State, meta.ExitCode = "completed", &exit
	if err := verifyExecutionMetadata(tx.repo, x.Root, call, meta); err != nil {
		t.Fatalf("later root-family observation rejected: %v", err)
	}
	x.Root.ID = 200
	if err := verifyExecutionMetadata(tx.repo, x.Root, call, meta); err == nil {
		t.Fatal("another root's execution accepted")
	}
}

func TestMetadataEncoderBoundsEscapedOutputAndPreservesIdentity(t *testing.T) {
	meta, _, _, _ := metadataFixture(t)
	meta.Stdout, meta.Stderr = strings.Repeat("\x00", 30000), strings.Repeat("中文", 2000)
	raw, err := EncodeSandboxExecutionMetadata(meta)
	if err != nil || len(raw) > toolMetadataLimit {
		t.Fatalf("size %d: %v", len(raw), err)
	}
	var result struct {
		Execution SandboxExecutionMetadata `json:"sandbox_execution"`
	}
	if json.Unmarshal(raw, &result) != nil || !result.Execution.Truncated || result.Execution.Command != meta.Command || result.Execution.ExecutionID != meta.ExecutionID || !strings.HasPrefix(meta.Stdout, result.Execution.Stdout) {
		t.Fatal("invalid bounded projection")
	}
}

func TestSkillMaterializationRequiresFrozenContextAndInstalledState(t *testing.T) {
	_, tx, x, _ := metadataFixture(t)
	load := SkillLoadMetadata{SkillID: 1, VersionID: 2, SHA256: strings.Repeat("a", 64), RelativePath: "SKILL.md"}
	if err := ValidateSkillLoadMetadata(load, 9); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/data/agents/8/skills/test", "/data/agents/9/skills/../test", "/data/agents/9/skills/test/SKILL.md", "/data/agents/9/skills/.generation/test", "/data/agents/9/skills/test/"} {
		load.Materialized, load.StablePath = true, &path
		if err := ValidateSkillLoadMetadata(load, 9); err == nil {
			t.Fatalf("accepted invalid stable alias: %s", path)
		}
	}
	path := "/data/agents/9/skills/test"
	load.StablePath = &path
	if err := ValidateSkillLoadMetadata(load, 9); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{"skill_load": load})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateToolMetadata(tx, x, &ToolCallRow{ToolKey: "skill"}, raw, map[string]any{}); err == nil {
		t.Fatal("new load claimed a sandbox installation")
	}
}
