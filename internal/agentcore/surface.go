package agentcore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ContextFact struct {
	Kind    string          `json:"kind"`
	Content json.RawMessage `json:"content"`
}
type SurfaceEntry struct {
	Kind      string `json:"kind"`
	Sequences []Seq  `json:"sequences"`
}
type SurfaceManifest struct {
	SchemaVersion int            `json:"schema_version"`
	Revision      Version        `json:"revision"`
	Entries       []SurfaceEntry `json:"entries"`
}
type HistoryFact struct {
	Seq           Seq
	Kind          string
	SchemaVersion int
	Message       *modelcore.Message
	Context       *ContextFact
	ToolCallID    string
	Ordinal       uint32
	ModelCallID   ID
	Interrupted   bool
}

func CanonicalJSON(value any) ([]byte, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if err = d.Decode(&v); err != nil {
		return nil, err
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return nil, reject("JSON_INVALID")
	}
	return json.Marshal(v)
}
func ContentHash(value any) (string, error) {
	b, err := CanonicalJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// BuildSurface is a pure replay over explicitly selected immutable facts.
// Tool results follow declaration ordinal, never database completion order.
func BuildSurface(manifest SurfaceManifest, facts map[Seq]HistoryFact) ([]modelcore.Message, error) {
	if manifest.SchemaVersion != 1 {
		return nil, reject("SURFACE_VERSION_UNSUPPORTED")
	}
	messages := []modelcore.Message{}
	selected := map[Seq]bool{}
	for _, entry := range manifest.Entries {
		if len(entry.Sequences) == 0 {
			return nil, reject("SURFACE_INVALID")
		}
		group := make([]HistoryFact, 0, len(entry.Sequences))
		for _, seq := range entry.Sequences {
			f, ok := facts[seq]
			if !ok || seq == 0 || selected[seq] || f.Seq != seq || f.SchemaVersion != 1 {
				return nil, reject("SURFACE_INVALID")
			}
			selected[seq] = true
			group = append(group, f)
		}
		switch entry.Kind {
		case "message", "summary":
			if len(group) != 1 || group[0].Message == nil || group[0].Kind != "input/message" && group[0].Kind != "assistant/message" && group[0].Kind != "compaction/summary" && (group[0].Kind != "assistant/attempt" || !group[0].Interrupted) || len(group[0].Message.ToolCalls) != 0 {
				return nil, reject("SURFACE_INVALID")
			}
			f := group[0]
			message := cloneMessage(*f.Message)
			if f.Kind == "input/message" && message.Role != "user" || f.Kind == "compaction/summary" && message.Role != "user" || (f.Kind == "assistant/message" || f.Kind == "assistant/attempt") && message.Role != "assistant" {
				return nil, reject("SURFACE_INVALID")
			}
			if f.Kind == "assistant/attempt" {
				// Only explicitly interrupted text participates. Partial native
				// blocks/signatures and unfinished calls are never replayed as a
				// complete successful provider message.
				message = modelcore.Message{Role: "assistant", Content: "[Interrupted partial answer]\n" + message.Content}
			}
			messages = append(messages, message)
		case "context":
			if len(group) != 1 || group[0].Context == nil {
				return nil, reject("SURFACE_INVALID")
			}
			c := group[0].Context
			if c.Kind != "context/runtime" && c.Kind != "context/skills" && c.Kind != "context/authorization" {
				return nil, reject("SURFACE_VERSION_UNSUPPORTED")
			}
			b, err := CanonicalJSON(c.Content)
			if err != nil {
				return nil, err
			}
			messages = append(messages, modelcore.Message{Role: "user", Content: "[Platform context: " + strings.TrimPrefix(c.Kind, "context/") + "]\n" + string(b)})
		case "tool_group":
			m, err := projectToolGroup(group)
			if err != nil {
				return nil, err
			}
			messages = append(messages, m...)
		default:
			return nil, reject("SURFACE_VERSION_UNSUPPORTED")
		}
	}
	return messages, nil
}
func projectToolGroup(group []HistoryFact) ([]modelcore.Message, error) {
	first := group[0]
	if first.Kind != "assistant/message" || first.Message == nil || len(first.Message.ToolCalls) == 0 || len(group) != 1+len(first.Message.ToolCalls) {
		return nil, reject("TOOL_GROUP_INCOMPLETE")
	}
	results := map[uint32]HistoryFact{}
	for _, f := range group[1:] {
		if f.Kind != "tool/result" || f.Message == nil || f.ModelCallID != first.ModelCallID {
			return nil, reject("TOOL_GROUP_INCOMPLETE")
		}
		if _, ok := results[f.Ordinal]; ok {
			return nil, reject("TOOL_GROUP_INCOMPLETE")
		}
		results[f.Ordinal] = f
	}
	out := []modelcore.Message{cloneMessage(*first.Message)}
	seen := map[string]bool{}
	for n, call := range first.Message.ToolCalls {
		f, ok := results[uint32(n)]
		if !ok || call.ID == "" || seen[call.ID] || f.ToolCallID != call.ID || f.Message.Role != "tool" || f.Message.ToolCallID != call.ID {
			return nil, reject("TOOL_GROUP_INCOMPLETE")
		}
		seen[call.ID] = true
		out = append(out, cloneMessage(*f.Message))
	}
	return out, nil
}
func cloneMessage(m modelcore.Message) modelcore.Message {
	m.Native = append(json.RawMessage(nil), m.Native...)
	m.ToolCalls = append([]modelcore.ToolCall(nil), m.ToolCalls...)
	m.Images = append([]modelcore.ImagePart(nil), m.Images...)
	return m
}

// ChangedContext compares against currently VISIBLE facts, not all historical
// occurrences. A compaction that hides a directory makes it necessary again.
func ChangedContext(visible []ContextFact, next ContextFact) (bool, error) {
	want, err := ContentHash(next)
	if err != nil {
		return false, err
	}
	for n := len(visible) - 1; n >= 0; n-- {
		if visible[n].Kind == next.Kind {
			old, e := ContentHash(visible[n])
			return old != want, e
		}
	}
	return true, nil
}
func SkillContext(directory SkillDirectory, enabled bool) (ContextFact, error) {
	if !directory.Complete {
		return ContextFact{}, reject("SKILL_DIRECTORY_UNAVAILABLE")
	}
	entries := append([]SkillEntry{}, directory.Entries...)
	if !enabled {
		entries = []SkillEntry{}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	for n, e := range entries {
		if e.Name == "" || e.Description == "" || e.Integrity != "verified" || n > 0 && entries[n-1].Name == e.Name {
			return ContextFact{}, reject("SKILL_DIRECTORY_INVALID")
		}
	}
	b, err := CanonicalJSON(struct {
		Entries []SkillEntry `json:"entries"`
	}{entries})
	return ContextFact{Kind: "context/skills", Content: b}, err
}

type Replacement struct {
	SourceRevision            Version
	First, Last               int
	SourceHash                string
	SummarySeq                Seq
	Summary                   string
	BeforeTokens, AfterTokens uint64
}

func ApplyReplacement(manifest SurfaceManifest, r Replacement) (SurfaceManifest, error) {
	if manifest.SchemaVersion != 1 || manifest.Revision != r.SourceRevision || r.First < 0 || r.Last < r.First || r.Last >= len(manifest.Entries) || r.SummarySeq == 0 || strings.TrimSpace(r.Summary) == "" || r.BeforeTokens == 0 || r.AfterTokens >= r.BeforeTokens {
		return manifest, reject("COMPACTION_SOURCE_CHANGED")
	}
	h, err := ContentHash(manifest)
	if err != nil {
		return manifest, err
	}
	if h != r.SourceHash {
		return manifest, reject("COMPACTION_SOURCE_CHANGED")
	}
	for _, e := range manifest.Entries {
		for _, seq := range e.Sequences {
			if seq == r.SummarySeq {
				return manifest, reject("COMPACTION_SOURCE_CHANGED")
			}
		}
	}
	items := append([]SurfaceEntry{}, manifest.Entries[:r.First]...)
	items = append(items, SurfaceEntry{Kind: "summary", Sequences: []Seq{r.SummarySeq}})
	items = append(items, manifest.Entries[r.Last+1:]...)
	manifest.Entries = items
	manifest.Revision++
	return manifest, nil
}

type CompactionRequest struct {
	SessionID   ID
	Ref         *ExecutionRef
	Source      SurfaceManifest
	First, Last int
	Deadline    time.Time
}
type CompactionRecord struct {
	ID                ID
	Request           CompactionRequest
	PublicOperationID *ID
}
type CompactionResult struct {
	Record      CompactionRecord
	Replacement Replacement
	Usage       modelcore.Usage
}
type CompactionFailure struct {
	Record CompactionRecord
	Reason string
}
type CompactionStore interface {
	Begin(context.Context, CompactionRequest) (CompactionRecord, error)
	CommitReplacement(context.Context, CompactionResult) (CommitReceipt, error)
	Fail(context.Context, CompactionFailure) (CommitReceipt, error)
}
