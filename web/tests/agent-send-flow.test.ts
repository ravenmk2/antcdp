import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { AgentCommandStore } from "@/features/agents/data/command-store";
import {
  ConversationSendFlow,
  ConversationSendStore,
  type SendPlan,
} from "@/features/agents/data/send-flow";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
const unknown = new ApiError(
  "NETWORK_ERROR",
  "结果未知",
  0,
  [],
  undefined,
  undefined,
  true,
);
const ok = (data: unknown) => ({ data, etag: "", status: 202 });
function setup() {
  const store = new AgentCommandStore();
  return { store, flow: new ConversationSendFlow(store, "new:user") };
}
const plan = (): SendPlan => ({
  session: {
    create: {
      agent_id: "4",
      title: "故障排查",
      model_selection: {
        model_binding_id: "8",
        thinking_option_key: "default",
      },
    },
  },
  text: "原始问题",
  images: [new File(["image"], "screen.png", { type: "image/png" })],
  workspaceFiles: [],
  file_refs: [],
});
beforeEach(() => {
  mock.mockReset();
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("publishes an accepted transcript echo with uploaded references and retains it across composer reset", async () => {
  const commands = new AgentCommandStore();
  const sends = new ConversationSendStore(commands);
  const flow = sends.get("new:user");
  mock
    .mockResolvedValueOnce(
      ok({
        configuration: { id: "10" },
        selection: { model_selection_hash: "original" },
      }),
    )
    .mockResolvedValueOnce(ok({ id: "90" }))
    .mockRejectedValueOnce(unknown);
  await flow.start({ ...plan(), placement: "transcript" });
  expect(sends.submissions("10")).toHaveLength(0);
  mock.mockResolvedValueOnce(ok({ input_id: "11" }));
  await flow.recover("retry");
  expect(sends.submissions("10")).toEqual([
    expect.objectContaining({
      inputId: "11",
      text: "原始问题",
      fileRefs: [{ kind: "attachment", id: "90" }],
    }),
  ]);
  flow.reset();
  expect(sends.submissions("10")).toHaveLength(1);
  sends.retire("10", new Set(["11"]));
  expect(sends.submissions("10")).toHaveLength(0);
  mock.mockResolvedValueOnce(ok({ input_id: "12" }));
  await flow.start({
    session: { id: "10", selection_hash: "original" },
    text: "排队内容",
    images: [],
    workspaceFiles: [],
    file_refs: [],
    placement: "queued",
  });
  expect(sends.submissions("10")).toHaveLength(0);
  sends.dispose();
  commands.dispose();
});

it("resumes an uncertain upload with its original key without recreating the session", async () => {
  const { flow, store } = setup();
  mock
    .mockResolvedValueOnce(
      ok({
        configuration: { id: "10" },
        selection: { model_selection_hash: "original" },
      }),
    )
    .mockRejectedValueOnce(unknown);
  await flow.start(plan());
  expect(flow.getSnapshot()).toMatchObject({
    phase: "uncertain",
    stage: "image",
    sessionId: "10",
    uploadIndex: 0,
  });
  const original = mock.mock.calls[1][1];
  mock
    .mockResolvedValueOnce(ok({ id: "90" }))
    .mockResolvedValueOnce(ok({ input_id: "11" }));
  await flow.recover("retry");
  expect(mock.mock.calls.map(([url]) => url)).toEqual([
    "/agents/sessions",
    "/agents/sessions/10/attachments?kind=image",
    "/agents/sessions/10/attachments?kind=image",
    "/agents/sessions/10/inputs",
  ]);
  expect(mock.mock.calls[2][1]).toEqual(original);
  expect(mock.mock.calls[3][1]?.body).toEqual({
    content: [{ type: "text", text: "原始问题" }],
    file_refs: [{ kind: "attachment", id: "90" }],
    expected_model_selection_hash: "original",
  });
  expect(flow.getSnapshot().phase).toBe("accepted");
  store.dispose();
});
it("holds acknowledged attachments and needs explicit acceptance of a changed model selection", async () => {
  const { flow, store } = setup();
  mock
    .mockResolvedValueOnce(
      ok({
        configuration: { id: "10" },
        selection: { model_selection_hash: "old" },
      }),
    )
    .mockResolvedValueOnce(ok({ id: "90" }))
    .mockRejectedValueOnce(
      new ApiError("MODEL_SELECTION_CHANGED", "模型选择已变更", 409),
    );
  await flow.start(plan());
  expect(flow.remainingDraft()).toEqual({
    text: "原始问题",
    images: [],
    workspaceFiles: [],
    file_refs: [{ kind: "attachment", id: "90" }],
  });
  const oldKey = mock.mock.calls[2][1]?.idempotencyKey;
  mock.mockResolvedValueOnce(ok({ input_id: "12" }));
  await flow.retryKnown("new-confirmed");
  expect(mock.mock.calls).toHaveLength(4);
  expect(mock.mock.calls[3][1]?.idempotencyKey).not.toBe(oldKey);
  expect(mock.mock.calls[3][1]?.body).toMatchObject({
    expected_model_selection_hash: "new-confirmed",
    file_refs: [{ kind: "attachment", id: "90" }],
  });
  store.dispose();
});
it("does not treat an absent receipt as nonexecution or allow replacing the draft mid-send", async () => {
  const { flow, store } = setup();
  mock.mockRejectedValueOnce(unknown);
  await flow.start(plan());
  flow.reset();
  await flow.start({ ...plan(), text: "不同的问题" });
  expect(mock.mock.calls).toHaveLength(1);
  mock.mockRejectedValueOnce(new ApiError("NOT_FOUND", "未找到", 404));
  await flow.recover("receipt");
  expect(flow.getSnapshot()).toMatchObject({
    phase: "uncertain",
    receiptMissing: true,
    plan: { text: "原始问题" },
  });
  flow.dispose();
  store.dispose();
});

it("prepares the first workspace, submits verified upload keys separately from text and image refs", async () => {
  const { flow, store } = setup();
  vi.useFakeTimers();
  try {
    mock
      .mockResolvedValueOnce(
        ok({
          configuration: { id: "10" },
          selection: { model_selection_hash: "locked" },
        }),
      )
      .mockResolvedValueOnce(ok({ id: "90" }))
      .mockResolvedValueOnce(ok({ status: "preparing", operation_id: "21" }))
      .mockResolvedValueOnce(ok({ status: "succeeded" }))
      .mockResolvedValueOnce(
        ok({
          status: "succeeded",
          result: { path: "sessions/10/sales (2).csv" },
        }),
      );
    mock.mockResolvedValueOnce(ok({ input_id: "11" }));
    const sending = flow.start({
      ...plan(),
      workspaceFiles: [{ file: new File(["a,b"], "sales.csv") }],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await sending;
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      "/agents/sessions",
      "/agents/sessions/10/attachments?kind=image",
      "/agents/sessions/10/workspace/prepare",
      "/agents/sessions/10/workspace/operations/21",
      "/agents/sessions/10/workspace/file-uploads",
      "/agents/sessions/10/inputs",
    ]);
    expect(mock).toHaveBeenLastCalledWith(
      "/agents/sessions/10/inputs",
      expect.objectContaining({
        body: {
          content: [
            {
              type: "text",
              text: "原始问题",
            },
          ],
          workspace_upload_keys: [mock.mock.calls[4][1]?.idempotencyKey],
          file_refs: [{ kind: "attachment", id: "90" }],
          expected_model_selection_hash: "locked",
        },
      }),
    );
    expect(mock).toHaveBeenCalledTimes(6);
    expect(flow.getSnapshot().phase).toBe("accepted");
  } finally {
    vi.useRealTimers();
    flow.dispose();
    store.dispose();
  }
});

it("recovers a lost workspace receipt and skips a failed file without uploading the saved file again", async () => {
  const { flow, store } = setup();
  mock.mockRejectedValueOnce(unknown);
  await flow.start({
    ...plan(),
    session: { id: "10", selection_hash: "locked", workspaceReady: true },
    images: [],
    workspaceFiles: ["saved.txt", "failed.txt"].map((name) => ({
      file: new File([name], name),
    })),
  });
  expect(flow.getSnapshot()).toMatchObject({
    phase: "uncertain",
    stage: "workspace",
  });
  const key = mock.mock.calls[0][1]?.idempotencyKey;
  await flow.recover("retry");
  expect(mock).toHaveBeenCalledTimes(1);
  mock
    .mockResolvedValueOnce(
      ok({
        response_data: {
          status: "succeeded",
          result: { path: "sessions/10/saved.txt" },
        },
      }),
    )
    .mockRejectedValueOnce(new ApiError("UPLOAD_TOO_LARGE", "附件太大", 413));
  await flow.recover("receipt");
  expect(mock.mock.calls[1][0]).toBe(
    `/agents/command-receipts/${key}?command=workspace.session_upload&scope=session%3A10`,
  );
  expect(flow.getSnapshot()).toMatchObject({
    phase: "failed",
    stage: "workspace",
    workspaceIndex: 1,
  });
  mock.mockResolvedValueOnce(ok({ input_id: "11" }));
  await flow.removeFailedWorkspaceFiles();
  expect(flow.getSnapshot().phase).toBe("accepted");
  expect(mock.mock.calls.map(([url]) => url).slice(2)).toEqual([
    "/agents/sessions/10/workspace/file-uploads",
    "/agents/sessions/10/inputs",
  ]);
  expect(mock.mock.calls[3][1]?.body).toMatchObject({
    file_refs: [],
    workspace_upload_keys: [key],
    content: [{ type: "text", text: "原始问题" }],
  });
  flow.dispose();
  store.dispose();
});
