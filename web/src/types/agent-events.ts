import type {
  ActorRef,
  AgentInput,
  ApprovalStatus,
  Artifact,
  ContentBlock,
  EffectiveSelection,
  InputSummary,
  Interaction,
  Principal,
  QuestionAnswer,
  QuestionStatus,
  RunStatus,
  SessionConfiguration,
  SessionPermissions,
  ToolCall,
  ViewState,
} from "./agents";
import type { JsonObject } from "./models";

export interface SandboxExecution {
  execution_id: string;
  cloud_computer_id: string;
  command: string;
  cwd: string;
  background: boolean;
  state: "running" | "completed" | "outcome_unknown" | "cancel_requested";
  exit_code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface EventPayloads {
  "session/title": {
    configuration: SessionConfiguration;
    source: "fallback" | "model" | "user";
    source_event_seq: string;
    model_call_id: string | null;
  };
  "tool/state": { tool_call_id: string; status: ToolCall["status"] };
  "session/computer_bound": { cloud_computer_id: string };
  "run/settled": {
    run_id: string;
    settled_at: string;
    physical_activity_state: string;
  };
  "session/configured": {
    configuration: SessionConfiguration;
    changed_fields: string[];
    actor_ref: ActorRef;
  };
  "queue/state": {
    queue_paused: boolean;
    reason: string;
    actor_ref: ActorRef | null;
  };
  "input/accepted": { input: AgentInput };
  "input/updated": {
    input: AgentInput;
    previous_revision: string;
    actor_ref: ActorRef;
  };
  "input/removed": {
    input_id: string;
    revision: string;
    reason: string;
    actor_ref: ActorRef | null;
  };
  "input/expired": EventPayloads["input/removed"];
  "input/cancelled": EventPayloads["input/removed"];
  "input/claimed": {
    input_id: string;
    revision: string;
    run_id: string;
    delivery: AgentInput["delivery"];
  };
  "input/message": Pick<
    AgentInput,
    | "revision"
    | "origin_kind"
    | "actor_ref"
    | "source_ref"
    | "content"
    | "file_refs"
    | "question_answer"
    | "question_context"
  > & { input_id: string };
  "run/started": {
    run_id: string;
    trigger_input_id: string | null;
    root_run_id: string;
    parent_run_id: string | null;
    principal: Principal;
    deadline_at: string;
    execution_policy: JsonObject;
  };
  "run/state": {
    run_id: string;
    previous_status: RunStatus;
    status: RunStatus;
    reason_code: string | null;
  };
  "run/ended": {
    run_id: string;
    status:
      "succeeded" | "waiting_input" | "failed" | "cancelled" | "interrupted";
    reason_code: string | null;
    finished_at: string;
    usage_completeness: string;
    physical_activity_state: string;
  };
  "assistant/message": {
    step_no?: number;
    attempt_no?: number;
    attempt_id: string;
    model_call_id: string;
    content: ContentBlock[];
    finish_reason: string;
  };
  "assistant/attempt": {
    step_no?: number;
    attempt_no?: number;
    attempt_id: string;
    model_call_id: string;
    status: string;
    content: ContentBlock[];
    partial: boolean;
    reason_code: string;
  };
  "tool/call": Pick<
    ToolCall,
    | "tool_key"
    | "mcp_server_id"
    | "mcp_binding_id"
    | "mcp_tool_name"
    | "arguments"
    | "arguments_hash"
    | "execution_class"
    | "policy"
  > & {
    tool_call_id: string;
    model_call_id?: string;
    step_no?: number;
    call_ordinal?: number;
    provider_call_id?: string;
    status?: ToolCall["status"];
  };
  "tool/result": {
    tool_call_id: string;
    status: ToolCall["status"];
    executed: boolean | null;
    content: ContentBlock[];
    truncated: boolean;
    outcome: ToolCall["outcome"];
    sandbox_execution?: SandboxExecution;
    artifacts?: Artifact[];
    commit_receipt?: {
      content_session_id: string;
      tool_result: { session_id: string; event_seq: string };
      event_seq_from: string;
      event_seq_to: string;
      artifact_ids: string[];
    };
    skill_load?: {
      skill_id: string;
      skill_version_id: string;
      content_sha256: string;
      materialized: boolean;
      stable_path: string | null;
      relative_path: string;
    };
    import_result?: {
      binding_id: string;
      path: string;
      sha256: string;
      size_bytes: string;
      availability: string;
    };
    child_result?: {
      session_id: string;
      run_id: string;
      status: RunStatus;
      reason_code: string | null;
      result_summary: string | null;
      artifact_ids: string[];
    };
  };
  "tool/reconciled": {
    tool_call_id: string;
    observed_status: string;
    executed: boolean | null;
    reason: string;
    observed_at: string;
    evidence_summary: string;
  };
  "interaction/asked": {
    interaction: Interaction;
    child_source_run_id: string | null;
  };
  "interaction/decided": {
    interaction_id: string;
    kind: Interaction["kind"];
    status: QuestionStatus | ApprovalStatus;
    actor_ref: ActorRef | null;
    answer: QuestionAnswer | null;
    decision: string | null;
    pending_reply_input_id: string | null;
    reason: string;
  };
  "compaction/start": {
    compaction_id: string;
    from_seq: string;
    through_seq: string;
    reason: string;
  };
  "compaction/summary": {
    compaction_id: string;
    content: ContentBlock[];
    replacement: { from_seq: string; through_seq: string };
  };
  "compaction/end": {
    compaction_id: string;
    status: string;
    summary_seq: string | null;
    reason_code: string | null;
  };
  "context/runtime": {
    cwd: string | null;
    cloud_computer_id: string | null;
    availability: string;
    restored_file_refs: { kind: string; id: string }[];
  };
  "context/skills": {
    entries: { name: string; description: string }[];
    reason: string;
  };
  "context/authorization": {
    agent_configuration_revision: string;
    agent_type?: "interactive" | "service";
    project_context_id?: string | null;
    scope_kind?: "project" | "team" | "platform";
    resource_scope_kind?: string;
    project_ids?: string[];
    reason: string;
  };
  "artifact/retained": { artifacts: Artifact[]; tool_call_id: string };
  "artifact/deleted": {
    artifact_id: string;
    deleted_at: string;
    actor_ref: ActorRef;
  };
}
export type EventType = keyof EventPayloads;
export type DurableRecord = {
  [K in EventType]: {
    seq: string;
    event_type: K;
    schema_version: 1;
    occurred_at: string;
    run_id: string | null;
    data: EventPayloads[K];
  };
}[EventType];
export interface HistoryPage {
  session_id: string;
  through_seq: string;
  records: DurableRecord[];
  before_seq: string | null;
  has_more: boolean;
}
export type StreamDraftBlock =
  | { type: "text" | "reasoning"; text: string; duration_ms?: number }
  | {
      type: "tool_call";
      draft_call_id: string;
      name: string | null;
      arguments_text: string;
    };
export interface ActiveAttempt {
  attempt_id: string;
  run_id: string;
  step: number;
  next_index: number;
  content: StreamDraftBlock[];
}
export interface SnapshotState {
  conversation?: ConversationSummary;
  configuration: SessionConfiguration;
  selection: EffectiveSelection;
  permissions: SessionPermissions;
  view_state: ViewState | null;
  run_id: string | null;
  run_status: RunStatus | null;
  queue_paused: boolean;
  inputs: InputSummary[];
  input_total: number;
  inputs_truncated: boolean;
  interactions: Interaction[];
  interaction_total: number;
  interactions_truncated: boolean;
}
export interface ConversationSummary {
  version: 1;
  through_seq: string;
  title: string;
  run_count: number;
  model_call_count: number;
  tool_call_count: number;
  latest_run: null | {
    id: string;
    status: RunStatus;
    step: number;
    settled: boolean;
    model_call_count: number;
    tool_call_count: number;
    plan_call_id: string;
    plan?: ContentBlock[];
  };
}
export interface SnapshotFrame {
  type: "snapshot";
  subscription_id: string;
  session_id: string;
  through_seq: string;
  state: SnapshotState;
  records: DurableRecord[];
  before_seq: string | null;
  has_more: boolean;
  stream: {
    runtime_epoch: string;
    revision: string;
    active_attempt: ActiveAttempt | null;
  };
}
export type StreamDelta =
  | {
      type: "text_delta" | "reasoning_delta";
      duration_ms?: number;
      block_index: number;
      text: string;
    }
  | {
      type: "tool_call_delta";
      block_index: number;
      draft_call_id: string;
      name?: string;
      arguments_fragment?: string;
    };
export type StreamOutcome =
  | { kind: "committed"; event_seq: string }
  | { kind: "abandoned"; reason: string };
export type StreamFrame = {
  type: "assistant_stream";
  subscription_id: string;
  session_id: string;
  runtime_epoch: string;
  revision: string;
  attempt_id: string;
  index: number;
} & (
  | { kind: "start"; run_id: string; step: number; content: [] }
  | { kind: "chunk"; delta: StreamDelta }
  | { kind: "end"; outcome: StreamOutcome }
);
export type EventFrame = DurableRecord & {
  type: "event";
  subscription_id: string;
  session_id: string;
};
export type ServerFrame =
  | SnapshotFrame
  | StreamFrame
  | EventFrame
  | { type: "pong"; nonce: string; server_time: string }
  | { type: "unsubscribed"; subscription_id: string }
  | {
      type: "error";
      subscription_id?: string;
      code: string;
      message: string;
      request_id: string;
    }
  | {
      type: "resync_required";
      subscription_id: string;
      reason:
        | "sequence_gap"
        | "stream_gap"
        | "epoch_changed"
        | "buffer_overflow"
        | "schema_unsupported";
      last_delivered_seq: string;
    }
  | { type: "access_revoked"; subscription_id: string; code: string };
export type ClientFrame =
  | {
      type: "subscribe";
      subscription_id: string;
      session_id: string;
      history_limit?: number;
    }
  | { type: "unsubscribe" | "resync"; subscription_id: string }
  | { type: "ping"; nonce: string };
