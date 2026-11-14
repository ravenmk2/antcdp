import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { UserPicker } from "@/components/user-picker";
const alice = { id: "1", username: "alice", display_name: "Alice" };
const bob = { id: "2", username: "bob", display_name: "Bob" };
function setup({ max = 100, multiple = true, resultLimit = 50 } = {}) {
  const changed = vi.fn();
  const load = vi.fn(async (q: string) =>
    [alice, bob].filter((u) => u.username.includes(q.toLowerCase())),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UserPicker
        name="people"
        label="用户"
        value={[alice]}
        onChange={changed}
        loadOptions={load}
        sourceKey="test"
        multiple={multiple}
        min={1}
        max={max}
        resultLimit={resultLimit}
      />
    </QueryClientProvider>,
  );
  return { changed, load, user: userEvent.setup() };
}
it("preserves selections across searches and discards cancelled changes", async () => {
  const { user, changed } = setup();
  await user.click(screen.getByRole("button", { name: "用户 修改选择" }));
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByRole("checkbox", { name: /Bob/ });
  await user.type(dialog.getByRole("textbox", { name: "搜索用户" }), "bob");
  await user.click(await dialog.findByRole("checkbox", { name: /Bob/ }));
  expect(
    within(dialog.getByRole("region", { name: "已选用户" })).getByText("Alice"),
  ).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "取消" }));
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "用户 修改选择" }));
  const next = within(screen.getByRole("dialog"));
  await user.click(await next.findByRole("checkbox", { name: /Bob/ }));
  await user.click(next.getByRole("button", { name: "确定（2）" }));
  expect(changed).toHaveBeenLastCalledWith([alice, bob]);
});
it("blocks empty confirmation and rejects over-limit bulk selection without truncating", async () => {
  const { user, changed } = setup({ max: 1 });
  await user.click(screen.getByRole("button", { name: "用户 修改选择" }));
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByRole("checkbox", { name: /Bob/ });
  await user.click(dialog.getByRole("button", { name: "全选当前结果（2）" }));
  expect(dialog.getByText(/最多选择 1 位用户/)).toBeVisible();
  expect(dialog.getByRole("checkbox", { name: /Bob/ })).not.toBeChecked();
  await user.click(dialog.getByRole("button", { name: "清空已选" }));
  expect(dialog.getByRole("button", { name: "确定（0）" })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});
it("requires confirmation in single-select mode", async () => {
  const { user, changed } = setup({ multiple: false, max: 1 });
  await user.click(screen.getByRole("button", { name: "用户 修改选择" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.click(await dialog.findByRole("radio", { name: /Bob/ }));
  expect(changed).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "确定" }));
  expect(changed).toHaveBeenLastCalledWith([bob]);
});
it("disables bulk selection for potentially truncated results", async () => {
  const { user } = setup({ resultLimit: 2 });
  await user.click(screen.getByRole("button", { name: "用户 修改选择" }));
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByRole("checkbox", { name: /Bob/ });
  expect(
    dialog.getByRole("button", { name: "全选当前结果（2）" }),
  ).toBeDisabled();
});
