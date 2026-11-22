package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type ToolOutputReference struct {
	FileID agentcore.ID `json:"file_id"`
	Size   uint64       `json:"size_bytes,string"`
	SHA256 string       `json:"sha256"`
}

func toolOutputInlineLimit(key string) int {
	// These tools already bound their output or carry structured interaction /
	// instruction semantics. Do not turn plans or explicit file reads into previews.
	switch key {
	case "skill":
		return agentcore.SkillTextMaxBytes + 2048
	case "read", "edit", "write", "read_tool_output", "todo_write", "ask_question", "save_artifacts", "load_artifacts", "list_artifacts", "show_artifacts", "read_image", "subagent":
		return 64 << 10
	default:
		return agentcore.ToolOutputInlineBytes
	}
}

// Allocate before writing bytes so a crash always leaves a reclaimable row.
// The process-local lease prevents maintenance racing an active writer.
func (s *Service) stageToolOutput(ctx context.Context, ref agentcore.ExecutionRef, result agentcore.ToolResult) (*FileRow, error) {
	content := result.Observation.Content
	limit := agentcore.ToolOutputMaxBytes
	if result.Call.Spec.Key == "web_fetch" {
		limit = agentcore.FetchOutputMaxBytes
	}
	if len(content) <= toolOutputInlineLimit(result.Call.Spec.Key) || len(content) > limit || s.Files == nil || s.Epoch == "" || result.Call.Spec.Key == "read_tool_output" {
		return nil, nil
	}
	var file *FileRow
	var lease *ResourceReferenceRow
	err := s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		call, err := st.ToolCall(uint64(result.Call.ID), true)
		if err != nil {
			return err
		}
		if call == nil || call.RunID != x.Run.ID || call.ExecutorEpoch != ref.Epoch || call.FenceVersion != ref.Fence || call.DispatchToken == nil {
			return integrity()
		}
		if call.ResultEventSeq != nil {
			return nil
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		expires := now.Add(time.Hour)
		file = &FileRow{Purpose: "tool_output", ContentDomain: x.RootSession.ExecutionMode, ContentSessionID: &x.RootSession.ID, OwnerUserID: &x.RootSession.ExecutorUserID, AgentID: &x.Agent.ID, CreatedByToolCallID: &call.ID, StorageKey: NewStorageKey(), WriterToken: NewStorageKey(), State: "uploading", IntegrityState: "pending", MediaType: "text/plain; charset=utf-8", MediaProperties: json.RawMessage(`{}`), CreatedAt: now, UpdatedAt: now, ExpiresAt: &expires}
		if err = st.InsertFile(file); err != nil {
			return err
		}
		lease = &ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		return st.InsertResourceReference(lease)
	})
	if err != nil || file == nil {
		return nil, err
	}
	defer func() { _ = s.releaseFileLease(ctx, lease.ID) }()
	facts, err := s.Files.Write(ctx, file.StorageKey, strings.NewReader(content), int64(limit))
	if err != nil {
		return nil, err
	}
	err = s.background(ctx, func(_ identity.Tx, _ Repository, st StateRepository) error {
		row, err := st.File(file.ID, true)
		if err != nil {
			return err
		}
		if row == nil || row.State != "uploading" || row.WriterToken != file.WriterToken {
			return integrity()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		row.State, row.IntegrityState = "staged", "verified"
		row.SizeBytes, row.SHA256 = &facts.Size, facts.SHA256
		row.UpdatedAt, row.IntegrityCheckedAt = now, &now
		file = row
		return st.SaveFile(row)
	})
	return file, err
}

func bindToolOutput(st StateRepository, file *FileRow, call *ToolCallRow, root uint64, now time.Time) (*ToolOutputReference, error) {
	row, err := st.File(file.ID, true)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Purpose != "tool_output" || row.State != "staged" || row.IntegrityState != "verified" || row.SizeBytes == nil || len(row.SHA256) != 32 || row.ContentSessionID == nil || *row.ContentSessionID != root || row.CreatedByToolCallID == nil || *row.CreatedByToolCallID != call.ID {
		return nil, integrity()
	}
	row.State, row.ExpiresAt, row.BoundAt, row.UpdatedAt = "bound", nil, &now, now
	if err = st.SaveFile(row); err != nil {
		return nil, err
	}
	return &ToolOutputReference{FileID: agentcore.ID(row.ID), Size: *row.SizeBytes, SHA256: hexHash(row.SHA256)}, nil
}

// A guessed file id is not a capability: require the committed result binding.
func toolOutputBound(st StateRepository, file *FileRow) (bool, error) {
	if file.Purpose != "tool_output" || file.CreatedByToolCallID == nil || file.State != "bound" {
		return false, nil
	}
	call, err := st.ToolCall(*file.CreatedByToolCallID, false)
	if err != nil || call == nil || call.ResultEventSeq == nil {
		return false, err
	}
	row, err := st.EventAt(call.SessionID, *call.ResultEventSeq)
	if err != nil || row == nil {
		return false, err
	}
	facts, err := decodeEvent(*row)
	if err != nil {
		return false, err
	}
	var result struct {
		Output *ToolOutputReference `json:"output_file"`
	}
	if json.Unmarshal(facts.Public, &result) != nil {
		return false, integrity()
	}
	return result.Output != nil && uint64(result.Output.FileID) == file.ID && result.Output.SHA256 == hexHash(file.SHA256) && file.SizeBytes != nil && result.Output.Size == *file.SizeBytes, nil
}

type ToolOutputRead struct {
	FileID agentcore.ID `json:"file_id"`
	Offset int          `json:"offset"`
	Limit  int          `json:"limit"`
	Query  string       `json:"query"`
}

func parseToolOutputRead(raw json.RawMessage) (ToolOutputRead, error) {
	var input ToolOutputRead
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || input.FileID == 0 || input.Offset < 0 || input.Offset > agentcore.FetchOutputMaxBytes || input.Limit < 0 || input.Limit > 8192 || len(input.Query) > 256 || !utf8.ValidString(input.Query) {
		return input, httpx.Invalid("arguments", "invalid_value")
	}
	if input.Limit == 0 {
		input.Limit = 4096
	}
	return input, nil
}

// Read only this content session's settled outputs. The read is bounded and
// never creates another spill file. query is a literal search from byte offset.
func (s *Service) ReadToolOutput(ctx context.Context, ref agentcore.ExecutionRef, raw json.RawMessage) (string, error) {
	input, err := parseToolOutputRead(raw)
	if err != nil {
		return "", err
	}
	if s.Files == nil || s.Epoch == "" {
		return "", unavailable()
	}
	var file *FileRow
	var lease *ResourceReferenceRow
	err = s.background(ctx, func(tx identity.Tx, r Repository, st StateRepository) error {
		x, err := s.lockExecution(tx, r, st, ref, true)
		if err != nil {
			return err
		}
		file, err = st.File(uint64(input.FileID), true)
		if err != nil {
			return err
		}
		if file == nil || file.ContentSessionID == nil || *file.ContentSessionID != x.RootSession.ID || file.ContentDomain != x.RootSession.ExecutionMode {
			return missing()
		}
		bound, err := toolOutputBound(st, file)
		if err != nil {
			return err
		}
		if !bound || file.IntegrityState != "verified" || file.SizeBytes == nil || *file.SizeBytes > agentcore.FetchOutputMaxBytes {
			return missing()
		}
		now := time.Now().UTC().Truncate(time.Millisecond)
		lease = &ResourceReferenceRow{HolderKind: "download", HolderID: NewStorageKey(), ResourceKind: "file", ResourceID: file.ID, State: "active", ExecutorEpoch: s.Epoch, FenceVersion: 1, CreatedAt: now, UpdatedAt: now}
		return st.InsertResourceReference(lease)
	})
	if err != nil {
		return "", err
	}
	defer func() { _ = s.releaseFileLease(ctx, lease.ID) }()
	reader, err := s.Files.Open(file.StorageKey)
	if err != nil {
		return "", httpx.E(409, "FILE_UNAVAILABLE", "工具输出暂不可读取")
	}
	defer func() { _ = reader.Close() }()
	data, err := io.ReadAll(io.LimitReader(contextReader{ctx, reader}, agentcore.FetchOutputMaxBytes+1))
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	if uint64(len(data)) != *file.SizeBytes || !bytes.Equal(hash[:], file.SHA256) {
		return "", httpx.E(409, "FILE_INTEGRITY_FAILED", "工具输出完整性校验失败")
	}
	return toolOutputSlice(string(data), input), nil
}

func toolOutputSlice(text string, input ToolOutputRead) string {
	start := min(input.Offset, len(text))
	for start < len(text) && !utf8.RuneStart(text[start]) {
		start++
	}
	if input.Query != "" {
		match := strings.Index(text[start:], input.Query)
		if match < 0 {
			return fmt.Sprintf("No literal match from byte offset %d. Total bytes: %d.", start, len(text))
		}
		start += match
	}
	end := min(start+input.Limit, len(text))
	for end > start && end < len(text) && !utf8.RuneStart(text[end]) {
		end--
	}
	// A one-byte request still advances past a whole UTF-8 code point.
	if end == start && start < len(text) {
		_, size := utf8.DecodeRuneInString(text[start:])
		end += size
	}
	return fmt.Sprintf("Bytes %d..%d of %d; next_offset=%d; has_more=%t\n\n%s", start, end, len(text), end, end < len(text), text[start:end])
}
