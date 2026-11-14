import type {
  ClientFrame,
  HistoryPage,
  ServerFrame,
} from "@/types/agent-events";
import {
  conversationFrame,
  initialConversationState,
  mergeHistory,
  type ConversationStreamState,
} from "./stream-reducer";

export type ConnectionStatus =
  "disconnected" | "connecting" | "open" | "backoff" | "closed";
interface SocketLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
interface ClientOptions {
  createSocket?: () => SocketLike;
  checkAuthentication: () => Promise<boolean>;
  onAuthenticationLost: () => void;
  random?: () => number;
  maxSubscriptions?: number;
  maxFrameBytes?: number;
}
export interface ConversationObservation {
  getSnapshot: () => ConversationStreamState;
  subscribe: (listener: () => void) => () => void;
  mergeHistory: (
    page: HistoryPage,
    subscriptionId: string,
    baselineGeneration: number,
  ) => void;
  resync: () => void;
}
interface Entry {
  cancelPublish?: () => void;
  sessionId: string;
  state: ConversationStreamState;
  listeners: Set<() => void>;
  observation: ConversationObservation;
}
export class AgentStreamClient {
  private socket: SocketLike | null = null;
  private generation = 0;
  private sequence = 0;
  private entries = new Map<string, Entry>();
  private observations = new Map<string, Entry>();
  private subscriptions = new Map<string, Entry>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private backoffAttempt = 0;
  private pendingPings = new Map<string, number>();
  private lastPong = 0;
  private installedSnapshot = false;
  private disposed = false;
  private status: ConnectionStatus = "disconnected";
  private connectionListeners = new Set<() => void>();
  private authenticationCheck = false;
  private stopped = false;
  constructor(private readonly options: ClientOptions) {}

  getConnectionStatus = () => this.status;
  subscribeConnection = (listener: () => void) => {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  };
  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.connectionListeners.forEach((notify) => notify());
  }
  private notify(entry: Entry) {
    entry.cancelPublish?.();
    entry.cancelPublish = undefined;
    entry.listeners.forEach((notify) => notify());
  }
  private schedulePublish(entry: Entry) {
    if (entry.cancelPublish) return;
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(() => this.notify(entry));
      entry.cancelPublish = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(() => this.notify(entry), 16);
      entry.cancelPublish = () => clearTimeout(id);
    }
  }
  private send(frame: ClientFrame) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(frame));
  }

  observe(sessionId: string): ConversationObservation {
    const existing = this.observations.get(sessionId);
    if (existing) return existing.observation;
    const entry = {
      sessionId,
      state: initialConversationState(sessionId, ""),
      listeners: new Set<() => void>(),
    } as Entry;
    entry.observation = {
      getSnapshot: () => entry.state,
      subscribe: (listener) => {
        entry.listeners.add(listener);
        if (entry.listeners.size === 1) this.activate(entry);
        return () => {
          entry.listeners.delete(listener);
          if (!entry.listeners.size) this.deactivate(entry);
        };
      },
      mergeHistory: (page, generation, baselineGeneration) => {
        if (
          generation !== entry.state.subscriptionId ||
          baselineGeneration !== entry.state.baselineGeneration ||
          entry.state.phase === "closed"
        )
          return;
        const next = mergeHistory(entry.state, page);
        if (next !== entry.state) {
          const previous = entry.state;
          entry.state = next;
          this.reactToState(entry, previous);
          this.notify(entry);
        }
      },
      resync: () => {
        if (entry.state.phase !== "live") return;
        entry.state = {
          ...entry.state,
          phase: "resyncing",
          reason: "requested",
        };
        this.send({
          type: "resync",
          subscription_id: entry.state.subscriptionId,
        });
        this.notify(entry);
      },
    };
    this.observations.set(sessionId, entry);
    return entry.observation;
  }
  private activate(entry: Entry) {
    if (this.disposed || this.stopped) {
      entry.state = {
        ...entry.state,
        phase: "closed",
        reason: "connection_closed",
      };
      this.notify(entry);
      return;
    }
    if (
      this.entries.size >= (this.options.maxSubscriptions ?? 8) &&
      !this.entries.has(entry.sessionId)
    ) {
      entry.state = {
        ...entry.state,
        phase: "closed",
        reason: "SUBSCRIPTION_LIMIT",
      };
      this.notify(entry);
      return;
    }
    this.entries.set(entry.sessionId, entry);
    if (this.socket?.readyState === 1) this.subscribeEntry(entry);
    else if (!this.socket && !this.retryTimer) this.connect();
  }
  private deactivate(entry: Entry) {
    entry.cancelPublish?.();
    entry.cancelPublish = undefined;
    this.send({
      type: "unsubscribe",
      subscription_id: entry.state.subscriptionId,
    });
    this.subscriptions.delete(entry.state.subscriptionId);
    this.entries.delete(entry.sessionId);
    // Content lives only as long as a mounted observer, never in browser storage.
    entry.state = initialConversationState(entry.sessionId, "");
    if (!this.entries.size) {
      this.disconnect();
      this.setStatus("disconnected");
    }
  }
  private subscribeEntry(entry: Entry) {
    const id = `chat_${this.generation}_${++this.sequence}`;
    entry.state = {
      ...entry.state,
      subscriptionId: id,
      phase: "subscribing",
      activeAttempt: null,
      reason: null,
    };
    this.subscriptions.set(id, entry);
    this.send({
      type: "subscribe",
      subscription_id: id,
      session_id: entry.sessionId,
      history_limit: 80,
    });
    this.notify(entry);
  }
  private connect() {
    if (this.disposed || this.stopped || !this.entries.size || this.socket)
      return;
    this.setStatus("connecting");
    const generation = ++this.generation;
    let socket: SocketLike;
    try {
      socket =
        this.options.createSocket?.() ??
        new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/agents/stream`,
          "antcdp.agent.v1",
        );
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const current = () =>
      generation === this.generation &&
      this.socket === socket &&
      !this.disposed;
    socket.onopen = () => {
      if (!current()) return;
      this.setStatus("open");
      this.lastPong = Date.now();
      this.installedSnapshot = false;
      this.pendingPings.clear();
      this.subscriptions.clear();
      for (const entry of this.entries.values())
        if (entry.state.phase !== "closed") this.subscribeEntry(entry);
      this.heartbeatTimer = setInterval(() => {
        if (!current()) return;
        if (Date.now() - this.lastPong >= 90_000) {
          this.reconnect();
          return;
        }
        const nonce = `ping_${generation}_${++this.sequence}`;
        this.pendingPings.set(nonce, Date.now());
        this.send({ type: "ping", nonce });
      }, 30_000);
    };
    socket.onmessage = (event) => {
      if (!current()) return;
      if (
        typeof event.data !== "string" ||
        new TextEncoder().encode(event.data).byteLength >
          (this.options.maxFrameBytes ?? 2 * 1024 * 1024)
      ) {
        this.protocolFailure();
        return;
      }
      let frame: ServerFrame;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !("type" in parsed) ||
          typeof parsed.type !== "string"
        ) {
          this.protocolFailure();
          return;
        }
        frame = parsed as ServerFrame;
      } catch {
        this.protocolFailure();
        return;
      }
      if (frame.type === "pong") {
        if (!this.pendingPings.has(frame.nonce)) return;
        this.pendingPings.clear();
        this.lastPong = Date.now();
        if (this.installedSnapshot) this.backoffAttempt = 0;
        return;
      }
      if (!("subscription_id" in frame) || !frame.subscription_id) {
        if (frame.type === "error" && frame.code === "UNAUTHENTICATED")
          void this.recheckAuthentication();
        else this.protocolFailure();
        return;
      }
      const entry = this.subscriptions.get(frame.subscription_id);
      if (!entry) return;
      const previous = entry.state;
      try {
        if (
          ![
            "snapshot",
            "event",
            "assistant_stream",
            "unsubscribed",
            "error",
            "resync_required",
            "access_revoked",
          ].includes(frame.type)
        )
          throw new Error("unsupported frame");
        entry.state = conversationFrame(previous, frame);
      } catch {
        entry.state = {
          ...previous,
          phase: previous.schemaFailures > 0 ? "closed" : "resyncing",
          schemaFailures: previous.schemaFailures + 1,
          reason: "schema_unsupported",
        };
      }
      if (frame.type === "snapshot" && entry.state.phase === "live")
        this.installedSnapshot = true;
      this.reactToState(entry, previous);
      if (previous !== entry.state) {
        if (
          frame.type === "assistant_stream" &&
          frame.kind === "chunk" &&
          entry.state.phase === "live"
        )
          this.schedulePublish(entry);
        else this.notify(entry);
      }
    };
    socket.onerror = () => {
      /* Browsers follow transport failures with close. */
    };
    socket.onclose = (event) => {
      if (!current()) return;
      this.disconnect();
      if (event.code === 1008) {
        void this.recheckAuthentication();
        return;
      }
      if (event.code === 1000 || event.code === 1009) {
        this.stopped = true;
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }
  private reactToState(entry: Entry, previous: ConversationStreamState) {
    if (
      entry.state.phase === "resyncing" &&
      (previous.phase !== "resyncing" ||
        entry.state.schemaFailures > previous.schemaFailures)
    )
      this.send({
        type: "resync",
        subscription_id: entry.state.subscriptionId,
      });
    if (entry.state.phase === "closed") {
      this.send({
        type: "unsubscribe",
        subscription_id: entry.state.subscriptionId,
      });
      this.subscriptions.delete(entry.state.subscriptionId);
    }
  }
  private protocolFailure() {
    this.stopped = true;
    this.disconnect();
    this.setStatus("closed");
  }
  private async recheckAuthentication() {
    if (this.authenticationCheck || this.disposed) return;
    this.authenticationCheck = true;
    this.stopped = true;
    this.disconnect();
    this.setStatus("closed");
    try {
      if (!(await this.options.checkAuthentication()))
        this.options.onAuthenticationLost();
    } catch {
      /* A failed read is not proof that the login expired; stay closed. */
    } finally {
      this.authenticationCheck = false;
    }
  }
  private disconnect() {
    ++this.generation;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.retryTimer = undefined;
    this.heartbeatTimer = undefined;
    const old = this.socket;
    this.socket = null;
    this.pendingPings.clear();
    this.subscriptions.clear();
    if (old) {
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      old.close(1000);
    }
    for (const entry of this.entries.values()) {
      if (entry.state.phase === "closed") continue;
      entry.state = {
        ...entry.state,
        phase: "subscribing",
        activeAttempt: null,
        reason: "reconnecting",
      };
      this.notify(entry);
    }
  }
  private reconnect() {
    this.disconnect();
    this.scheduleReconnect();
  }
  private scheduleReconnect() {
    if (this.disposed || this.stopped || !this.entries.size || this.retryTimer)
      return;
    this.setStatus("backoff");
    const base = Math.min(
      30_000,
      1000 * 2 ** Math.min(5, this.backoffAttempt++),
    );
    const delay = Math.min(
      30_000,
      base * (0.8 + (this.options.random?.() ?? Math.random()) * 0.4),
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }
  dispose() {
    this.disposed = true;
    this.disconnect();
    for (const entry of this.entries.values()) {
      entry.state = {
        ...initialConversationState(entry.sessionId, ""),
        phase: "closed",
        reason: "disposed",
      };
      this.notify(entry);
    }
    this.entries.clear();
    this.observations.clear();
    this.setStatus("closed");
    this.connectionListeners.clear();
  }
}
