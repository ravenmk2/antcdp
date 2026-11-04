import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { request, ApiError } from "@/lib/api";
import { SendTest } from "@/features/email/SendTest";
import { previewDocument } from "@/features/email/TemplateEditor";
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
beforeEach(() => {
  mock.mockReset();
});
afterEach(cleanup);
it("submits multipart template parameters against the observed version only once after an unknown result", async () => {
  mock.mockImplementation(async (path, opts) => {
    if (opts?.method === "POST")
      throw new ApiError("NETWORK_ERROR", "结果未知");
    if (path.includes("profiles?"))
      return {
        data: {
          items: [
            {
              id: "7",
              name: "SMTP",
              version: "pv1",
              sender_names: [{ id: "n", name: "开发组", default: true }],
            },
          ],
          total: 1,
        },
        etag: "",
      };
    return {
      data: {
        items: [
          {
            id: "8",
            name: "通知",
            version: "tv1",
            sample_data: { name: "同事" },
          },
        ],
        total: 1,
      },
      etag: "",
    };
  });
  const user = userEvent.setup();
  render(
    <SendTest
      initialProfile="7"
      initialTemplate="8"
      onClose={() => {}}
      onCompleted={() => {}}
    />,
  );
  await user.type(
    await screen.findByLabelText(/收件地址/),
    "test@example.invalid",
  );
  await user.upload(
    screen.getByLabelText(/附件/),
    new File(["a"], "note.txt", { type: "text/plain" }),
  );
  await user.click(screen.getByRole("button", { name: "发送测试邮件" }));
  await waitFor(() => expect(screen.getByText(/请核对发送日志/)).toBeTruthy());
  expect(
    screen.getByRole("link", { name: /查看发送日志/ }).getAttribute("href"),
  ).toBe("/admin/email/send-logs?profile_id=7");
  expect(
    (screen.getByLabelText(/附件/) as HTMLInputElement).files?.length,
  ).toBe(1);
  const writes = mock.mock.calls.filter(([, opts]) => opts?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.[1]?.etag).toBe('"pv1"');
  const data = writes[0]?.[1]?.body as FormData;
  expect(JSON.parse(String(data.get("payload")))).toEqual({
    recipient: "test@example.invalid",
    sender_name_id: "n",
    template: { id: "8", version: "tv1", parameters: { name: "同事" } },
  });
  expect(data.getAll("attachments")).toHaveLength(1);
  expect(
    (screen.getByRole("button", { name: "发送测试邮件" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("places network and form restrictions before the rendered HTML", () => {
  const doc = new DOMParser().parseFromString(
    previewDocument("<img src='https://example.invalid/track'>"),
    "text/html",
  );
  const policy = doc.head
    .querySelector("meta[http-equiv]")
    ?.getAttribute("content");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("form-action 'none'");
  expect(policy).toContain("img-src data:");
});
