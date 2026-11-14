import type {
  Attachment,
  FileRef,
  InputAccepted,
  InputCreate,
  SessionCreate,
  SessionDetail,
} from "@/types/agents";
import { agentRoot } from "./agent-api";
import { uuid } from "@/lib/utils";
import {
  AgentCommand,
  AgentCommandStore,
  type CommandPlan,
} from "./command-store";

export interface SendPlan {
  session: { id: string; selection_hash: string } | { create: SessionCreate };
  text: string;
  files: File[];
  file_refs: FileRef[];
}
export interface SendState {
  phase: "idle" | "sending" | "uncertain" | "failed" | "accepted";
  stage: "session" | "upload" | "input";
  uploadIndex: number;
  sessionId: string | null;
  plan: SendPlan | null;
  result: InputAccepted | null;
  error: unknown;
  receiptMissing: boolean;
}
export class ConversationSendFlow {
  private state: SendState = {
    phase: "idle",
    stage: "session",
    uploadIndex: 0,
    sessionId: null,
    plan: null,
    result: null,
    error: null,
    receiptMissing: false,
  };
  private listeners = new Set<() => void>();
  private active: AgentCommand<unknown> | null = null;
  private activePlan: CommandPlan | null = null;
  private selectionHash = "";
  private refs: FileRef[] = [];
  private nonce = "";
  private busy = false;
  private disposed = false;
  constructor(
    private readonly commands: AgentCommandStore,
    private readonly id: string,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private update(next: Partial<SendState>) {
    if (!this.disposed) {
      this.state = { ...this.state, ...next };
      this.listeners.forEach((notify) => notify());
    }
  }
  async start(plan: SendPlan) {
    if (this.state.phase !== "idle" || this.disposed) return;
    this.nonce = uuid();
    this.refs = structuredClone(plan.file_refs);
    this.selectionHash =
      "id" in plan.session ? plan.session.selection_hash : "";
    const copied = {
      ...plan,
      session: structuredClone(plan.session),
      files: [...plan.files],
      file_refs: structuredClone(plan.file_refs),
    };
    this.update({
      plan: copied,
      sessionId: "id" in plan.session ? plan.session.id : null,
      phase: "sending",
      error: null,
      result: null,
      uploadIndex: 0,
      stage: "id" in plan.session ? "upload" : "session",
    });
    await this.drive();
  }
  private async execute<T>(
    suffix: string,
    plan: CommandPlan,
  ): Promise<T | undefined> {
    const command = this.commands.get<unknown>(
      `send:${this.id}:${this.nonce}:${suffix}`,
    );
    this.active = command;
    this.activePlan = plan;
    if (command.getSnapshot().phase !== "succeeded") await command.run(plan);
    const result = command.getSnapshot();
    if (this.disposed) return;
    if (result.phase !== "succeeded" || !result.response) {
      this.update({
        phase: result.phase === "uncertain" ? "uncertain" : "failed",
        error: result.error,
        receiptMissing: result.receiptMissing,
      });
      return;
    }
    return result.response.data as T;
  }
  private async drive() {
    if (this.busy || this.disposed || !this.state.plan) return;
    this.busy = true;
    try {
      const plan = this.state.plan;
      this.update({ phase: "sending", error: null, receiptMissing: false });
      if (!this.state.sessionId && "create" in plan.session) {
        this.update({ stage: "session" });
        const session = await this.execute<SessionDetail>("session", {
          domain: agentRoot,
          path: "/sessions",
          command: "session.create",
          scope: "sessions",
          options: { method: "POST", body: plan.session.create },
        });
        if (!session) return;
        this.selectionHash = session.selection.model_selection_hash;
        this.update({ sessionId: session.configuration.id });
      }
      const sessionId = this.state.sessionId;
      if (!sessionId || this.disposed) return;
      for (
        let index = this.state.uploadIndex;
        index < plan.files.length;
        index++
      ) {
        this.update({ stage: "upload", uploadIndex: index });
        const body = new FormData();
        body.set("file", plan.files[index]);
        const attachment = await this.execute<Attachment>(`file:${index}`, {
          domain: agentRoot,
          path: `/sessions/${sessionId}/attachments`,
          command: "attachment.upload",
          scope: `session:${sessionId}`,
          options: { method: "POST", body },
        });
        if (!attachment) return;
        this.refs.push({ kind: "attachment", id: attachment.id });
        this.update({ uploadIndex: index + 1 });
      }
      this.update({ stage: "input" });
      const body: InputCreate = {
        content: plan.text.trim() ? [{ type: "text", text: plan.text }] : [],
        file_refs: this.refs,
        expected_model_selection_hash: this.selectionHash,
      };
      const result = await this.execute<InputAccepted>("input", {
        domain: agentRoot,
        path: `/sessions/${sessionId}/inputs`,
        command: "input.submit",
        scope: `session:${sessionId}`,
        options: { method: "POST", body },
      });
      if (result) this.update({ phase: "accepted", result });
    } finally {
      this.busy = false;
    }
  }
  async recover(action: "receipt" | "retry") {
    if (!this.active || this.state.phase !== "uncertain" || this.busy) return;
    this.update({ phase: "sending" });
    if (action === "receipt") await this.active.reconcile();
    else await this.active.retry();
    const current = this.active.getSnapshot();
    if (current.phase === "succeeded") await this.drive();
    else
      this.update({
        phase: current.phase === "uncertain" ? "uncertain" : "failed",
        error: current.error,
        receiptMissing: current.receiptMissing,
      });
  }
  async retryKnown(selectionHash?: string) {
    if (
      this.state.phase !== "failed" ||
      !this.active ||
      !this.activePlan ||
      this.busy
    )
      return;
    if (selectionHash) this.selectionHash = selectionHash;
    this.active.reset();
    await this.drive();
  }
  reset() {
    if (this.state.phase === "sending" || this.state.phase === "uncertain")
      return;
    this.active = null;
    this.activePlan = null;
    this.refs = [];
    this.selectionHash = "";
    this.update({
      phase: "idle",
      stage: "session",
      uploadIndex: 0,
      sessionId: null,
      plan: null,
      result: null,
      error: null,
      receiptMissing: false,
    });
  }
  remainingDraft() {
    return {
      text: this.state.plan?.text ?? "",
      files: this.state.plan?.files.slice(this.state.uploadIndex) ?? [],
      file_refs: [...this.refs],
    };
  }
  dispose() {
    this.disposed = true;
    this.refs = [];
    this.active = null;
    this.activePlan = null;
    this.state = { ...this.state, plan: null, result: null, error: null };
    this.listeners.clear();
  }
}
export class ConversationSendStore {
  private flows = new Map<string, ConversationSendFlow>();
  constructor(private readonly commands: AgentCommandStore) {}
  get(id: string) {
    let flow = this.flows.get(id);
    if (!flow) {
      flow = new ConversationSendFlow(this.commands, id);
      this.flows.set(id, flow);
    }
    return flow;
  }
  dispose() {
    this.flows.forEach((flow) => flow.dispose());
    this.flows.clear();
  }
}
