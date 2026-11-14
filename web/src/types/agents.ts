import type { JsonObject, ModelProtocol } from "./models";

export type AgentType = "interactive" | "service";
export type AgentScope = "platform" | "team" | "project";
export type ActorRef =
  { kind: "user"; id: string } | { kind: "system"; id: null };
export interface Principal {
  kind: "user";
  id: string;
}
export interface Availability {
  available: boolean;
  reason: string | null;
}
export interface Versioned {
  version: string;
}
export interface Timestamped {
  created_at: string;
  updated_at: string;
}
export interface RuntimePolicy {
  max_steps: number;
  max_model_calls: number;
  max_tool_calls: number;
  max_children: number;
  max_parallel_tools: number;
  run_timeout_seconds: number;
  queue_timeout_seconds: number;
  question_timeout_seconds: number;
  approval_timeout_seconds: number;
  max_input_tokens: number;
  max_output_tokens: number;
}
export interface SandboxNetworkPolicy {
  default_action: "allow" | "deny";
  preset_ids: string[];
  allow_targets: string[];
  deny_targets: string[];
}
export interface AgentDefinition extends Versioned, Timestamped {
  id: string;
  code: string;
  name: string;
  description: string;
  agent_type: AgentType;
  scope_kind: AgentScope;
  scope_id: string | null;
  robot_user_id: string | null;
  pool_capacity: number | null;
  enabled: boolean;
  system_prompt: string;
  default_model_binding_id: string | null;
  runtime_policy: RuntimePolicy;
  deleted_at: string | null;
}
export interface AgentSummary extends Omit<
  AgentDefinition,
  "system_prompt" | "runtime_policy" | "deleted_at"
> {
  model_binding_count: number;
  tool_binding_count: number;
  mcp_binding_count: number;
}
export interface AgentCreate {
  name: string;
  agent_type: AgentType;
  scope_kind: AgentScope;
  scope_id?: string | null;
  pool_capacity?: number;
  description?: string;
  enabled?: boolean;
  system_prompt?: string;
  runtime_policy?: RuntimePolicy;
}
export type AgentPatch = Partial<
  Pick<
    AgentDefinition,
    | "name"
    | "description"
    | "enabled"
    | "system_prompt"
    | "runtime_policy"
    | "pool_capacity"
  >
>;
export interface SkillBindingWrite {
  skill_id: string;
  skill_version_id: string;
  enabled: boolean;
}
export interface SkillBinding extends SkillBindingWrite {
  id: string;
}
export interface ModelBindingWrite {
  model_definition_id: string;
  thinking_options: string[];
  default_thinking: string;
  generation_overrides: JsonObject;
}
export interface ModelBinding extends ModelBindingWrite {
  id: string;
}
export interface ModelBindings extends Versioned {
  items: ModelBinding[];
  default_model_binding_id: string;
}
export interface ModelBindingsWrite {
  items: ModelBindingWrite[];
  default_model_id: string;
  default_thinking_option_key: string;
}
export type ToolPolicy = "allow" | "confirm" | "deny";
export interface ToolBindingWrite {
  tool_key: string;
  policy: ToolPolicy;
  parameter_constraints: JsonObject;
}
export interface ToolBinding extends ToolBindingWrite {
  id: string;
}
export interface BindingCollection<T> extends Versioned {
  items: T[];
}
export interface ToolCatalogEntry {
  tool_key: string;
  name: string;
  description: string;
  source: { kind: "builtin" };
  execution_class:
    "read_only" | "idempotent" | "side_effect" | "question" | "child";
  supported_policies: ToolPolicy[];
  requires_sandbox: boolean;
  parameter_constraints_schema: JsonObject;
  input_schema_fingerprint: string;
  availability: Availability;
}
export interface ModelOption {
  binding_id: string;
  model_id: string;
  display_name: string;
  provider_label: string;
  protocol: ModelProtocol;
  thinking_options: {
    key: string;
    label: string;
    model_selection_hash?: string;
  }[];
}
export interface AgentProjectOption {
  id: string;
  name: string;
}
export interface CatalogAgent {
  scope_kind: AgentScope;
  available_projects?: AgentProjectOption[];
  id: string;
  name: string;
  description: string;
  model_options: ModelOption[];
  default_model_binding_id: string;
  default_thinking_option_key: string;
  sandbox_required: boolean;
  availability: Availability;
}
export interface StartOptions extends Pick<
  CatalogAgent,
  "model_options" | "default_model_binding_id" | "default_thinking_option_key"
> {
  agent_id: string;
  scope_kind: AgentScope;
  available_projects: AgentProjectOption[];
}
export interface CapabilityCatalog {
  limits: Record<
    | "json_bytes"
    | "agent_json_bytes"
    | "system_prompt_bytes"
    | "input_text_blocks"
    | "input_text_bytes"
    | "input_file_refs"
    | "attachment_file_bytes"
    | "attachment_multipart_bytes"
    | "skill_zip_bytes"
    | "skill_multipart_bytes"
    | "skill_expanded_bytes"
    | "skill_file_bytes"
    | "skill_file_count"
    | "skill_compression_ratio"
    | "skill_parse_timeout_seconds"
    | "present_file_count"
    | "present_file_bytes"
    | "present_total_bytes"
    | "model_bindings"
    | "tool_bindings"
    | "skill_bindings"
    | "mcp_bindings"
    | "event_payload_bytes"
    | "history_bytes"
    | "ws_frame_bytes"
    | "ws_client_frame_bytes"
    | "ws_connections_per_user"
    | "ws_subscriptions_per_connection",
    number
  >;
  attachments: {
    image_media_types: string[];
    image_max_width: number;
    image_max_height: number;
    image_max_pixels: number;
    other_files: boolean;
  };
  features: Record<
    "chat" | "temporary_child" | "skills" | "mcp_http" | "sandbox",
    boolean
  >;
}
export interface ModelSelection {
  model_binding_id: string;
  thinking_option_key: string;
}
export interface EffectiveSelection extends ModelSelection {
  model_definition_id: string;
  provider_label: string;
  model_name: string;
  model_id: string;
  protocol: ModelProtocol;
  thinking_label: string;
  effective_parameters: JsonObject;
  model_selection_hash: string;
  locked: boolean;
  availability: Availability;
}
export interface SessionCreate {
  agent_id: string;
  title?: string;
  project_context_id?: string | null;
  model_selection?: ModelSelection;
}
export interface SessionConfiguration extends Versioned, Timestamped {
  id: string;
  agent_id: string;
  agent_type: AgentType;
  title: string;
  project_context_id: string | null;
  model_selection: ModelSelection;
  model_locked_at: string | null;
  archived_at: string | null;
}
export type SessionConfigurationPatch = Partial<
  Pick<SessionConfiguration, "title" | "project_context_id" | "model_selection">
>;
export type TerminalRunStatus =
  "succeeded" | "waiting_input" | "failed" | "cancelled" | "interrupted";
export type RunStatus =
  "preparing" | "running" | "stopping" | TerminalRunStatus;
export interface RunResultRef {
  run_id: string;
  status: TerminalRunStatus;
  reason_code: string | null;
  finished_at: string;
  end_seq: string;
}
export interface SessionAttention {
  question_interaction_count: number;
  approval_interaction_count: number;
  unviewed_run_count: number;
  latest_result: RunResultRef | null;
}
export interface ViewState {
  session_id: string;
  viewed_through_seq: string;
  viewed_at: string | null;
  latest_result: RunResultRef | null;
  unviewed_run_count: number;
  has_unviewed_result: boolean;
}
export interface SessionPreference extends Versioned {
  pinned: boolean;
}
export interface SessionPermissions {
  read: boolean;
  submit: boolean;
  answer: boolean;
  control: boolean;
  manage: boolean;
  approve: boolean;
}
export interface SessionState {
  last_seq: string;
  active_run_id: string | null;
  active_run_status: RunStatus | null;
  queue_paused: boolean;
  pending_input_count: number;
  pending_interaction_count: number;
  last_activity_at: string;
  scope_kind: AgentScope;
  agent_access_available: boolean;
  project_context_available: boolean;
  workspace: {
    binding_id: string | null;
    cloud_computer_id: string | null;
    cwd: string | null;
    availability: "not_allocated" | "available" | "recreated" | "unavailable";
  };
}
export interface SessionDetail {
  configuration: SessionConfiguration;
  principal: Principal;
  root_session_id: string | null;
  selection: EffectiveSelection;
  state: SessionState;
  permissions: SessionPermissions;
  preference: SessionPreference;
  view_state: ViewState | null;
}
export interface SessionSummary {
  id: string;
  agent_id: string;
  agent_type: AgentType;
  title: string;
  archived_at: string | null;
  pinned: boolean;
  last_activity_at: string;
  active_run_status: RunStatus | null;
  attention: SessionAttention;
}
export interface FileRef {
  kind: "attachment" | "artifact";
  id: string;
}
export type ContentBlock =
  | { type: "text" | "reasoning"; text: string; duration_ms?: number }
  | ({ type: "file_reference" } & FileRef)
  | { type: "tool_reference"; tool_call_id: string };
export interface InputCreate {
  content: { type: "text"; text: string }[];
  expected_model_selection_hash?: string;
  file_refs?: FileRef[];
}
export interface InputAccepted {
  input_id: string;
  run_id: string | null;
  delivery: "next_turn";
  queue_paused: boolean;
  accepted_seq: string;
}
export interface QuestionAnswer {
  skip: boolean;
  answers: { question_id: string; option_ids: string[]; text: string | null }[];
}
export type InputSource =
  | { kind: "interaction"; id: string }
  | { kind: "run"; id: string; boundary_seq: string }
  | null;
export interface AgentInput extends Versioned, Timestamped {
  id: string;
  session_id: string;
  kind: "message" | "question_reply" | "approval_reply" | "continue";
  approval_reply?: {
    interaction_id: string;
    decision: "approve_once" | "reject";
  };
  content: { type: "text"; text: string }[];
  file_refs: FileRef[];
  question_context?: { tool_call_id: string; questions: Question[] } | null;
  question_answer: QuestionAnswer | null;
  origin_kind: "human" | "trigger" | "system";
  actor_ref: ActorRef;
  source_ref: InputSource;
  delivery: "next_turn" | "next_step";
  state: "pending" | "claimed" | "removed" | "expired" | "cancelled";
  position: string;
  queue_deadline_at: string;
  claimed_run_id: string | null;
  accepted_seq: string;
  revision: string;
  last_modified_by: ActorRef | null;
}
export type InputEdit =
  | { content?: { type: "text"; text: string }[]; file_refs?: FileRef[] }
  | {
      question_context?: { tool_call_id: string; questions: Question[] } | null;
      question_answer: QuestionAnswer;
    };
export interface InputSummary extends Versioned {
  id: string;
  kind: AgentInput["kind"];
  delivery: AgentInput["delivery"];
  preview: string;
  actor_ref: ActorRef;
  queue_deadline_at: string;
}
export interface Question {
  question_id: string;
  prompt: string;
  type: "single_choice" | "multi_choice" | "text";
  options: {
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }[];
  allow_text: boolean;
}
export type QuestionStatus =
  "waiting" | "continued" | "reply_queued" | "answered" | "cancelled";
export type ApprovalStatus =
  | "pending"
  | "approved_once"
  | "rejected"
  | "expired"
  | "cancelled"
  | "unavailable";
interface InteractionBase extends Versioned, Timestamped {
  id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string;
  expires_at: string;
  answered_by: ActorRef | null;
}
export interface QuestionInteraction extends InteractionBase {
  kind: "question";
  status: QuestionStatus;
  questions: Question[];
  pending_reply_input_id: string | null;
  answer: QuestionAnswer | null;
}
export interface ApprovalInteraction extends InteractionBase {
  kind: "approval";
  status: ApprovalStatus;
  action: {
    tool_key: string;
    summary: string;
    arguments: JsonObject;
    arguments_hash: string;
  };
  decision: "approve_once" | "reject" | null;
}
export type Interaction = QuestionInteraction | ApprovalInteraction;
export interface AnswerReceipt {
  interaction_id: string;
  status: QuestionStatus;
  delivery: "tool_result" | "next_turn" | "next_step";
  input_id: string | null;
  run_id: string | null;
  queue_paused: boolean;
  accepted_seq: string;
}
export interface DecisionReceipt {
  interaction_id: string;
  status: ApprovalStatus;
  tool_call_id: string;
  executed: false;
  accepted_seq: string;
}
export interface RunSummary {
  id: string;
  session_id: string;
  root_run_id: string;
  parent_run_id: string | null;
  trigger_input_id: string | null;
  status: RunStatus;
  reason_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  settled_at: string | null;
  deadline_at: string;
  step_count: number;
  model_call_count: number;
  tool_call_count: number;
  usage_completeness: "complete" | "partial" | "unknown";
}
export interface RunDetail extends RunSummary {
  origin_kind: AgentInput["origin_kind"];
  actor_ref: ActorRef;
  source_ref: InputSource;
  principal: Principal;
  last_event_seq: string;
  end_seq: string | null;
  budget_usage: {
    input_tokens_used: string;
    output_tokens_used: string;
    model_calls_used: number;
    tool_calls_used: number;
    children_started: number;
    wall_time_ms: string;
  };
  binding: {
    id: string;
    cloud_computer_id: string;
    runtime_generation: string | null;
    storage_generation: string;
    mode: "shared" | "exclusive";
    state: string;
    cwd: string;
  } | null;
  physical_activity: {
    state: "none" | "active" | "reconciling" | "settling" | "settled";
    unknown_execution_count: number;
    pending_transfer_count: number;
  };
}
export interface ChildRunSummary extends Pick<
  RunSummary,
  | "id"
  | "session_id"
  | "root_run_id"
  | "parent_run_id"
  | "status"
  | "reason_code"
  | "started_at"
  | "finished_at"
> {
  result_summary: string | null;
}
export type ToolStatus =
  | "prepared"
  | "waiting_approval"
  | "dispatching"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "outcome_unknown";
export interface ToolCall {
  id: string;
  run_id: string;
  step: number;
  index: number;
  tool_key: string;
  mcp_server_id: string | null;
  mcp_binding_id: string | null;
  mcp_tool_name: string | null;
  arguments: JsonObject;
  arguments_hash: string;
  execution_class: ToolCatalogEntry["execution_class"];
  policy: ToolPolicy;
  status: ToolStatus;
  interaction_id: string | null;
  prepared_at: string;
  dispatched_at: string | null;
  finished_at: string | null;
  result_event_seq: string | null;
  executed: boolean | null;
  outcome: {
    certainty: "pending" | "known" | "unknown";
    reason: string | null;
  };
  reconciliation: {
    status: string;
    observed_at: string;
    event_seq: string;
  } | null;
}
export interface Attachment extends Versioned {
  id: string;
  session_id: string;
  file_id: string;
  filename: string;
  media_type: string;
  size_bytes: string;
  sha256: string;
  state: "staged" | "bound" | "expired" | "deleted";
  uploaded_by: string;
  expires_at: string | null;
  bound_input_id: string | null;
  created_at: string;
}
export interface Artifact extends Versioned {
  id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string;
  file_id: string;
  filename: string;
  description: string;
  media_type: string;
  size_bytes: string;
  sha256: string;
  source: { cloud_computer_id: string; binding_id: string; path: string };
  created_at: string;
  deleted_at: string | null;
}
export interface FileMetadata {
  id: string;
  filename: string;
  media_type: string;
  size_bytes: string;
  sha256: string;
  state: "uploading" | "staged" | "bound" | "orphaned" | "deleting" | "deleted";
  integrity_state: "unchecked" | "verified" | "missing" | "corrupt";
  created_at: string;
  download_url: string | null;
  preview_available: boolean;
}
export interface Operation<T = JsonObject> {
  id: string;
  kind: string;
  target: { kind: string; id: string };
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "outcome_unknown";
  deadline_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: T | null;
  error_code: string | null;
  outcome: {
    certainty: "pending" | "known" | "unknown";
    reason: string | null;
  };
  created_at: string;
}
export interface CommandReceipt<T> {
  command: string;
  scope: string;
  key: string;
  response_status: number;
  response_data: T;
  resource_refs: { kind: string; id: string }[];
  created_at: string;
}
export type AttentionKind = "response_required" | "result_unviewed";
export interface AttentionSummary {
  counts: {
    response_required_sessions: number;
    result_unviewed_sessions: number;
  };
  generated_at: string;
}
export type AttentionItem =
  | {
      kind: "response_required";
      session_id: string;
      agent_id: string;
      title: string;
      question_interaction_count: number;
      approval_interaction_count: number;
      first_response_at: string;
      next_approval_expires_at: string | null;
      last_activity_at: string;
    }
  | {
      kind: "result_unviewed";
      session_id: string;
      agent_id: string;
      title: string;
      unviewed_run_count: number;
      viewed_through_seq: string;
      latest_result: RunResultRef;
    };
export interface UsageTotals {
  model_call_count: number;
  completed_call_count: number;
  failed_call_count: number;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  cache_write_tokens: string | null;
  known_usage_call_count: number;
  unknown_usage_call_count: number;
  usage_completeness: "complete" | "partial" | "unknown";
  estimated_cost: {
    amount: string;
    currency: string;
    pricing_version: string;
  } | null;
}
export interface UsageReport {
  from: string;
  to: string;
  group_by: "day" | "agent" | "model" | "provider" | "agent_type";
  items: { key: string; totals: UsageTotals }[];
  totals: UsageTotals;
  generated_at: string;
}
export interface SessionUsageReport extends UsageTotals {
  context: {
    window_tokens: string;
    reserved_output_tokens: string;
    input_tokens: string | null;
    cache_read_tokens: string | null;
    model_call_id: string | null;
    observed_at: string | null;
    stale: boolean;
  };
  cache: {
    call_count: number;
    covered_call_count: number;
    input_tokens: string | null;
    cache_read_tokens: string | null;
    cache_write_tokens: string | null;
  };
}
export interface RunMetadata {
  id: string;
  session_id: string;
  agent_id: string;
  agent_type: AgentType;
  owner_user_id: string | null;
  status: RunStatus;
  reason_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  settled_at: string | null;
  deadline_at: string;
  model_call_count: number;
  tool_call_count: number;
  unknown_tool_call_count: number;
  usage_completeness: UsageTotals["usage_completeness"];
  can_open_content: boolean;
}
export interface ModelCallMetadata {
  id: string;
  session_id: string;
  run_id: string | null;
  purpose: "generation" | "compaction" | "title";
  compaction_id: string | null;
  step: number;
  attempt: number;
  status:
    | "preparing"
    | "streaming"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  model_definition_id: string;
  provider_id: string;
  protocol: ModelProtocol;
  requested_model: string;
  returned_model: string | null;
  thinking_option_key: string;
  request_config_hash: string;
  started_at: string | null;
  finished_at: string | null;
  latency_ms: number | null;
  error_code: string | null;
  usage: {
    input_tokens: string | null;
    output_tokens: string | null;
    cache_read_tokens: string | null;
    cache_write_tokens: string | null;
    normalization_version: string;
    raw_numeric_fields: Record<string, number>;
  };
  usage_completeness: UsageTotals["usage_completeness"];
}
