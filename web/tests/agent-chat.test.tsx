import { ApiError, request, type RequestOptions } from "@/api/client";
import { useState } from "react";
import { AgentSessionPage } from "@/areas/workspace/pages/session-page";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { FileView, MessageContent } from "@/features/agents/chat/content";
import { InteractionCard } from "@/features/agents/chat/interactions";
import { QueuePanel } from "@/features/agents/chat/queue-panel";
import { SessionFiles } from "@/features/agents/chat/session-files";
import { ConversationTimeline } from "@/features/agents/chat/timeline";
import {
  ContextUsage,
  tokenPercent,
} from "@/features/agents/chat/context-usage";
import { AgentRuntimeProvider } from "@/features/agents/data/agent-runtime";
import type { DurableRecord } from "@/types/agent-events";
import type { AgentInput, SessionDetail } from "@/types/agents";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { question, records, session, snapshot, time } from "./fixtures/agents";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1", role: "admin" } }),
}));
const mock = vi.mocked(request);
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
const response = (data: unknown, etag = '"v1"') => ({
  data,
  status: 200,
  etag,
});
let current: SessionDetail;
const intersectionCallbacks: IntersectionObserverCallback[] = [];
const sockets: Socket[] = [];
class Socket {
  subscriptionId = "";
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror = null;
  constructor() {
    sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 3) {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      }
    });
  }
  send(text: string) {
    const value = JSON.parse(text) as { type: string; subscription_id: string };
    if (value.type === "subscribe") {
      this.subscriptionId = value.subscription_id;
      queueMicrotask(() =>
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(snapshot(value.subscription_id, current)),
          }),
        ),
      );
    }
  }
  close() {
    this.readyState = 3;
  }
}
let override: ((url: string, options: RequestOptions) => unknown) | undefined;
beforeEach(() => {
  current = structuredClone(session);
  override = undefined;
  intersectionCallbacks.length = 0;
  sockets.length = 0;
  mock.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  mock.mockImplementation(async (url, options = {}) => {
    const result = override?.(url, options);
    if (result !== undefined) return result as ReturnType<typeof response>;
    if (url === "/agents/sessions/10") return response(current);
    if (url.endsWith("/configuration"))
      return response(current.configuration, '"c1"');
    if (url.endsWith("/preference"))
      return response(current.preference, '"p1"');
    if (url === "/agents/interactions/40") return response(question, '"q1"');
    if (url.endsWith("/capabilities"))
      return response({
        limits: {
          input_text_bytes: 65536,
          input_file_refs: 20,
          attachment_file_bytes: 1048576,
        },
      });
    if (url.endsWith("/view-state"))
      return response({
        ...current.view_state,
        viewed_through_seq: "3",
        unviewed_run_count: 0,
        has_unviewed_result: false,
      });
    if (url.endsWith("/archive"))
      return response({ ...current.configuration, archived_at: time });
    return {
      ...response([]),
      pagination: { page: 1, page_size: 20, total: 0 },
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(element: React.ReactNode, route = "/agents/sessions/10") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={cache}>
            <NavigationGuardProvider>
              <AgentRuntimeProvider>
                <Outlet />
              </AgentRuntimeProvider>
            </NavigationGuardProvider>
          </QueryClientProvider>
        ),
        children: [{ path: "/agents/sessions/:sessionId", element }],
      },
    ],
    { initialEntries: [route] },
  );
  return {
    cache,
    ...render(<RouterProvider router={router} />),
    user: userEvent.setup(),
  };
}
it("renders long chat Markdown without document navigation", () => {
  const { container } = mount(
    <MessageContent
      sessionId="10"
      blocks={[
        {
          type: "text",
          text: "# 总结\n正文\n\n## 细节\n内容\n\n### 结果\n完成",
        },
      ]}
    />,
  );
  expect(screen.getByRole("heading", { name: "总结" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "目录" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "文档目录" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".has-directory")).toBeNull();
});
it("shows measured reasoning time on collapsed rows without inventing old timings", () => {
  mount(
    <MessageContent
      sessionId="10"
      blocks={[
        { type: "reasoning", text: "新思考", duration_ms: 2530 },
        { type: "reasoning", text: "旧思考" },
      ]}
    />,
  );
  expect(
    screen.getByRole("button", { name: /思考\s*用时 2 秒/ }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /^思考$/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
it("calculates token ratios without converting large counts to imprecise numbers", () => {
  expect(tokenPercent("9007199254740992", "18014398509481984")).toBe(50);
  expect(tokenPercent("999999", "1000000")).toBe(99.99);
  expect(tokenPercent("0", "100")).toBe(0);
  expect(tokenPercent(null, "100")).toBeNull();
  expect(tokenPercent("1", "0")).toBeNull();
  expect(tokenPercent("101", "100")).toBeNull();
  expect(tokenPercent("101", "100", true)).toBe(101);
});
it.each([false, true])(
  "shows cache coverage and marks compressed context stale: %s",
  async (stale) => {
    override = (url) =>
      url.endsWith("/usage")
        ? response({
            input_tokens: "30000",
            output_tokens: "1000",
            context: {
              window_tokens: "128000",
              reserved_output_tokens: "8192",
              input_tokens: "32000",
              cache_read_tokens: "0",
              model_call_id: "9",
              observed_at: time,
              stale,
            },
            cache: {
              call_count: 3,
              covered_call_count: 2,
              input_tokens: "10000",
              cache_read_tokens: "8000",
              cache_write_tokens: null,
            },
          })
        : undefined;
    const { user } = mount(<ContextUsage sessionId="10" />);
    await user.click(
      await screen.findByRole("button", {
        name: `上下文 ${stale ? "—" : "25%"}，缓存命中 0%，查看用量`,
      }),
    );
    expect(await screen.findByText("80%")).toBeVisible();
    expect(screen.getByText("2 / 3 次")).toBeVisible();
    expect(screen.getByText(/部分请求未提供有效缓存计数/)).toBeVisible();
    if (stale)
      expect(
        screen.getByText("上下文已压缩，等待下一次请求更新占用。"),
      ).toBeVisible();
  },
);
it("keeps Shift+Enter as a newline without sending the draft", async () => {
  const { user } = mount(<AgentSessionPage />);
  const input = await screen.findByRole("textbox", { name: "消息内容" });
  await user.type(input, "第一行");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  await user.type(input, "第二行");
  expect(input).toHaveValue("第一行\n第二行");
  expect(
    mock.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
it("requires answering a waiting turn instead of retrying the ended run", async () => {
  current.view_state!.latest_result!.status = "waiting_input";
  mount(<AgentSessionPage />);
  await screen.findByText("已完成配置核对。");
  expect(
    screen.queryByRole("button", { name: "继续上次任务" }),
  ).not.toBeInTheDocument();
});

it.each([false, true])(
  "projects physical settlement without rewriting the ended result: %s",
  (settled) => {
    const ended = records.find((record) => record.event_type === "run/ended")!;
    const history: DurableRecord[] = [
      {
        ...ended,
        data: { ...ended.data, physical_activity_state: "reconciling" },
      },
    ];
    if (settled)
      history.push({
        ...ended,
        seq: "90",
        event_type: "run/settled",
        data: {
          run_id: ended.data.run_id,
          settled_at: time,
          physical_activity_state: "none",
        },
      });
    mount(
      <ConversationTimeline records={history} sessionId="10" attempt={null} />,
    );
    expect(screen.queryByText("环境活动仍需核实") !== null).toBe(!settled);
  },
);

it("refreshes sidebar and attention on committed lifecycle changes, not token chunks", async () => {
  current.state.active_run_id = "21";
  current.state.active_run_status = "running";
  const { cache } = mount(<AgentSessionPage />);
  const invalidations = vi.spyOn(cache, "invalidateQueries");
  await screen.findByText("已完成配置核对。");
  await waitFor(() =>
    expect(invalidations).toHaveBeenCalledWith({
      queryKey: ["agent-sessions"],
    }),
  );
  invalidations.mockClear();
  const socket = sockets.at(-1)!;
  const inject = (frame: object) =>
    socket.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          subscription_id: socket.subscriptionId,
          session_id: "10",
          ...frame,
        }),
      }),
    );
  await act(async () => {
    inject({
      type: "assistant_stream",
      kind: "start",
      runtime_epoch: "e1",
      revision: "1",
      index: 0,
      attempt_id: "100",
      run_id: "21",
      step: 1,
      content: [],
    });
    inject({
      type: "assistant_stream",
      kind: "chunk",
      runtime_epoch: "e1",
      revision: "2",
      index: 1,
      attempt_id: "100",
      delta: { type: "text_delta", block_index: 0, text: "正在生成" },
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(invalidations).not.toHaveBeenCalledWith({
    queryKey: ["agent-sessions"],
  });
  expect(invalidations).not.toHaveBeenCalledWith({
    queryKey: ["workspace-attention"],
  });
  expect(invalidations).not.toHaveBeenCalledWith({
    queryKey: ["agent-session", "10", "workspace", "usage"],
  });
  await act(async () =>
    inject({
      type: "event",
      schema_version: 1,
      seq: "4",
      run_id: "21",
      occurred_at: time,
      event_type: "run/ended",
      data: {
        run_id: "21",
        status: "succeeded",
        reason_code: null,
        finished_at: time,
        usage_completeness: "unknown",
        physical_activity_state: "none",
      },
    }),
  );
  await waitFor(() =>
    expect(invalidations).toHaveBeenCalledWith({
      queryKey: ["agent-sessions"],
    }),
  );
  expect(invalidations).toHaveBeenCalledWith({
    queryKey: ["workspace-attention"],
  });
  expect(invalidations).toHaveBeenCalledWith({
    queryKey: ["agent-session", "10", "workspace", "usage"],
  });
});
it("never marks a result from initial detail or subscription; only a visible foreground terminal record", async () => {
  mount(<AgentSessionPage />);
  await screen.findByText("已完成配置核对。");
  expect(
    mock.mock.calls.filter(([url]) => url.endsWith("/view-state")),
  ).toHaveLength(0);
  await act(async () => {
    for (const callback of intersectionCallbacks)
      callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
  });
  await waitFor(() =>
    expect(
      mock.mock.calls.filter(([url]) => url.endsWith("/view-state")),
    ).toHaveLength(1),
  );
  expect(
    mock.mock.calls.find(([url]) => url.endsWith("/view-state"))?.[1]?.body,
  ).toEqual({ through_seq: "3" });
});
it("keeps archived conversations and files read only, while restore remains explicit", async () => {
  current.configuration.archived_at = time;
  const { user } = mount(<AgentSessionPage />);
  await screen.findByText("已完成配置核对。");
  expect(
    screen.queryByRole("textbox", { name: "消息内容" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "压缩上下文" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复会话" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "会话的操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "附件与成果" }));
  expect(
    screen.queryByRole("button", { name: /删除|引用到消息/ }),
  ).not.toBeInTheDocument();
  expect(
    mock.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
it("keeps the draft and focus when the supplementary workspace is collapsed", async () => {
  const { user } = mount(<AgentSessionPage />);
  const input = await screen.findByRole("textbox", { name: "消息内容" });
  await user.type(input, "继续核对这个长任务，保留我的草稿。");
  expect(
    screen.queryByRole("complementary", { name: "会话工作区" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开会话工作区" }));
  const workspace = screen.getByRole("complementary", { name: "会话工作区" });
  await user.click(
    within(workspace).getByRole("button", { name: "收起会话工作区" }),
  );
  expect(
    screen.queryByRole("complementary", { name: "会话工作区" }),
  ).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "打开会话工作区" });
  expect(toggle).toHaveFocus();
  expect(input).toHaveValue("继续核对这个长任务，保留我的草稿。");
  await user.click(toggle);
  expect(
    screen.getByRole("complementary", { name: "会话工作区" }),
  ).toBeVisible();
  expect(input).toHaveValue("继续核对这个长任务，保留我的草稿。");
  expect(
    mock.mock.calls.filter(([url]) => url.endsWith("/view-state")),
  ).toHaveLength(0);
});
it("keeps stop and queue controls accessible while active-session maintenance stays disabled", async () => {
  current.state.active_run_id = "21";
  current.state.active_run_status = "running";
  const { user } = mount(<AgentSessionPage />);
  await screen.findByRole("textbox", { name: "消息内容" });
  expect(screen.getByRole("button", { name: "停止任务" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "会话的操作" }));
  expect(
    await screen.findByRole("menuitem", { name: /待处理输入/ }),
  ).not.toHaveAttribute("aria-disabled", "true");
  expect(
    await screen.findByRole("menuitem", { name: "归档会话" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(
    await screen.findByRole("menuitem", { name: "压缩上下文" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(
    mock.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
it("renders Markdown reports safely and retains the authenticated original download", async () => {
  override = (url) =>
    url === "/agents/files/90"
      ? response({
          id: "90",
          filename: "排查报告.md",
          media_type: "text/plain",
          size_bytes: "128",
          preview_available: true,
          download_url: "/api/v1/agents/files/90/content",
        })
      : undefined;
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        '# 排查结论\n\n- 已核对\n\n<img src="https://example.invalid/track" onerror="alert(1)">\n\n[不安全链接](javascript:alert(1))',
        { headers: { "Content-Type": "text/plain;charset=utf-8" } },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const { container } = mount(<FileView id="90" sessionId="10" />);
  expect(
    await screen.findByRole("heading", { name: "排查结论" }),
  ).toBeVisible();
  expect(screen.getByText("已核对").closest("li")).not.toBeNull();
  expect(
    container.querySelector("img,script,[onerror],a[href^='javascript:']"),
  ).toBeNull();
  expect(screen.getByRole("link", { name: "下载文件" })).toHaveAttribute(
    "href",
    "/api/v1/agents/files/90/content",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps unavailable usage distinct from an actual zero in the keyboard-accessible context tab", async () => {
  override = (url) =>
    url.endsWith("/usage")
      ? response({
          input_tokens: "2345",
          output_tokens: "120",
          cache_read_tokens: "0",
          cache_write_tokens: null,
          usage_completeness: "partial",
        })
      : undefined;
  const { user } = mount(<AgentSessionPage />);
  await user.click(
    await screen.findByRole("button", { name: "打开会话工作区" }),
  );
  const first = await screen.findByRole("tab", { name: /^进度$/ });
  first.focus();
  await user.keyboard("{End}");
  const context = screen.getByRole("tab", { name: /^上下文$/ });
  expect(context).toHaveFocus();
  await screen.findByText("部分数据");
  const panel = screen.getByRole("tabpanel", { name: "上下文" });
  expect(within(panel).getByText("未提供")).toBeVisible();
  expect(within(panel).getByText("0")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "消息内容" })).toBeEnabled();
});
it("recovers a restore configuration conflict explicitly and uses a fresh request key", async () => {
  current.configuration.archived_at = time;
  let attempts = 0;
  override = (url) => {
    if (url.endsWith("/configuration"))
      return response(current.configuration, attempts ? '"c2"' : '"c1"');
    if (url.endsWith("/restore")) {
      attempts++;
      if (attempts === 1)
        throw new ApiError("VERSION_CONFLICT", "配置已变化", 412);
      return response({ ...current.configuration, archived_at: null }, '"c3"');
    }
  };
  const { user } = mount(<AgentSessionPage />);
  await user.click(await screen.findByRole("button", { name: "恢复会话" }));
  await user.click(
    await screen.findByRole("button", { name: "读取最新会话配置" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("配置已变化")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "恢复会话" }));
  await waitFor(() => expect(attempts).toBe(2));
  const calls = mock.mock.calls.filter(([url]) => url.endsWith("/restore"));
  expect(calls[0][1]?.etag).toBe('"c1"');
  expect(calls[1][1]?.etag).toBe('"c2"');
  expect(calls[1][1]?.idempotencyKey).not.toBe(calls[0][1]?.idempotencyKey);
});
it("steers the saved input revision instead of reusing the pre-edit version", async () => {
  let input: AgentInput = {
    id: "70",
    session_id: "10",
    kind: "message",
    content: [{ type: "text", text: "原内容" }],
    file_refs: [],
    question_answer: null,
    origin_kind: "human",
    actor_ref: { kind: "user", id: "1" },
    source_ref: null,
    delivery: "next_turn",
    state: "pending",
    position: "1",
    queue_deadline_at: time,
    claimed_run_id: null,
    accepted_seq: "4",
    revision: "1",
    version: "i1",
    created_at: time,
    updated_at: time,
    last_modified_by: null,
  };
  override = (url, options) => {
    if (url.includes("/inputs?"))
      return {
        ...response([input]),
        pagination: { page: 1, page_size: 20, total: 1 },
      };
    if (url.endsWith("/inputs/70") && options.method === "PATCH") {
      input = {
        ...input,
        content: [{ type: "text", text: "修订内容" }],
        revision: "2",
        version: "i2",
      };
      return response(input, '"i2"');
    }
    if (url.endsWith("/inputs/70")) return response(input, '"i1"');
  };
  const { user } = mount(
    <QueuePanel
      inline
      sessionId="10"
      archived={false}
      canControl
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const edit = await screen.findByRole("button", { name: "编辑" });
  await user.hover(screen.getByText("原内容"));
  expect(await screen.findByRole("tooltip")).toHaveTextContent("原内容");
  await user.unhover(screen.getByText("原内容", { selector: "p" }));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
  await user.click(edit);
  await user.clear(await screen.findByRole("textbox", { name: "消息正文" }));
  await user.type(
    screen.getByRole("textbox", { name: "消息正文" }),
    "修订内容",
  );
  await user.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText("修订内容");
  expect(
    screen.queryByRole("button", { name: "改为尽快引导" }),
  ).not.toBeInTheDocument();
  expect(mock.mock.calls.some(([url]) => url.endsWith("/steer"))).toBe(false);
});
it("answers a continued question with its independent ETag and preserves a paused reply queue", async () => {
  override = (url) =>
    url.endsWith("/answers")
      ? response({
          interaction_id: "40",
          status: "reply_queued",
          delivery: "next_turn",
          input_id: "60",
          run_id: null,
          queue_paused: true,
          accepted_seq: "4",
        })
      : undefined;
  const { user } = mount(
    <InteractionCard
      id="40"
      sessionId="10"
      status="continued"
      canAnswer
      canApprove={false}
      archived={false}
      onChanged={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("radio", { name: "测试环境" }));
  await user.click(screen.getByRole("button", { name: "提交回答" }));
  await screen.findByText("补充回答已加入暂停队列，恢复队列后处理。");
  const action = mock.mock.calls.find(([url]) => url.endsWith("/answers"))?.[1];
  expect(action).toMatchObject({
    method: "POST",
    etag: '"q1"',
    body: {
      skip: false,
      answers: [{ question_id: "q1", option_ids: ["test"], text: null }],
    },
  });
  expect(action?.idempotencyKey).toBeTruthy();
});
it("keeps answers across question pages and submits them together", async () => {
  const questions = question.kind === "question" ? question.questions : [];
  override = (url) =>
    url === "/agents/interactions/40"
      ? response(
          {
            ...question,
            questions: [
              ...questions,
              {
                ...questions[0],
                question_id: "q2",
                prompt: "第二项选择",
              },
            ],
          },
          '"q1"',
        )
      : url.endsWith("/answers")
        ? response({
            interaction_id: "40",
            status: "reply_queued",
            delivery: "next_turn",
            input_id: "60",
            run_id: null,
            queue_paused: false,
            accepted_seq: "4",
          })
        : undefined;
  const { user } = mount(
    <InteractionCard
      id="40"
      sessionId="10"
      status="continued"
      canAnswer
      canApprove={false}
      archived={false}
      onChanged={vi.fn()}
    />,
  );
  await user.click(await screen.findByRole("radio", { name: "测试环境" }));
  await user.click(screen.getByRole("button", { name: "下一题" }));
  expect(screen.getByText("2. 第二项选择")).toBeVisible();
  await user.click(screen.getByRole("radio", { name: /生产环境/ }));
  await user.click(screen.getByRole("button", { name: "上一题" }));
  expect(screen.getByRole("radio", { name: "测试环境" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "下一题" }));
  await user.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() =>
    expect(
      mock.mock.calls.find(([url]) => url.endsWith("/answers"))?.[1]?.body,
    ).toMatchObject({
      answers: [
        { question_id: "q1", option_ids: ["test"] },
        { question_id: "q2", option_ids: ["prod"] },
      ],
    }),
  );
});
it("never presents an expired approval as executable", async () => {
  override = (url) =>
    url === "/agents/interactions/40"
      ? response({
          id: "40",
          kind: "approval",
          status: "pending",
          session_id: "10",
          run_id: "20",
          tool_call_id: "50",
          expires_at: "2000-01-01T00:00:00Z",
          version: "a1",
          action: {
            tool_key: "mcp.example",
            summary: "修改资源",
            arguments: {},
            arguments_hash: "h",
          },
        })
      : undefined;
  mount(
    <InteractionCard
      id="40"
      sessionId="10"
      status="pending"
      canAnswer
      canApprove
      archived={false}
      onChanged={vi.fn()}
    />,
  );
  await screen.findByText("修改资源");
  expect(
    screen.queryByRole("button", { name: "批准本次操作" }),
  ).not.toBeInTheDocument();
});

it("shows a recommendation without selecting it and submits multiple option IDs for one question", async () => {
  if (question.kind !== "question")
    throw new Error("Expected question fixture");
  const initialQuestion = question.questions[0];
  override = (url) =>
    url === "/agents/interactions/40"
      ? response(
          {
            ...question,
            questions: [
              {
                ...initialQuestion,
                type: "multi_choice",
                options: [
                  { id: "test", label: "测试环境", recommended: true },
                  { id: "prod", label: "生产环境" },
                ],
              },
            ],
          },
          '"q1"',
        )
      : url.endsWith("/answers")
        ? response({
            interaction_id: "40",
            status: "reply_queued",
            delivery: "next_turn",
            input_id: "60",
            run_id: null,
            queue_paused: false,
            accepted_seq: "4",
          })
        : undefined;
  const { user } = mount(
    <InteractionCard
      id="40"
      sessionId="10"
      status="continued"
      canAnswer
      canApprove={false}
      archived={false}
      onChanged={vi.fn()}
    />,
  );
  const recommended = await screen.findByRole("checkbox", { name: /测试环境/ });
  expect(recommended).not.toBeChecked();
  expect(screen.getByText("推荐", { exact: true })).toBeVisible();
  expect(screen.getByText("可多选")).toBeVisible();
  await user.click(recommended);
  await user.click(screen.getByRole("checkbox", { name: "生产环境" }));
  await user.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() =>
    expect(
      mock.mock.calls.find(([url]) => url.endsWith("/answers"))?.[1]?.body,
    ).toMatchObject({
      answers: [{ question_id: "q1", option_ids: ["test", "prod"] }],
    }),
  );
});
it("retains a question draft when the waiting window expires", async () => {
  if (question.kind !== "question") throw new Error("Unexpected fixture");
  const questions = [{ ...question.questions[0], type: "text", options: [] }];
  let status = "waiting";
  override = (url) =>
    url === "/agents/interactions/40"
      ? response({ ...question, status, questions }, `"${status}"`)
      : undefined;
  function ExpiringQuestion() {
    const [current, setCurrent] = useState("waiting");
    return (
      <>
        <button
          onClick={() => {
            status = "continued";
            setCurrent(status);
          }}
        >
          模拟超时
        </button>
        <InteractionCard
          id="40"
          sessionId="10"
          status={current}
          canAnswer
          canApprove={false}
          archived={false}
          onChanged={vi.fn()}
        />
      </>
    );
  }
  const { user } = mount(<ExpiringQuestion />);
  const field = await screen.findByRole("textbox", { name: "你的回答" });
  await user.type(field, "仍在填写的回答");
  await user.click(screen.getByRole("button", { name: "收起提问" }));
  expect(field).not.toBeVisible();
  await user.click(screen.getByRole("button", { name: "展开提问" }));
  expect(field).toBeVisible();
  expect(field).toHaveValue("仍在填写的回答");
  await user.click(screen.getByRole("button", { name: "模拟超时" }));
  await screen.findByText("可补充回答");
  expect(screen.getByRole("textbox", { name: "你的回答" })).toBe(field);
  expect(field).toHaveValue("仍在填写的回答");
});

it("renders and copies a late answer without empty text blocks or surrounding blank lines", async () => {
  if (records[0].event_type !== "input/message" || question.kind !== "question")
    throw new Error("Unexpected fixtures");
  const reply: DurableRecord = {
    ...records[0],
    data: {
      ...records[0].data,
      content: [{ type: "text", text: "\n  \n" }],
      question_context: { tool_call_id: "80", questions: question.questions },
      question_answer: {
        skip: false,
        answers: [
          {
            question_id: "q1",
            option_ids: ["test"],
            text: "\r\n补充第一行\r\n补充第二行\r\n",
          },
        ],
      },
    },
  };
  const { container, user } = mount(
    <ConversationTimeline records={[reply]} sessionId="10" attempt={null} />,
  );
  const bubble = container.querySelector(".agent-user-bubble")!;
  expect(bubble.children).toHaveLength(1);
  expect(bubble.textContent).toBe("测试环境；补充第一行\n补充第二行");
  await user.click(screen.getByRole("button", { name: "复制消息" }));
  expect(await navigator.clipboard.readText()).toBe(
    "测试环境；补充第一行\n补充第二行",
  );
});

it("does not mark child history as read and keeps the user message on the right", () => {
  const { container } = mount(
    <ConversationTimeline records={records} sessionId="11" attempt={null} />,
  );
  expect(
    container
      .querySelector("article")
      ?.classList.contains("agent-message-user"),
  ).toBe(true);
  expect(mock.mock.calls.some(([url]) => url.endsWith("/view-state"))).toBe(
    false,
  );
});

it("folds reasoning and intermediate replies while retaining the final reply and its mounted content", async () => {
  const thought: DurableRecord = {
    ...records[1],
    seq: "2",
    event_type: "assistant/message",
    data: {
      attempt_id: "thought",
      model_call_id: "29",
      content: [
        { type: "reasoning", text: "核对实际文件后给出结论" },
        { type: "text", text: "我先核对实际文件。" },
        { type: "tool_reference", tool_call_id: "80" },
      ],
      finish_reason: "tool_calls",
    },
  };
  const history = [
    records[0],
    thought,
    { ...records[1], seq: "3" },
    { ...records[2], seq: "4" },
  ];
  const { user } = mount(
    <ConversationTimeline records={history} sessionId="10" attempt={null} />,
  );
  const reply = screen.getByText("已完成配置核对。");
  expect(
    within(
      screen
        .getByText("我先核对实际文件。")
        .closest(".agent-message-assistant") as HTMLElement,
    ).queryByRole("button", { name: "复制回复" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "复制回复" })).toHaveLength(1);
  expect(reply).toBeVisible();
  expect(screen.queryByText("查看工具调用")).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "已完成 · 执行过程" });
  expect(screen.getByText("思考")).toBeVisible();
  await user.click(toggle);
  expect(screen.getByText("思考")).not.toBeVisible();
  expect(screen.getByText("我先核对实际文件。")).not.toBeVisible();
  expect(reply).toBeVisible();
  await user.click(toggle);
  expect(screen.getByText("思考")).toBeVisible();
  expect(screen.getByText("我先核对实际文件。")).toBeVisible();
  await user.click(toggle);
  expect(toggle).toHaveFocus();
  expect(screen.getByText("已完成配置核对。")).toBe(reply);
  expect(reply).toBeVisible();
});

it("retains the turn bar and final reply without an empty fold when streaming completes or history reloads", async () => {
  const draft = {
    attempt_id: "a1",
    run_id: "20",
    step: 1,
    next_index: 2,
    content: [{ type: "text" as const, text: "已完成配置核对。" }],
  };
  const { rerender } = render(
    <ConversationTimeline
      records={[records[0]]}
      sessionId="10"
      attempt={draft}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  const reply = screen.getByText("已完成配置核对。");
  rerender(
    <ConversationTimeline records={records} sessionId="10" attempt={null} />,
  );
  expect(screen.getAllByText("已完成配置核对。")).toHaveLength(1);
  expect(screen.getByText("已完成配置核对。")).toBe(reply);
  const user = userEvent.setup();
  const toggle = screen.getByRole("button", { name: "已完成 · 执行过程" });
  expect(toggle).toBeDisabled();
  expect(toggle).not.toHaveAttribute("aria-expanded");
  await user.click(toggle);
  expect(reply).toBeVisible();
  expect(screen.getByText("请核对发布配置")).toBeVisible();
  await user.click(toggle);
  expect(reply).toBeVisible();
  expect(screen.getByText("已完成配置核对。")).toBe(reply);
  rerender(
    <ConversationTimeline
      key="reloaded"
      records={structuredClone(records)}
      sessionId="10"
      attempt={null}
    />,
  );
  const restored = screen.getByRole("button", { name: "已完成 · 执行过程" });
  expect(restored).toBeDisabled();
  await user.click(restored);
  expect(screen.getByText("已完成配置核对。")).toBeVisible();
});

it("preserves nested disclosure combinations across whole-turn toggles without hiding the final reply", async () => {
  const progress: DurableRecord = {
    ...records[1],
    seq: "2",
    event_type: "assistant/message",
    data: {
      attempt_id: "progress",
      model_call_id: "29",
      finish_reason: "tool_calls",
      content: [{ type: "text", text: "中间进度说明" }],
    },
  };
  const reasoning: DurableRecord = {
    ...progress,
    seq: "3",
    data: {
      ...progress.data,
      attempt_id: "reasoning",
      content: [{ type: "reasoning", text: "展开的思考正文" }],
    },
  };
  const call: DurableRecord = {
    ...records[0],
    seq: "4",
    event_type: "tool/call",
    data: {
      tool_call_id: "80",
      tool_key: "read_file",
      mcp_server_id: null,
      mcp_binding_id: null,
      mcp_tool_name: null,
      arguments: { path: "example.txt" },
      arguments_hash: "hash",
      execution_class: "read_only",
      policy: "allow",
    },
  };
  const result: DurableRecord = {
    ...call,
    seq: "5",
    event_type: "tool/result",
    data: {
      tool_call_id: "80",
      status: "succeeded",
      executed: true,
      content: [{ type: "text", text: "展开的工具正文" }],
      truncated: false,
      outcome: { certainty: "known", reason: null },
    },
  };
  const { user } = mount(
    <ConversationTimeline
      records={[
        records[0],
        progress,
        reasoning,
        call,
        result,
        { ...records[1], seq: "6" },
        { ...records[2], seq: "7" },
      ]}
      sessionId="10"
      attempt={null}
    />,
  );
  const turn = screen.getByRole("button", { name: "已完成 · 执行过程" });
  const group = screen.getByRole("button", { name: "已使用工具 1 次" });
  const reply = screen.getByText("已完成配置核对。");
  expect(
    turn.compareDocumentPosition(screen.getByText("中间进度说明")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  for (const reasoningOpen of [false, true]) {
    for (const toolOpen of [false, true]) {
      for (const groupOpen of [false, true]) {
        if (group.getAttribute("aria-expanded") !== "true")
          await user.click(group);
        const thought = screen.getByRole("button", { name: "思考" });
        const tool = screen.getByRole("button", { name: /读取文件/ });
        if (thought.getAttribute("aria-expanded") !== String(reasoningOpen))
          await user.click(thought);
        if (tool.getAttribute("aria-expanded") !== String(toolOpen))
          await user.click(tool);
        if (!groupOpen) await user.click(group);
        await user.click(turn);
        expect(reply).toBeVisible();
        expect(screen.getByText("中间进度说明")).not.toBeVisible();
        expect(group).not.toBeVisible();
        await user.click(turn);
        expect(reply).toBeVisible();
        expect(screen.getByText("已完成配置核对。")).toBe(reply);
        expect(group).toHaveAttribute("aria-expanded", String(groupOpen));
        expect(thought).toHaveAttribute("aria-expanded", String(reasoningOpen));
        expect(tool).toHaveAttribute("aria-expanded", String(toolOpen));
        if (groupOpen && reasoningOpen)
          expect(screen.getByText("展开的思考正文")).toBeVisible();
        else expect(screen.getByText("展开的思考正文")).not.toBeVisible();
        if (toolOpen && groupOpen)
          expect(screen.getByText("展开的工具正文")).toBeVisible();
        else if (screen.queryByText("展开的工具正文"))
          expect(screen.getByText("展开的工具正文")).not.toBeVisible();
      }
    }
  }
});
it("shows the actual loaded skill version without claiming a filesystem copy", async () => {
  const base = { schema_version: 1 as const, occurred_at: time, run_id: "20" };
  const loaded: DurableRecord[] = [
    {
      ...base,
      seq: "4",
      event_type: "tool/call",
      data: {
        tool_call_id: "80",
        tool_key: "skill",
        mcp_server_id: null,
        mcp_binding_id: null,
        mcp_tool_name: null,
        arguments: { name: "public-check" },
        arguments_hash: "a".repeat(64),
        execution_class: "read_only",
        policy: "allow",
      },
    },
    {
      ...base,
      seq: "5",
      event_type: "tool/result",
      data: {
        tool_call_id: "80",
        status: "succeeded",
        executed: true,
        content: [{ type: "text", text: "公开技能正文" }],
        truncated: false,
        outcome: { certainty: "known", reason: null },
        skill_load: {
          skill_id: "6",
          skill_version_id: "7",
          content_sha256: "b".repeat(64),
          materialized: false,
          stable_path: null,
          relative_path: "SKILL.md",
        },
      },
    },
  ];
  const { user } = mount(
    <ConversationTimeline records={loaded} sessionId="10" attempt={null} />,
  );
  await user.click(screen.getByRole("button", { name: "已使用工具 1 次" }));
  await user.click(screen.getByText("加载技能"));
  expect(screen.getByText(/已加载技能版本 7/)).toBeVisible();
  expect(screen.getByText("技能文本可用，尚无工作目录副本。")).toBeVisible();
  expect(screen.queryByText("工作目录副本已准备。")).not.toBeInTheDocument();
});
it("recognizes a nullable root session and keeps child controls read-only", async () => {
  current.root_session_id = "5";
  mount(<AgentSessionPage />);
  await screen.findByText("已完成配置核对。");
  expect(
    screen.queryByRole("textbox", { name: "消息内容" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^置顶$/ }),
  ).not.toBeInTheDocument();
  expect(mock.mock.calls.some(([url]) => url.endsWith("/view-state"))).toBe(
    false,
  );
});
it("disables archived artifact removal and references even when data arrives late", async () => {
  override = (url) =>
    url.includes("/artifacts?")
      ? {
          ...response([
            {
              id: "80",
              file_id: "90",
              filename: "报告.md",
              description: "保留结果",
              size_bytes: "1024",
              created_at: time,
              version: "f1",
            },
          ]),
          pagination: { total: 1 },
        }
      : undefined;
  mount(
    <SessionFiles
      sessionId="10"
      readonly
      canReference={false}
      onReference={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("报告.md");
  expect(
    screen.queryByRole("button", { name: /删除|引用到消息/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看文件" })).toBeEnabled();
});
