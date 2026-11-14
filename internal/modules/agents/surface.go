package agents

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/agentcore"
)

// Projection is rebuilt only from immutable, checksummed model facts. UI
// content never substitutes for a native assistant/provider message.
func loadSurface(st StateRepository, v *SessionRow) (agentcore.SurfaceManifest, map[agentcore.Seq]agentcore.HistoryFact, error) {
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
			seq := agentcore.Seq(row.Seq)
			fact := agentcore.HistoryFact{Seq: seq, Kind: row.EventType, SchemaVersion: 1, Message: f.Message, Context: f.Context, ToolCallID: f.ToolCallID, Ordinal: f.Ordinal, ModelCallID: f.ModelCallID, Interrupted: f.Interrupted}
			if f.Message == nil && f.Context == nil {
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
			if f.Context != nil {
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

func surfaceBytes(m agentcore.SurfaceManifest) (json.RawMessage, error) { return json.Marshal(m) }
