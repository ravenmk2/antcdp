package agents

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// Projection is rebuilt only from immutable, checksummed model facts. UI
// content never substitutes for a native assistant/provider message.
func loadSurface(st StateRepository, v *SessionRow) (agentcore.SurfaceManifest, map[agentcore.Seq]agentcore.HistoryFact, error) {
	m, facts, err := loadSurfaceHistory(st, v)
	if err != nil {
		return m, nil, err
	}
	needed := map[agentcore.Seq]agentcore.HistoryFact{}
	for _, entry := range m.Entries {
		for _, seq := range entry.Sequences {
			f, ok := facts[seq]
			if !ok {
				return m, nil, integrity()
			}
			needed[seq] = f
		}
	}
	return m, needed, nil
}

func loadSurfaceHistory(st StateRepository, v *SessionRow) (agentcore.SurfaceManifest, map[agentcore.Seq]agentcore.HistoryFact, error) {
	m := agentcore.SurfaceManifest{SchemaVersion: 1, Revision: agentcore.Version(v.SurfaceRevision), Entries: []agentcore.SurfaceEntry{}}
	facts := map[agentcore.Seq]agentcore.HistoryFact{}
	groups := map[agentcore.ID]int{}
	after := uint64(0)
	for {
		rows, e := st.SurfaceEvents(v.ID, after, v.LastSeq, 500)
		if e != nil {
			return m, nil, e
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			after = row.Seq
			f, e := decodeEvent(row)
			if e != nil {
				return m, nil, e
			}
			if f.ExcludeFromContext {
				continue
			}
			seq := agentcore.Seq(row.Seq)
			m.ImageOffloads = append(m.ImageOffloads, f.ImageOffloads...)
			m.ToolOutputPrunes = append(m.ToolOutputPrunes, f.ToolOutputPrunes...)
			fact := agentcore.HistoryFact{WorkspaceFiles: f.WorkspaceFiles, Seq: seq, Kind: row.EventType, SchemaVersion: 1, Message: f.Message, ToolCallID: f.ToolCallID, Ordinal: f.Ordinal, ModelCallID: f.ModelCallID, Interrupted: f.Interrupted, PartialReason: f.PartialReason}
			if row.EventType == "context/message" {
				var msg agentcore.ContextMessage
				if json.Unmarshal(f.Public, &msg) != nil || msg.Source.Kind == "" || len(msg.Content) != 1 || msg.Content[0].Type != "text" || msg.Content[0].Text == "" {
					return m, nil, integrity()
				}
				fact.Context = &msg.Source
				fact.ContextText = msg.Content[0].Text
			}
			if f.Message == nil && fact.Context == nil {
				continue
			}
			facts[seq] = fact
			if f.Surface != nil {
				m = *f.Surface
				m.Revision = agentcore.Version(v.SurfaceRevision)
				groups = map[agentcore.ID]int{}
				continue
			}
			kind := "message"
			if fact.Context != nil {
				kind = "context"
			} else if row.EventType == "assistant/attempt" && !f.Interrupted {
				delete(facts, seq)
				continue
			} else if row.EventType == "tool/result" {
				i, ok := groups[f.ModelCallID]
				if !ok {
					return m, nil, integrity()
				}
				m.Entries[i].Sequences = append(m.Entries[i].Sequences, seq)
				continue
			} else if f.Message != nil && len(f.Message.ToolCalls) > 0 {
				kind = "tool_group"
				groups[f.ModelCallID] = len(m.Entries)
			}
			m.Entries = append(m.Entries, agentcore.SurfaceEntry{Kind: kind, Sequences: []agentcore.Seq{seq}})
		}
	}
	return m, facts, nil
}

func surfaceBytes(m agentcore.SurfaceManifest) (json.RawMessage, error) { return json.Marshal(m) }
