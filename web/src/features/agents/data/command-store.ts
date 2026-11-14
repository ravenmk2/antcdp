import {
  ApiError,
  request,
  type ApiResponse,
  type RequestOptions,
} from "@/api/client";
import { commandReceipt, type AgentApiDomain } from "./agent-api";
import { uuid } from "@/lib/utils";

export interface CommandPlan {
  domain: AgentApiDomain;
  path: string;
  command: string;
  scope: string;
  options: Omit<RequestOptions, "idempotencyKey" | "signal">;
}
export interface CommandState<T> {
  phase: "idle" | "pending" | "uncertain" | "failed" | "succeeded";
  key: string | null;
  response: ApiResponse<T> | null;
  error: unknown;
  receiptMissing: boolean;
}
function copyBody(body: unknown) {
  if (body instanceof FormData) {
    const copy = new FormData();
    for (const [key, value] of body.entries()) copy.append(key, value);
    return copy;
  }
  return body === undefined ? undefined : structuredClone(body);
}
export class AgentCommand<T = unknown> {
  private state: CommandState<T> = {
    phase: "idle",
    key: null,
    response: null,
    error: undefined,
    receiptMissing: false,
  };
  private plan: CommandPlan | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  getSnapshot = () => this.state;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  private update(next: Partial<CommandState<T>>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((notify) => notify());
  }
  async run(plan: CommandPlan) {
    if (this.disposed || this.plan || this.state.phase === "pending") return;
    this.plan = {
      ...plan,
      options: {
        ...plan.options,
        body: copyBody(plan.options.body),
        headers: plan.options.headers ? { ...plan.options.headers } : undefined,
      },
    };
    this.update({
      key: uuid(),
      response: null,
      error: undefined,
      receiptMissing: false,
    });
    await this.execute();
  }
  private async execute() {
    const plan = this.plan,
      key = this.state.key;
    if (!plan || !key || this.disposed) return;
    this.update({ phase: "pending", error: undefined });
    try {
      const response = await request<T>(`${plan.domain}${plan.path}`, {
        ...plan.options,
        idempotencyKey: key,
      });
      this.plan = null;
      this.update({ phase: "succeeded", response, receiptMissing: false });
    } catch (error) {
      const uncertain = error instanceof ApiError && error.uncertain;
      if (!uncertain) this.plan = null;
      this.update({ phase: uncertain ? "uncertain" : "failed", error });
    }
  }
  async retry() {
    if (this.state.phase === "uncertain") await this.execute();
  }
  async reconcile() {
    const plan = this.plan,
      key = this.state.key;
    if (this.state.phase !== "uncertain" || !plan || !key || this.disposed)
      return;
    this.update({ phase: "pending", error: undefined, receiptMissing: false });
    try {
      const result = await commandReceipt<T>(
        plan.domain,
        key,
        plan.command,
        plan.scope,
      );
      this.plan = null;
      this.update({
        phase: "succeeded",
        receiptMissing: false,
        response: {
          data: result.data.response_data,
          status: result.data.response_status,
          etag: "",
        },
      });
    } catch (error) {
      this.update({
        phase: "uncertain",
        error,
        receiptMissing: error instanceof ApiError && error.status === 404,
      });
    }
  }
  reset() {
    if (this.plan || this.state.phase === "pending") return;
    this.update({
      phase: "idle",
      key: null,
      error: undefined,
      response: null,
      receiptMissing: false,
    });
  }
  dispose() {
    this.disposed = true;
    this.plan = null;
    this.listeners.clear();
    this.state = {
      phase: "idle",
      key: null,
      response: null,
      error: undefined,
      receiptMissing: false,
    };
  }
}
// Owned by the authenticated frontend runtime, not a drawer. Navigating between
// views cannot lose the original body/key while acceptance is still unknown.
export class AgentCommandStore {
  private commands = new Map<string, AgentCommand<unknown>>();
  get<T>(intentId: string): AgentCommand<T> {
    let command = this.commands.get(intentId);
    if (!command) {
      command = new AgentCommand();
      this.commands.set(intentId, command);
    }
    return command as AgentCommand<T>;
  }
  dispose() {
    this.commands.forEach((command) => command.dispose());
    this.commands.clear();
  }
}
