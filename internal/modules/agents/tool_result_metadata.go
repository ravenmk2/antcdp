package agents

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

const toolMetadataLimit = 64 << 10

// EncodeSandboxExecutionMetadata bounds the actual JSON event projection, not
// just unescaped output bytes. It never truncates command identity or paths.
func EncodeSandboxExecutionMetadata(meta SandboxExecutionMetadata) (json.RawMessage, error) {
	if err := validExecutionMetadata(meta); err != nil {
		return nil, err
	}
	encode := func(v SandboxExecutionMetadata) ([]byte, error) {
		return json.Marshal(struct {
			Execution SandboxExecutionMetadata `json:"sandbox_execution"`
		}{Execution: v})
	}
	raw, err := encode(meta)
	if err != nil || len(raw) <= toolMetadataLimit {
		return raw, err
	}
	stdout, stderr := meta.Stdout, meta.Stderr
	meta.Stdout, meta.Stderr, meta.Truncated = "", "", true
	raw, err = encode(meta)
	if err != nil || len(raw) > toolMetadataLimit {
		return nil, integrity()
	}
	low, high := 0, len(stdout)+len(stderr)
	for low < high {
		mid := low + (high-low+1)/2
		candidate := meta
		candidate.Stdout = utf8Prefix(stdout, min(mid, len(stdout)))
		candidate.Stderr = utf8Prefix(stderr, max(0, mid-len(stdout)))
		encoded, e := encode(candidate)
		if e != nil {
			return nil, e
		}
		if len(encoded) <= toolMetadataLimit {
			low, raw = mid, encoded
		} else {
			high = mid - 1
		}
	}
	return raw, nil
}

func utf8Prefix(value string, n int) string {
	value = value[:min(n, len(value))]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}

// SkillLoadMetadata preserves the historical event shape. New loads contain
// text only and always report materialized=false and stable_path=null.
type SkillLoadMetadata struct {
	SkillID      agentcore.ID `json:"skill_id"`
	VersionID    agentcore.ID `json:"skill_version_id"`
	SHA256       string       `json:"content_sha256"`
	Materialized bool         `json:"materialized"`
	StablePath   *string      `json:"stable_path"`
	RelativePath string       `json:"relative_path"`
}

// metadataObject requires exact, unique keys and one JSON object. Each nested
// object is decoded separately, so no case-folded aliases or duplicate fields
// can make the projection disagree with its authorization checks.
func metadataObject(raw []byte, keys ...string) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) || len(raw) > toolMetadataLimit {
		return nil, integrity()
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, integrity()
	}
	allowed := make(map[string]bool, len(keys))
	for _, key := range keys {
		allowed[key] = true
	}
	result := make(map[string]json.RawMessage, len(keys))
	for d.More() {
		token, err = d.Token()
		key, ok := token.(string)
		if err != nil || !ok || !allowed[key] || result[key] != nil {
			return nil, integrity()
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, integrity()
		}
		result[key] = value
	}
	if token, err = d.Token(); err != nil || token != json.Delim('}') {
		return nil, integrity()
	}
	if d.Decode(new(any)) != io.EOF || len(result) != len(keys) {
		return nil, integrity()
	}
	return result, nil
}

func decodeMetadata(raw []byte, out any, nullable string, keys ...string) error {
	fields, err := metadataObject(raw, keys...)
	if err != nil {
		return err
	}
	for key, value := range fields {
		if key != nullable && bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return integrity()
		}
	}
	if json.Unmarshal(raw, out) != nil {
		return integrity()
	}
	return nil
}

// ValidateSkillLoadMetadata checks the stable public alias, never an internal
// generation path. It does not establish that bytes have been materialized.
func ValidateSkillLoadMetadata(load SkillLoadMetadata, agentID uint64) error {
	hash, err := hex.DecodeString(load.SHA256)
	if err != nil || len(hash) != 32 || strings.ToLower(load.SHA256) != load.SHA256 || load.SkillID == 0 || load.VersionID == 0 || agentID == 0 || !utf8.ValidString(load.RelativePath) || load.RelativePath == "" || len(load.RelativePath) > 1024 || strings.ContainsAny(load.RelativePath, "\\\x00") || strings.HasPrefix(load.RelativePath, "/") {
		return integrity()
	}
	for _, part := range strings.Split(load.RelativePath, "/") {
		if part == ".." || part == "." || part == "" {
			return integrity()
		}
	}
	if !load.Materialized {
		if load.StablePath != nil {
			return integrity()
		}
		return nil
	}
	if load.StablePath == nil {
		return integrity()
	}
	prefix := "/data/agents/" + strconv.FormatUint(agentID, 10) + "/skills/"
	name, ok := strings.CutPrefix(*load.StablePath, prefix)
	if !ok || !skillpackage.ValidName(name) {
		return integrity()
	}
	return nil
}

func validateToolMetadata(tx identity.Tx, x executionRows, call *ToolCallRow, raw json.RawMessage, extra map[string]any) error {
	if call.ToolKey == "skill" {
		fields, err := metadataObject(raw, "skill_load")
		if err != nil {
			return err
		}
		var load SkillLoadMetadata
		if err = decodeMetadata(fields["skill_load"], &load, "stable_path", "skill_id", "skill_version_id", "content_sha256", "materialized", "stable_path", "relative_path"); err != nil {
			return err
		}
		if err = ValidateSkillLoadMetadata(load, x.Agent.ID); err != nil {
			return err
		}
		if x.Context == nil || x.Context.Row == nil {
			return integrity()
		}
		skills, err := frozenSkills(x.Context.Row)
		if err != nil {
			return err
		}
		matched := false
		for _, skill := range skills {
			if skill.SkillID != uint64(load.SkillID) || skill.VersionID != uint64(load.VersionID) || skill.ContentSHA != load.SHA256 {
				continue
			}
			if load.Materialized && (load.StablePath == nil || *load.StablePath != skillPath(x.Context.Row.AgentID, skill.Name)) {
				return integrity()
			}
			for _, entry := range skill.Manifest.Entries {
				matched = matched || entry.Path == load.RelativePath
			}
		}
		if !matched {
			return integrity()
		}
		if load.Materialized {
			if x.Context.Row.CloudComputerID == nil {
				return integrity()
			}
			cr, err := CloudStateFor(tx)
			if err != nil {
				return err
			}
			state, err := cr.SkillState(*x.Context.Row.CloudComputerID, x.Context.Row.AgentID, false)
			if err != nil {
				return err
			}
			hash, err := skillSetHash(skills)
			if err != nil {
				return err
			}
			if state == nil || state.State != "ready" || state.InstalledSetHash != hash {
				return integrity()
			}
		}
		version := uint64(load.VersionID)
		call.SkillVersionID = &version
		extra["skill_load"] = load
		return nil
	}
	switch call.ToolKey {
	case "exec_command", "process_status", "process_output", "process_cancel":
	default:
		return integrity()
	}
	fields, err := metadataObject(raw, "sandbox_execution")
	if err != nil {
		return err
	}
	var meta SandboxExecutionMetadata
	if err = decodeMetadata(fields["sandbox_execution"], &meta, "exit_code", "execution_id", "cloud_computer_id", "command", "cwd", "background", "state", "exit_code", "stdout", "stderr", "truncated"); err != nil {
		return err
	}
	if err = validExecutionMetadata(meta); err != nil {
		return err
	}
	repo, err := CloudStateFor(tx)
	if err != nil {
		return err
	}
	if err = verifyExecutionMetadata(repo, x.Root, call, meta); err != nil {
		return err
	}
	extra["sandbox_execution"] = meta
	return nil
}

func validExecutionMetadata(meta SandboxExecutionMetadata) error {
	if meta.ExecutionID == 0 || meta.ComputerID == 0 || len(meta.Command) == 0 || len(meta.Command) > 32<<10 || strings.ContainsRune(meta.Command, 0) || len(meta.CWD) > 4096 || !strings.HasPrefix(meta.CWD, "/data/") || strings.ContainsRune(meta.CWD, 0) || len(meta.Stdout)+len(meta.Stderr) > 64<<10 || !utf8.ValidString(meta.Command+meta.CWD+meta.Stdout+meta.Stderr) {
		return integrity()
	}
	switch meta.State {
	case "completed":
	case "running", "outcome_unknown", "cancel_requested":
		if meta.ExitCode != nil {
			return integrity()
		}
	default:
		return integrity()
	}
	return nil
}

func verifyExecutionMetadata(repo CloudRepository, root *RunRow, call *ToolCallRow, meta SandboxExecutionMetadata) error {
	binding, err := repo.Lease(root.ID, false)
	if err != nil {
		return err
	}
	execution, err := repo.CloudExecution(meta.ExecutionID, false)
	if err != nil {
		return err
	}
	if binding == nil || binding.RootRunID != root.ID || binding.ComputerID == 0 || binding.ComputerID != meta.ComputerID || execution == nil || execution.RootRunID != root.ID || execution.RootRunID != binding.RootRunID || execution.CWD != meta.CWD || execution.IsBackground != meta.Background || call.RootRunID != root.ID {
		return integrity()
	}
	if call.ToolKey == "exec_command" && (execution.ToolCallID != call.ID || execution.RunID != call.RunID) {
		return integrity()
	}
	var recorded SandboxExecutionMetadata
	if json.Unmarshal(execution.LastObservation, &recorded) != nil || recorded.ExecutionID != execution.ID || recorded.Command != meta.Command {
		return integrity()
	}
	// State/output are a point-in-time observation. Background progress may
	// already have advanced them; immutable identity alone is compared here.
	return nil
}
