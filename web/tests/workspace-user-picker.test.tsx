import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { WorkspaceUserPicker } from "@/features/workspace/user-picker";
import { request } from "@/api/client";
vi.mock("@/api/client", () => ({ request: vi.fn() }));
it("shows all 105 candidates and retains real avatars on confirmation", async () => {
  const users = Array.from({ length: 105 }, (_, i) => ({
    id: String(i + 1),
    username: `user${i}`,
    display_name: `用户${i}`,
    ...(i === 104 ? { avatar_file_id: "987" } : {}),
  }));
  vi.mocked(request).mockResolvedValue({
    data: users,
    etag: "",
    status: 200,
  });
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceUserPicker
        endpoint="/teams/1/member-options"
        name="user"
        label="成员"
        min={1}
        value={[]}
        onChange={change}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "成员 选择用户" }));
  const dialog = within(screen.getByRole("dialog"));
  const last = await dialog.findByRole("radio", { name: /用户104/ });
  expect(dialog.getAllByRole("radio")).toHaveLength(105);
  expect(dialog.getByRole("img", { name: "用户104的头像" })).toHaveAttribute(
    "src",
    "/api/v1/avatars/987",
  );
  expect(dialog.queryByText(/最多返回/)).not.toBeInTheDocument();
  await user.click(last);
  await user.click(dialog.getByRole("button", { name: "确定" }));
  expect(change).toHaveBeenCalledWith([
    expect.objectContaining({ id: "105", avatar_url: "/api/v1/avatars/987" }),
  ]);
});
