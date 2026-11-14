import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { AgentCommandStore } from "@/features/agents/data/command-store";
import {
  ConversationSendFlow,
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
      project_context_id: null,
      model_selection: {
        model_binding_id: "8",
        thinking_option_key: "default",
      },
    },
  },
  text: "原始问题",
  files: [new File(["log"], "server.log")],
  file_refs: [],
});
beforeEach(() => {
  mock.mockReset();
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
});
afterEach(() => vi.unstubAllGlobals());

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
    stage: "upload",
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
    "/agents/sessions/10/attachments",
    "/agents/sessions/10/attachments",
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
    files: [],
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
