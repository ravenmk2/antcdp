import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestRobot } from "@/features/dingtalk/TestRobot";
import { request, ApiError } from "@/lib/api";
import type { Robot } from "@/shared/dingtalk";
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
afterEach(cleanup);
it("previews the keyword once and sends the unprefixed Markdown body with the opened robot version", async () => {
  vi.mocked(request).mockRejectedValue(
    new ApiError("NETWORK_ERROR", "结果未知"),
  );
  const user = userEvent.setup();
  const robot = {
    id: "8",
    name: "机器人",
    code: "notify",
    enabled: true,
    keyword: "交付",
    description: "",
    version: "original",
  } as Robot;
  render(<TestRobot robot={robot} onClose={() => {}} onDone={() => {}} />);
  await user.selectOptions(screen.getByLabelText("消息格式"), "markdown");
  const title = screen.getByLabelText(/Markdown 标题/);
  await user.clear(title);
  await user.click(screen.getByRole("button", { name: "发送测试消息" }));
  expect(request).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(title));
  await user.type(title, "更新");
  const body = screen.getByLabelText(/消息正文/);
  await user.clear(body);
  await user.type(body, "**完成**");
  expect(document.querySelector("pre")?.textContent).toBe("交付\n**完成**");
  await user.click(screen.getByRole("button", { name: "发送测试消息" }));
  await screen.findByText(/请先核对最近诊断/);
  expect(request).toHaveBeenCalledWith("/admin/dingtalk/robots/8/test", {
    method: "POST",
    etag: '"original"',
    body: { format: "markdown", title: "更新", body: "**完成**" },
  });
  expect(
    (screen.getByRole("button", { name: "发送测试消息" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
