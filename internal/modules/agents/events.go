package agents

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modelcore"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// StoredEvent separates public projection from request-compatible native facts.
// Neither HTTP nor WS serializes this envelope directly.
type StoredEvent struct {
	Public      json.RawMessage            `json:"public"`
	Message     *modelcore.Message         `json:"model,omitempty"`
	Context     *agentcore.ContextFact     `json:"context,omitempty"`
	ModelCallID agentcore.ID               `json:"model_call_id,omitempty"`
	ToolCallID  string                     `json:"provider_call_id,omitempty"`
	Ordinal     uint32                     `json:"ordinal,omitempty"`
	Interrupted bool                       `json:"interrupted,omitempty"`
	Surface     *agentcore.SurfaceManifest `json:"surface,omitempty"`
}

func appendEvent(st StateRepository, session *SessionRow, runID *uint64, kind, key string, public any, facts *StoredEvent, now time.Time) (uint64, error) {
	data, e := json.Marshal(public)
	if e != nil {
		return 0, e
	}
	stored := StoredEvent{Public: data}
	if facts != nil {
		stored = *facts
		stored.Public = data
	}
	payload, e := agentcore.CanonicalJSON(stored)
	if e != nil {
		return 0, e
	}
	if len(payload) > agentcore.MaxEventBytes {
		return 0, httpx.E(422, "OUTPUT_LIMIT_EXCEEDED", "事件内容超过上限")
	}
	seq := session.LastSeq + 1
	if seq == 0 {
		return 0, integrity()
	}
	row := &EventRow{SessionID: session.ID, Seq: seq, RunID: runID, EventType: kind, SchemaVersion: 1, Payload: payload, PayloadSizeBytes: uint64(len(payload)), OccurredAt: now}
	if key != "" {
		row.SemanticKey = &key
	}
	hash := sha256.Sum256(payload)
	row.PayloadSHA256 = hash[:]
	if e = st.InsertEvent(row); e != nil {
		return 0, e
	}
	if e = checkpointConversation(st, *row); e != nil {
		return 0, e
	}
	session.LastSeq = seq
	session.ProjectionSeq = seq
	session.LastActivityAt = now
	if stored.Message != nil || stored.Context != nil {
		session.SurfaceRevision++
	}
	return seq, nil
}
func eventReceipt(id, from, through uint64) agentcore.CommitReceipt {
	return agentcore.CommitReceipt{Ranges: []agentcore.EventRange{{SessionID: agentcore.ID(id), From: agentcore.Seq(from), Through: agentcore.Seq(through)}}}
}
func decodeEvent(v EventRow) (StoredEvent, error) {
	var out StoredEvent
	canonical, e := agentcore.CanonicalJSON(v.Payload)
	if e != nil || v.SchemaVersion != 1 || uint64(len(canonical)) != v.PayloadSizeBytes {
		return out, integrity()
	}
	hash := sha256.Sum256(canonical)
	if string(hash[:]) != string(v.PayloadSHA256) || json.Unmarshal(v.Payload, &out) != nil || len(out.Public) == 0 {
		return out, integrity()
	}
	return out, nil
}
func projectEvent(v EventRow) (DurableRecord, error) {
	facts, e := decodeEvent(v)
	if e != nil {
		return DurableRecord{}, e
	}
	if v.EventType == "input/accepted" || v.EventType == "input/updated" || v.EventType == "input/message" {
		var public map[string]json.RawMessage
		if json.Unmarshal(facts.Public, &public) != nil {
			return DurableRecord{}, integrity()
		}
		fields := public
		if v.EventType != "input/message" {
			fields = map[string]json.RawMessage{}
			if json.Unmarshal(public["input"], &fields) != nil {
				return DurableRecord{}, integrity()
			}
		}
		for _, key := range []string{"content", "file_refs"} {
			if len(fields[key]) == 0 || string(fields[key]) == "null" {
				fields[key] = json.RawMessage(`[]`)
			}
		}
		if v.EventType != "input/message" {
			public["input"], e = json.Marshal(fields)
			if e != nil {
				return DurableRecord{}, e
			}
		}
		facts.Public, e = json.Marshal(public)
		if e != nil {
			return DurableRecord{}, e
		}
	}
	return DurableRecord{Seq: agentcore.Seq(v.Seq), Type: v.EventType, SchemaVersion: 1, OccurredAt: v.OccurredAt, RunID: v.RunID, Data: facts.Public}, nil
}
func coreError(err error) error {
	var v *agentcore.Error
	if !errors.As(err, &v) {
		return err
	}
	if v.Code == "VALIDATION_FAILED" {
		return httpx.Invalid(v.Field, "invalid_value")
	}
	status := 409
	code := v.Code
	if code == "PRECONDITION_FAILED" {
		status = 412
		code = "VERSION_CONFLICT"
	}
	switch code {
	case "NOT_FOUND":
		status = 404
	case "APPROVAL_NOT_ALLOWED":
		status = 403
	case "VIEW_POSITION_INVALID", "MODEL_CAPABILITY_UNSUPPORTED", "SERVICE_APPROVAL_UNSUPPORTED", "TOOL_POLICY_UNSUPPORTED":
		status = 422
	}
	return httpx.E(status, code, fmt.Sprintf("智能体操作未完成（%s）", code))
}
func coreSession(v *SessionRow) (agentcore.Session, error) {
	out := agentcore.Session{ID: agentcore.ID(v.ID), AgentID: agentcore.ID(v.AgentID), Principal: agentcore.PrincipalRef{Kind: "user", ID: agentcore.ID(v.ExecutorUserID)}, ExecutionMode: v.ExecutionMode, Title: v.Title, ModelLockedAt: v.ModelLockedAt, ArchivedAt: v.ArchivedAt, QueuePaused: v.QueuePaused, NextInputOrder: v.NextInputOrder, LastSeq: agentcore.Seq(v.LastSeq), SurfaceRevision: agentcore.Version(v.SurfaceRevision), Version: agentcore.Version(v.RowVersion)}
	if v.RootSessionID != nil {
		id := agentcore.ID(*v.RootSessionID)
		out.RootSessionID = &id
	}
	if v.ActiveRunID != nil {
		id := agentcore.ID(*v.ActiveRunID)
		out.ActiveRunID = &id
	}
	if v.ActiveCompactionID != nil {
		id := agentcore.ID(*v.ActiveCompactionID)
		out.ActiveCompactionID = &id
	}
	if v.ProjectContextID != nil {
		id := agentcore.ID(*v.ProjectContextID)
		out.ProjectID = &id
	}
	if v.ModelLockedAt != nil {
		var frozen frozenModel
		if json.Unmarshal(v.LockedModelConfig, &frozen) != nil || frozen.SelectionHash == "" {
			return out, integrity()
		}
		out.Model = &frozen.LockedModel
	}
	return out, nil
}
func corePolicy(v *Definition) agentcore.Policy {
	p := v.RuntimePolicy
	approval := "ask"
	if v.Mode == "service" {
		approval = "preauthorized_only"
	}
	return agentcore.Policy{MaxSteps: uint32(p.MaxSteps), MaxModelCalls: uint64(p.MaxModelCalls), MaxToolCalls: uint64(p.MaxToolCalls), MaxChildren: uint64(p.MaxChildren), MaxParallelTools: p.MaxParallelTools, RunTimeoutSeconds: p.RunTimeout, QueueTimeoutSeconds: p.QueueTimeout, QuestionTimeoutSeconds: p.QuestionTimeout, ApprovalTimeoutSeconds: p.ApprovalTimeout, MaxInputTokens: p.MaxInputTokens, MaxOutputTokens: p.MaxOutputTokens, ApprovalPolicy: approval}
}

type policySnapshot struct {
	agentcore.Policy
}
