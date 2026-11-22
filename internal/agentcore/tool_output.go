package agentcore

import (
	"crypto/sha256"
	"encoding/hex"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

const ToolOutputInlineBytes = 16 << 10
const ToolOutputMaxBytes = 4 << 20

// The reader permits 10 MiB of body text. Retain the source and title with it.
const FetchOutputMaxBytes = (10 << 20) + (16 << 10)

// HeadTail bounds UTF-8 bytes, keeping diagnostics at both ends. The marker is
// part of the budget. It is deterministic and never mutates the original fact.
func HeadTail(text string, budget int, marker string) string {
	if len(text) <= budget {
		return text
	}
	if budget <= len(marker) {
		return ""
	}
	available := budget - len(marker)
	head := available * 3 / 4
	tail := len(text) - (available - head)
	for head > 0 && !utf8.RuneStart(text[head]) {
		head--
	}
	for tail < len(text) && !utf8.RuneStart(text[tail]) {
		tail++
	}
	return text[:head] + marker + text[tail:]
}

type ToolOutputPrune struct {
	Seq    Seq    `json:"seq"`
	SHA256 string `json:"sha256"`
}

func ToolOutputHash(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:])
}

// Policy v1 is encoded in the event type. Do not change these budgets without
// a new version: recorded projections must replay byte-for-byte after upgrades.
func PruneToolOutput(text string) string {
	if len(text) <= 8192 {
		return text
	}
	return HeadTail(text, 5120, "\n\n[Platform notice: middle of historical tool output omitted to relieve context pressure. Consult the original result or its retained output reference.]\n\n")
}

func projectToolOutput(m modelcore.Message, seq Seq, targets []ToolOutputPrune) (modelcore.Message, error) {
	for _, target := range targets {
		if target.Seq != seq {
			continue
		}
		if m.Role != "tool" || ToolOutputHash(m.Content) != target.SHA256 || len(m.Content) <= 8192 {
			return m, reject("TOOL_OUTPUT_PROJECTION_INVALID")
		}
		m = cloneMessage(m)
		m.Content = PruneToolOutput(m.Content)
		// A changed tool body must not retain a provider-native old body.
		m.Native = nil
		return m, nil
	}
	return m, nil
}
