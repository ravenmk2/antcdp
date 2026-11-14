import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStreamClient } from "@/features/agents/data/stream-client";
import type { SnapshotFrame } from "@/types/agent-events";

class TestSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(data: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code }));
  }
  frames() {
    return this.sent.map(
      (raw) =>
        JSON.parse(raw) as {
          type: string;
          subscription_id: string;
          session_id: string;
          nonce: string;
        },
    );
  }
}
function setup(maxSubscriptions = 8) {
  vi.useFakeTimers();
  const sockets: TestSocket[] = [];
  const check = vi.fn(async () => false);
  const lost = vi.fn();
  const client = new AgentStreamClient({
    createSocket: () => {
      const socket = new TestSocket();
      sockets.push(socket);
      return socket;
    },
    checkAuthentication: check,
    onAuthenticationLost: lost,
    random: () => 0.5,
    maxSubscriptions,
  });
  return { client, sockets, check, lost };
}

it("batches chunks while immediately publishing terminal and revoked state", () => {
  const { client, sockets } = setup();
  const observer = client.observe("10"),
    notify = vi.fn();
  observer.subscribe(notify);
  sockets[0].open();
  const id = sockets[0].frames()[0].subscription_id;
  const initial = frame(id);
  sockets[0].receive(initial);
  const base = {
    type: "assistant_stream",
    subscription_id: id,
    session_id: "10",
    runtime_epoch: initial.stream.runtime_epoch,
    attempt_id: "30",
  };
  const revision = BigInt(initial.stream.revision);
  sockets[0].receive({
    ...base,
    revision: String(revision + 1n),
    index: 0,
    kind: "start",
    run_id: "20",
    step: 1,
    content: [],
  });
  notify.mockClear();
  for (let n = 1; n <= 20; n++)
    sockets[0].receive({
      ...base,
      revision: String(revision + BigInt(n) + 1n),
      index: n,
      kind: "chunk",
      delta: { type: "text_delta", block_index: 0, text: "片段" },
    });
  expect(notify).not.toHaveBeenCalled();
  expect(observer.getSnapshot().activeAttempt?.content[0]).toEqual({
    type: "text",
    text: "片段".repeat(20),
  });
  vi.advanceTimersByTime(20);
  expect(notify).toHaveBeenCalledOnce();
  notify.mockClear();
  sockets[0].receive({
    ...base,
    revision: String(revision + 22n),
    index: 21,
    kind: "chunk",
    delta: { type: "text_delta", block_index: 0, text: "末尾" },
  });
  sockets[0].receive({
    ...base,
    revision: String(revision + 23n),
    index: 22,
    kind: "end",
    outcome: { kind: "abandoned", reason: "cancelled" },
  });
  expect(notify).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(20);
  expect(notify).toHaveBeenCalledOnce();
  sockets[0].receive({
    type: "access_revoked",
    subscription_id: id,
    code: "FORBIDDEN",
  });
  expect(observer.getSnapshot().records).toHaveLength(0);
  expect(observer.getSnapshot().snapshot).toBeNull();
  client.dispose();
});
function frame(subscriptionId: string, sessionId = "10"): SnapshotFrame {
  return {
    type: "snapshot",
    subscription_id: subscriptionId,
    session_id: sessionId,
    through_seq: "8",
    state: {
      configuration: {
        id: sessionId,
        agent_id: "1",
        agent_type: "interactive",
        title: "会话",
        project_context_id: null,
        model_selection: {
          model_binding_id: "1",
          thinking_option_key: "default",
        },
        model_locked_at: null,
        archived_at: null,
        version: "v1",
        created_at: "2026-11-09T00:00:00Z",
        updated_at: "2026-11-09T00:00:00Z",
      },
      selection: {
        model_binding_id: "1",
        thinking_option_key: "default",
        model_definition_id: "1",
        provider_label: "DeepSeek",
        model_name: "研发",
        model_id: "chat",
        protocol: "chat_completions",
        thinking_label: "默认",
        effective_parameters: {},
        model_selection_hash: "hash",
        locked: false,
        availability: { available: true, reason: null },
      },
      permissions: {
        read: true,
        submit: true,
        answer: true,
        control: true,
        manage: true,
        approve: true,
      },
      view_state: null,
      run_id: "20",
      run_status: "running",
      queue_paused: false,
      inputs: [],
      input_total: 0,
      inputs_truncated: false,
      interactions: [],
      interaction_total: 0,
      interactions_truncated: false,
    },
    records: [],
    before_seq: "9",
    has_more: true,
    stream: { runtime_epoch: "e1", revision: "0", active_attempt: null },
  };
}
afterEach(() => vi.useRealTimers());

describe("agent stream transport", () => {
  it("shares observers created before either component subscribes", () => {
    const { client, sockets } = setup();
    const first = client.observe("10"),
      second = client.observe("10");
    expect(first).toBe(second);
    const end1 = first.subscribe(vi.fn()),
      end2 = second.subscribe(vi.fn());
    sockets[0].open();
    expect(sockets[0].frames()).toHaveLength(1);
    end1();
    expect(sockets[0].readyState).toBe(1);
    end2();
    expect(sockets[0].readyState).toBe(3);
    client.dispose();
  });
  it("shares a connection and unsubscribes without sending execution commands", () => {
    const { client, sockets } = setup();
    const first = client.observe("10"),
      second = client.observe("11");
    const release1 = first.subscribe(vi.fn()),
      release2 = second.subscribe(vi.fn());
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    const subscriptions = sockets[0].frames();
    expect(subscriptions.map((item) => item.type)).toEqual([
      "subscribe",
      "subscribe",
    ]);
    expect(
      new Set(subscriptions.map((item) => item.subscription_id)).size,
    ).toBe(2);
    release1();
    expect(sockets[0].readyState).toBe(1);
    expect(sockets[0].frames().at(-1)?.type).toBe("unsubscribe");
    release2();
    expect(sockets[0].readyState).toBe(3);
    expect(client.getConnectionStatus()).toBe("disconnected");
    vi.advanceTimersByTime(120000);
    expect(sockets).toHaveLength(1);
    client.dispose();
  });

  it("reconnects with a new snapshot subscription and ignores callbacks from the old socket", () => {
    const { client, sockets } = setup();
    const observer = client.observe("10");
    observer.subscribe(vi.fn());
    sockets[0].open();
    const oldId = sockets[0].frames()[0].subscription_id;
    sockets[0].receive(frame(oldId));
    const oldMessage = sockets[0].onmessage;
    expect(observer.getSnapshot().phase).toBe("live");
    sockets[0].serverClose(1006);
    expect(client.getConnectionStatus()).toBe("backoff");
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    const newId = sockets[1].frames()[0].subscription_id;
    expect(newId).not.toBe(oldId);
    expect(observer.getSnapshot().phase).toBe("subscribing");
    oldMessage?.(
      new MessageEvent("message", { data: JSON.stringify(frame(oldId)) }),
    );
    expect(observer.getSnapshot().phase).toBe("subscribing");
    sockets[1].receive(frame(newId));
    expect(observer.getSnapshot().phase).toBe("live");
    expect(sockets[1].frames()).toHaveLength(1);
    client.dispose();
  });

  it("requires matched application heartbeats even when ordinary traffic arrives", () => {
    const { client, sockets } = setup();
    const observer = client.observe("10");
    observer.subscribe(vi.fn());
    sockets[0].open();
    const id = sockets[0].frames()[0].subscription_id;
    sockets[0].receive(frame(id));
    vi.advanceTimersByTime(30000);
    expect(sockets[0].frames().at(-1)?.type).toBe("ping");
    sockets[0].receive({
      type: "pong",
      nonce: "wrong",
      server_time: new Date().toISOString(),
    });
    vi.advanceTimersByTime(59000);
    sockets[0].receive(frame(id));
    vi.advanceTimersByTime(1000);
    expect(client.getConnectionStatus()).toBe("backoff");
    client.dispose();
  });

  it("retains a healthy connection after a valid pong and closes unauthorized content", () => {
    const { client, sockets } = setup();
    const observer = client.observe("10");
    observer.subscribe(vi.fn());
    sockets[0].open();
    const id = sockets[0].frames()[0].subscription_id;
    sockets[0].receive(frame(id));
    vi.advanceTimersByTime(30000);
    sockets[0].receive({
      type: "pong",
      nonce: sockets[0].frames().at(-1)?.nonce,
      server_time: new Date().toISOString(),
    });
    vi.advanceTimersByTime(60000);
    expect(client.getConnectionStatus()).toBe("open");
    sockets[0].receive({
      type: "access_revoked",
      subscription_id: id,
      code: "FORBIDDEN",
    });
    expect(observer.getSnapshot().snapshot).toBeNull();
    sockets[0].serverClose(1006);
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].frames()).toHaveLength(0);
    expect(observer.getSnapshot().phase).toBe("closed");
    client.dispose();
  });

  it("checks authentication once after a protocol/auth close and never retries indefinitely", async () => {
    const { client, sockets, check, lost } = setup();
    client.observe("10").subscribe(vi.fn());
    sockets[0].open();
    sockets[0].serverClose(1008);
    await vi.runAllTimersAsync();
    expect(check).toHaveBeenCalledOnce();
    expect(lost).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    expect(client.getConnectionStatus()).toBe("closed");
    client.dispose();
  });

  it("limits subscriptions and rejects late HTTP history from a replaced snapshot", () => {
    const { client, sockets } = setup(1);
    const first = client.observe("10"),
      second = client.observe("11");
    first.subscribe(vi.fn());
    second.subscribe(vi.fn());
    expect(second.getSnapshot().reason).toBe("SUBSCRIPTION_LIMIT");
    sockets[0].open();
    const id = sockets[0].frames()[0].subscription_id;
    sockets[0].receive(frame(id));
    const before = first.getSnapshot();
    first.resync();
    first.resync();
    expect(
      sockets[0].frames().filter((item) => item.type === "resync"),
    ).toHaveLength(1);
    sockets[0].receive(frame(id));
    first.mergeHistory(
      {
        session_id: "10",
        through_seq: "8",
        records: [],
        before_seq: null,
        has_more: false,
      },
      id,
      before.baselineGeneration,
    );
    expect(first.getSnapshot().hasMore).toBe(true);
    client.dispose();
  });
});
