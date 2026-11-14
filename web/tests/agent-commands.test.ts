import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import {
  AgentCommandStore,
  type CommandPlan,
} from "@/features/agents/data/command-store";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
const unknown = new ApiError(
  "NETWORK_ERROR",
  "结果未知",
  0,
  [],
  undefined,
  undefined,
  true,
);
const plan: CommandPlan = {
  domain: "/agents",
  path: "/sessions/10/inputs",
  command: "input.submit",
  scope: "session:10",
  options: {
    method: "POST",
    body: { content: [{ type: "text", text: "原输入" }] },
  },
};
beforeEach(() => {
  mocked.mockReset();
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("holds the original intent across observers, suppresses duplicates, and retries the exact key/body", async () => {
  const store = new AgentCommandStore();
  const command = store.get("session:10:composer");
  let reject!: (error: unknown) => void;
  mocked.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = command.run(plan);
  await command.run(plan);
  expect(mocked).toHaveBeenCalledTimes(1);
  const first = mocked.mock.calls[0][1];
  reject(unknown);
  await pending;
  expect(command.getSnapshot().phase).toBe("uncertain");
  const anotherView = store.get("session:10:composer");
  expect(anotherView).toBe(command);
  await anotherView.run({ ...plan, options: { body: { changed: true } } });
  expect(mocked).toHaveBeenCalledTimes(1);
  mocked.mockResolvedValueOnce({
    data: { input_id: "20" },
    status: 202,
    etag: "",
  });
  await anotherView.retry();
  expect(mocked.mock.calls[1][1]).toEqual(first);
  expect(command.getSnapshot().phase).toBe("succeeded");
  store.dispose();
});

it("does not interpret a missing receipt as nonexecution", async () => {
  const store = new AgentCommandStore(),
    command = store.get("input");
  mocked.mockRejectedValueOnce(unknown);
  await command.run(plan);
  const key = command.getSnapshot().key;
  mocked.mockRejectedValueOnce(new ApiError("NOT_FOUND", "未找到", 404));
  await command.reconcile();
  expect(mocked.mock.calls[1][0]).toBe(
    `/agents/command-receipts/${key}?command=input.submit&scope=session%3A10`,
  );
  expect(command.getSnapshot()).toMatchObject({
    phase: "uncertain",
    key,
    receiptMissing: true,
  });
  mocked.mockResolvedValueOnce({
    data: { response_data: { input_id: "20" }, response_status: 202 },
    status: 200,
    etag: "",
  });
  await command.reconcile();
  expect(command.getSnapshot()).toMatchObject({
    phase: "succeeded",
    response: { data: { input_id: "20" }, status: 202 },
  });
  store.dispose();
});

it("snapshots mutable request data and discards late responses after sign out", async () => {
  const store = new AgentCommandStore(),
    command = store.get("draft");
  let resolve!: (value: {
    data: unknown;
    status: number;
    etag: string;
  }) => void;
  mocked.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const body = { content: [{ type: "text", text: "提交时的内容" }] };
  const pending = command.run({ ...plan, options: { ...plan.options, body } });
  body.content[0].text = "提交后修改";
  expect(mocked.mock.calls[0][1]?.body).toEqual({
    content: [{ type: "text", text: "提交时的内容" }],
  });
  store.dispose();
  resolve({ data: { private: "previous account" }, status: 202, etag: "" });
  await pending;
  expect(command.getSnapshot().response).toBeNull();
});
