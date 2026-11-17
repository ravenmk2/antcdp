package agentcore

import (
	"encoding/json"

	"github.com/ravenmk2/antcdp/internal/modelcore"
)

type ContextBudget struct {
	Window    uint64 `json:"window_tokens,string"`
	Output    uint64 `json:"reserved_output_tokens,string"`
	Limit     uint64 `json:"input_limit_tokens,string"`
	Headroom  uint64 `json:"headroom_tokens,string"`
	Threshold uint64 `json:"compaction_threshold_tokens,string"`
	Retain    uint64 `json:"retain_tokens,string"`
}

// DSH-style pressure and retention: 80% of the window capped by output plus
// headroom, and a 16% verbatim tail. Scale the 64K headroom down for small models
// so it never consumes more than 10% of their input budget.
func ResolveContextBudget(model LockedModel) (ContextBudget, error) {
	out, err := modelcore.EffectiveOutputTokens(model.Parameters, model.MaxOutputTokens)
	b := ContextBudget{Window: model.ContextWindow, Output: out}
	if err != nil {
		return b, err
	}
	if out >= b.Window {
		return b, reject("CONTEXT_BUDGET_EXCEEDED")
	}
	b.Limit = b.Window - out
	b.Headroom = min(65536, b.Limit/10)
	b.Threshold = min(b.Window*80/100, b.Limit-b.Headroom)
	b.Retain = b.Limit * 16 / 100
	return b, nil
}

type ContextMeasurement struct {
	Tokens    uint64 `json:"projected_tokens,string"`
	Estimated uint64 `json:"estimated_tokens,string"`
	Source    string `json:"measurement_source"`
}

type ContextAnchor struct {
	Envelope  modelcore.Request
	Estimated uint64
	Input     uint64
}

// MeasureContext uses provider total-input usage only for the same request
// envelope, then accounts for additions and replacements with signed estimates.
// Cache reads/writes already belong to total input and are never added again.
func MeasureContext(counter TokenCounter, current modelcore.Request, anchor *ContextAnchor) (ContextMeasurement, error) {
	n, err := counter.Count(current)
	m := ContextMeasurement{Tokens: n, Estimated: n, Source: "estimated"}
	if err != nil || anchor == nil {
		return m, err
	}
	compatible, err := SameContextEnvelope(current, anchor.Envelope)
	if err != nil || !compatible {
		return m, err
	}
	if anchor.Input >= anchor.Estimated {
		m.Tokens += anchor.Input - anchor.Estimated
		m.Source = "usage_adjusted"
	}
	return m, nil
}

// SameContextEnvelope excludes conversation contents, but retains the model,
// system prompt, tool definitions and generation settings.
func SameContextEnvelope(a, b modelcore.Request) (bool, error) {
	a.Messages, b.Messages = systemMessages(a.Messages), systemMessages(b.Messages)
	left, err := ContentHash(a)
	if err != nil {
		return false, err
	}
	right, err := ContentHash(b)
	return left == right, err
}

// SurfaceForMeasurement accepts an unfinished tool group only for pricing.
// Model requests still use BuildSurface's strict complete-pair validation.
func SurfaceForMeasurement(manifest SurfaceManifest, facts map[Seq]HistoryFact) ([]modelcore.Message, error) {
	var messages []modelcore.Message
	for _, entry := range manifest.Entries {
		part := manifest
		part.Entries = []SurfaceEntry{entry}
		if entry.Kind != "tool_group" {
			items, err := BuildSurface(part, facts)
			if err != nil {
				return nil, err
			}
			messages = append(messages, items...)
			continue
		}
		for _, seq := range entry.Sequences {
			f, ok := facts[seq]
			if !ok || f.Message == nil {
				return nil, reject("SURFACE_INVALID")
			}
			message, err := projectToolOutput(*f.Message, seq, manifest.ToolOutputPrunes)
			if err != nil {
				return nil, err
			}
			message, err = ProjectImages(message, seq, manifest.ImageOffloads)
			if err != nil {
				return nil, err
			}
			messages = append(messages, message)
		}
	}
	return messages, nil
}

// CompactionTokenRange retains a token-priced tail, latest user instruction,
// and complete tool groups. A long single task can compact its earlier steps
// after the protected instruction instead of making the whole task immutable.
func CompactionTokenRange(manifest SurfaceManifest, facts map[Seq]HistoryFact, retain uint64, counter TokenCounter) (int, int, error) {
	prices := make([]uint64, len(manifest.Entries))
	latestInput := -1
	for i, entry := range manifest.Entries {
		part := manifest
		part.Entries = []SurfaceEntry{entry}
		messages, err := BuildSurface(part, facts)
		if err != nil {
			return 0, 0, err
		}
		prices[i], err = counter.Count(modelcore.Request{Messages: messages})
		if err != nil {
			return 0, 0, err
		}
		for _, seq := range entry.Sequences {
			if facts[seq].Kind == "input/message" {
				latestInput = i
			}
		}
	}
	keep := len(prices)
	var tail uint64
	for keep > 0 {
		keep--
		tail += prices[keep]
		if tail >= retain {
			break
		}
	}
	first, last := 0, keep-1
	if latestInput >= 0 && latestInput <= last {
		var before, after uint64
		for i := 0; i < latestInput; i++ {
			before += prices[i]
		}
		for i := latestInput + 1; i <= last; i++ {
			after += prices[i]
		}
		if after > before {
			first = latestInput + 1
		} else {
			last = latestInput - 1
		}
	}
	if last < first {
		return 0, 0, reject("COMPACTION_NOT_NEEDED")
	}
	return first, last, nil
}

func systemMessages(messages []modelcore.Message) []modelcore.Message {
	var system []modelcore.Message
	for _, message := range messages {
		if message.Role == "system" {
			system = append(system, message)
		}
	}
	return system
}

func withOutputCap(parameters map[string]json.RawMessage, output uint64) map[string]json.RawMessage {
	result := make(map[string]json.RawMessage, len(parameters)+1)
	for key, value := range parameters {
		result[key] = append(json.RawMessage(nil), value...)
	}
	if output > 0 {
		result["max_output_tokens"], _ = json.Marshal(output)
	}
	return result
}
