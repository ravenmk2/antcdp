import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SendTest, Simulation } from "@/features/sms/Testing";
import { mappingPayload } from "@/features/sms/TemplateEditor";
import type { Template } from "@/shared/sms";
import { request, ApiError } from "@/lib/api";
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
beforeEach(() => {
  mock.mockReset();
});
afterEach(cleanup);
const t = {
  id: "t",
  name: "本地",
  version: "v2",
  mode: "local",
  parameter_schema: { name: { type: "string", required: true } },
  sample_data: { name: "同事" },
} as unknown as Template;
it("performs a local simulation without touching a profile or send-log endpoint", async () => {
  mock.mockResolvedValue({ data: { body: "你好，同事" }, etag: "" });
  const done = vi.fn();
  render(
    <Simulation template={t} tag='"saved"' onClose={() => {}} onDone={done} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "运行模拟" }));
  await screen.findByText("你好，同事");
  expect(mock).toHaveBeenCalledOnce();
  expect(mock).toHaveBeenCalledWith("/admin/sms/templates/t/simulate", {
    method: "POST",
    etag: '"saved"',
    body: { parameters: { name: "同事" } },
  });
  expect(done).toHaveBeenCalledOnce();
});
it("only offers bound remote templates and sends both observed versions", async () => {
  mock.mockImplementation(async (path, opts) => {
    if (opts?.method === "POST")
      throw new ApiError("NETWORK_ERROR", "结果未确认");
    return path.includes("profiles?")
      ? {
          data: { items: [{ id: "p", name: "配置", version: "pv" }], total: 1 },
          etag: "",
        }
      : {
          data: {
            items: [
              t,
              {
                ...t,
                id: "other",
                name: "其他归属",
                mode: "remote",
                profile_id: "other",
              },
              {
                ...t,
                id: "remote",
                name: "远端",
                mode: "remote",
                profile_id: "p",
              },
            ],
            total: 3,
          },
          etag: "",
        };
  });
  const u = userEvent.setup();
  render(<SendTest onClose={() => {}} onDone={() => {}} />);
  const box = await screen.findByLabelText("远端模板");
  expect(within(box).getAllByRole("option")).toHaveLength(1);
  await u.type(screen.getByLabelText(/接收号码/), "13800000000");
  await u.click(screen.getByRole("button", { name: "发送测试短信" }));
  await waitFor(() => expect(screen.getByText(/请核对发送日志/)).toBeTruthy());
  expect(mock).toHaveBeenCalledWith("/admin/sms/profiles/p/test", {
    method: "POST",
    etag: '"pv"',
    body: {
      recipient: "13800000000",
      template: { id: "remote", version: "v2", parameters: { name: "同事" } },
    },
  });
  expect(
    (screen.getByRole("button", { name: "发送测试短信" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("rejects duplicate provider names before constructing a request", () =>
  expect(() =>
    mappingPayload([
      { target: "name", source: "a" },
      { target: "name", source: "b" },
    ]),
  ).toThrow("不能重复"));
