import type {
  Attachment,
  FileRef,
  InputAccepted,
  InputCreate,
  Operation,
  SessionCreate,
  SessionDetail,
} from "@/types/agents";
import { ApiError } from "@/api/client";
import { agentRequest, agentRoot, commandReceipt } from "./agent-api";
import { uuid } from "@/lib/utils";
import type { WorkspaceDraftFile } from "./draft-store";
import {
  AgentCommand,
  AgentCommandStore,
  type CommandPlan,
} from "./command-store";

export interface SendPlan {
  textLimit?: number;
  placement?: "transcript" | "queued";
  session:
    | { id: string; selection_hash: string; workspaceReady?: boolean }
    | { create: SessionCreate };
  text: string;
  images: File[];
  workspaceFiles: WorkspaceDraftFile[];
  file_refs: FileRef[];
}

const workspaceUploadCommand = "workspace.session_upload";

interface WorkspacePreparation {
  status: "ready" | "preparing" | Operation["status"];
  operation_id?: string;
  error_code?: string;
}
type WorkspaceUpload = Operation<{ path: string; size_bytes: string }>;

export interface MessageWorkspaceFile {
  filename: string;
  path?: string;
  file?: File;
}
export interface AcceptedSubmission {
  inputId: string;
  text: string;
  fileRefs: FileRef[];
  workspaceFiles?: MessageWorkspaceFile[];
  time: string;
}
export interface SendState {
  phase: "idle" | "sending" | "uncertain" | "failed" | "accepted";
  stage: "session" | "image" | "prepare" | "workspace" | "input";
  uploadIndex: number;
  workspaceIndex: number;
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
    workspaceIndex: 0,
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
  private workspaceReady = false;
  private preparationId: string | undefined;
  private workspaceKey: string | undefined;
  private readonly workspaceAbort = new AbortController();
  private busy = false;
  private disposed = false;
  constructor(
    private readonly commands: AgentCommandStore,
    private readonly id: string,
    private readonly onAccepted?: (
      sessionId: string,
      submission: AcceptedSubmission,
    ) => void,
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
    this.workspaceReady =
      "id" in plan.session && plan.session.workspaceReady === true;
    const copied = {
      ...plan,
      session: structuredClone(plan.session),
      images: [...plan.images],
      workspaceFiles: plan.workspaceFiles.map((item) => ({ ...item })),
      file_refs: structuredClone(plan.file_refs),
    };
    this.update({
      plan: copied,
      sessionId: "id" in plan.session ? plan.session.id : null,
      phase: "sending",
      error: null,
      result: null,
      uploadIndex: 0,
      workspaceIndex: 0,
      stage: "id" in plan.session ? "image" : "session",
    });
    await this.drive();
  }
  private async prepareWorkspace(sessionId: string) {
    this.update({ stage: "prepare" });
    const signal = this.workspaceAbort.signal;
    const workspace = `/sessions/${sessionId}/workspace`;
    try {
      if (!this.preparationId) {
        const { data } = await agentRequest<WorkspacePreparation>(
          `${workspace}/prepare`,
          {
            method: "POST",
            body: {},
            signal,
          },
        );
        if (data.status === "ready") return true;
        this.preparationId = data.operation_id;
      }
      if (!this.preparationId) throw new Error("云电脑准备状态不可用");
      const deadline = Date.now() + 5 * 60_000;
      while (!signal.aborted && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (signal.aborted) return false;
        const { data } = await agentRequest<WorkspacePreparation>(
          `${workspace}/operations/${this.preparationId}`,
          { signal },
        );
        switch (data.status) {
          case "succeeded":
            this.preparationId = undefined;
            return true;
          case "queued":
          case "running":
            continue;
          case "outcome_unknown":
            throw new ApiError(
              "WORKSPACE_IO_OUTCOME_UNKNOWN",
              "云电脑准备结果待核实，请稍后重试。",
              409,
            );
          default:
            this.preparationId = undefined;
            throw new ApiError(
              data.error_code ?? "CLOUD_NOT_READY",
              "云电脑准备失败，请重试。",
              409,
            );
        }
      }
      if (!signal.aborted) throw new Error("仍在准备云电脑，请稍后继续发送。");
    } catch (error) {
      this.update({ phase: "failed", error });
    }
    return false;
  }
  private acceptWorkspaceUpload(operation: WorkspaceUpload) {
    const plan = this.state.plan;
    const index = this.state.workspaceIndex;
    const item = plan?.workspaceFiles[index];
    const path = operation.result?.path;
    const savedName = path?.split("/").at(-1);
    if (
      operation.status === "succeeded" &&
      plan &&
      item &&
      this.workspaceKey &&
      savedName
    ) {
      const workspaceFiles = [...plan.workspaceFiles];
      workspaceFiles[index] = {
        file: item.file,
        savedName,
        uploadKey: this.workspaceKey,
      };
      this.workspaceKey = undefined;
      this.update({ plan: { ...plan, workspaceFiles } });
      return true;
    }
    const unknown = [
      "queued",
      "running",
      "outcome_unknown",
      "succeeded",
    ].includes(operation.status);
    this.update({
      phase: unknown ? "uncertain" : "failed",
      error: new ApiError(
        operation.error_code ??
          (unknown
            ? "WORKSPACE_IO_OUTCOME_UNKNOWN"
            : "WORKSPACE_UPLOAD_FAILED"),
        unknown ? "工作区文件保存结果待核实。" : "工作区文件保存失败。",
        409,
      ),
    });
    return false;
  }
  private async saveWorkspaceFile(
    sessionId: string,
    file: File,
    prepareOnDemand = true,
  ): Promise<boolean> {
    this.update({ stage: "workspace" });
    this.workspaceKey ??= uuid();
    const body = new FormData();
    body.set("file", file);
    try {
      const { data } = await agentRequest<WorkspaceUpload>(
        `/sessions/${sessionId}/workspace/file-uploads`,
        {
          method: "POST",
          body,
          idempotencyKey: this.workspaceKey,
          signal: this.workspaceAbort.signal,
        },
      );
      return this.acceptWorkspaceUpload(data);
    } catch (error) {
      if (
        prepareOnDemand &&
        error instanceof ApiError &&
        error.code === "WORKSPACE_PREPARATION_REQUIRED"
      ) {
        this.workspaceReady = await this.prepareWorkspace(sessionId);
        return (
          this.workspaceReady && this.saveWorkspaceFile(sessionId, file, false)
        );
      }
      const uncertain =
        error instanceof ApiError &&
        (error.uncertain ||
          error.code === "WORKSPACE_IO_OUTCOME_UNKNOWN" ||
          error.code === "WORKSPACE_RECONCILING");
      this.update({ phase: uncertain ? "uncertain" : "failed", error });
      return false;
    }
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
        index < plan.images.length;
        index++
      ) {
        this.update({ stage: "image", uploadIndex: index });
        const body = new FormData();
        body.set("file", plan.images[index]);
        const attachment = await this.execute<Attachment>(`file:${index}`, {
          domain: agentRoot,
          path: `/sessions/${sessionId}/attachments?kind=image`,
          command: "attachment.upload",
          scope: `session:${sessionId}`,
          options: { method: "POST", body },
        });
        if (!attachment) return;
        this.refs.push({ kind: "attachment", id: attachment.id });
        this.update({ uploadIndex: index + 1 });
      }
      for (const [index, item] of plan.workspaceFiles.entries()) {
        if (item.uploadKey) continue;
        if (!this.workspaceReady) {
          this.workspaceReady = await this.prepareWorkspace(sessionId);
          if (!this.workspaceReady) return;
        }
        this.update({ workspaceIndex: index });
        if (!(await this.saveWorkspaceFile(sessionId, item.file))) return;
      }
      this.update({ stage: "input" });
      const currentPlan = this.state.plan!;
      const text = currentPlan.text;
      const uploads = currentPlan.workspaceFiles.flatMap((file) =>
        file.uploadKey ? [file.uploadKey] : [],
      );
      if (
        uploads.length !== currentPlan.workspaceFiles.length ||
        (!text.trim() && !this.refs.length && !uploads.length)
      ) {
        this.update({
          phase: "failed",
          stage: "input",
          error: "没有可发送的文件或正文，请返回编辑。",
        });
        return;
      }
      if (
        new TextEncoder().encode(text).length > (currentPlan.textLimit ?? 32768)
      ) {
        this.update({
          phase: "failed",
          stage: "input",
          error: "正文超过消息长度限制，请编辑后重新发送。",
        });
        return;
      }
      const body: InputCreate = {
        content: text.trim() ? [{ type: "text", text }] : [],
        file_refs: this.refs,
        ...(uploads.length && { workspace_upload_keys: uploads }),
        expected_model_selection_hash: this.selectionHash,
      };
      const result = await this.execute<InputAccepted>("input", {
        domain: agentRoot,
        path: `/sessions/${sessionId}/inputs`,
        command: "input.submit",
        scope: `session:${sessionId}`,
        options: { method: "POST", body },
      });
      if (result) {
        if (plan.placement === "transcript")
          this.onAccepted?.(sessionId, {
            inputId: result.input_id,
            text,
            fileRefs: [...this.refs],
            workspaceFiles: currentPlan.workspaceFiles.map((item) => ({
              filename: item.savedName ?? item.file.name,
              file: item.file,
            })),
            time: new Date().toISOString(),
          });
        this.update({ phase: "accepted", result });
      }
    } finally {
      this.busy = false;
    }
  }
  async recover(action: "receipt" | "retry") {
    if (this.state.phase !== "uncertain" || this.busy) return;
    if (this.state.stage === "workspace") {
      await this.recoverWorkspaceUpload(action);
      return;
    }
    if (!this.active) return;
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
  private async recoverWorkspaceUpload(action: "receipt" | "retry") {
    const { sessionId, plan, receiptMissing } = this.state;
    if (
      !this.workspaceKey ||
      !sessionId ||
      !plan ||
      (action === "retry" && !receiptMissing)
    )
      return;
    this.update({ phase: "sending", receiptMissing: false });
    if (action === "retry") {
      await this.drive();
      return;
    }
    try {
      const { data } = await commandReceipt<WorkspaceUpload>(
        agentRoot,
        this.workspaceKey,
        workspaceUploadCommand,
        `session:${sessionId}`,
      );
      if (!this.disposed && this.acceptWorkspaceUpload(data.response_data))
        await this.drive();
    } catch (error) {
      this.update({
        phase: "uncertain",
        error,
        receiptMissing: error instanceof ApiError && error.status === 404,
      });
    }
  }
  async removeFailedWorkspaceFiles() {
    const { plan, phase, stage, workspaceIndex } = this.state;
    if (
      !plan ||
      phase !== "failed" ||
      (stage !== "prepare" && stage !== "workspace")
    )
      return;
    const workspaceFiles =
      stage === "prepare"
        ? plan.workspaceFiles.filter((item) => item.savedName)
        : plan.workspaceFiles.filter((_, index) => index !== workspaceIndex);
    this.update({ plan: { ...plan, workspaceFiles } });
    await this.retryKnown();
  }
  async retryKnown(selectionHash?: string) {
    if (this.state.phase !== "failed" || this.busy) return;
    if (this.state.stage === "workspace" || this.state.stage === "prepare") {
      this.workspaceKey = undefined;
      await this.drive();
      return;
    }
    if (!this.active || !this.activePlan) return;
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
    this.workspaceReady = false;
    this.preparationId = undefined;
    this.workspaceKey = undefined;
    this.update({
      phase: "idle",
      stage: "session",
      uploadIndex: 0,
      workspaceIndex: 0,
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
      images: this.state.plan?.images.slice(this.state.uploadIndex) ?? [],
      workspaceFiles: this.state.plan?.workspaceFiles ?? [],
      file_refs: [...this.refs],
    };
  }
  dispose() {
    this.disposed = true;
    this.workspaceAbort.abort();
    this.refs = [];
    this.active = null;
    this.activePlan = null;
    this.state = { ...this.state, plan: null, result: null, error: null };
    this.listeners.clear();
  }
}
export class ConversationSendStore {
  private flows = new Map<string, ConversationSendFlow>();
  private accepted = new Map<string, readonly AcceptedSubmission[]>();
  private listeners = new Set<() => void>();
  private readonly empty: readonly AcceptedSubmission[] = [];
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  submissions = (sessionId: string) =>
    this.accepted.get(sessionId) ?? this.empty;
  retire(sessionId: string, inputIds: Set<string>) {
    const previous = this.submissions(sessionId);
    const next = previous.filter((item) => !inputIds.has(item.inputId));
    if (next.length === previous.length) return;
    this.accepted.set(sessionId, next);
    this.listeners.forEach((notify) => notify());
  }
  constructor(private readonly commands: AgentCommandStore) {}
  get(id: string) {
    let flow = this.flows.get(id);
    if (!flow) {
      flow = new ConversationSendFlow(
        this.commands,
        id,
        (sessionId, submission) => {
          this.accepted.set(sessionId, [
            ...this.submissions(sessionId).filter(
              (item) => item.inputId !== submission.inputId,
            ),
            submission,
          ]);
          this.listeners.forEach((notify) => notify());
        },
      );
      this.flows.set(id, flow);
    }
    return flow;
  }
  dispose() {
    this.flows.forEach((flow) => flow.dispose());
    this.flows.clear();
    this.accepted.clear();
    this.listeners.clear();
  }
}
