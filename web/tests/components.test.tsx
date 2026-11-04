import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { Field } from "@/components/platform/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/platform/form-dialog";
import { AsyncState, EmptyState } from "@/components/platform/feedback";
afterEach(cleanup);
it("associates field errors with the input", () => {
  render(
    <Field label="用户名" error="用户名已存在" required>
      {(props) => <Input {...props} />}
    </Field>,
  );
  const input = screen.getByRole("textbox", { name: "用户名" });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(input.getAttribute("aria-describedby")!)!
      .textContent,
  ).toBe("用户名已存在");
});
it("requires explicit discard for a dirty dialog", async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <FormDialog
      open
      title="编辑资料"
      dirty
      onClose={close}
      footer={(requestClose) => <Button onClick={requestClose}>取消</Button>}
    >
      <Input aria-label="名称" />
    </FormDialog>,
  );
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("未保存");
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(close).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(close).toHaveBeenCalledOnce();
});
it("cannot dismiss a pending operation with Escape or close", async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <FormDialog
      open
      title="保存中"
      pending
      onClose={close}
      footer={<Button disabled>保存中</Button>}
    >
      <p>正在保存</p>
    </FormDialog>,
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).not.toHaveBeenCalled();
});

it("renders actionable empty content only after a successful empty response", async () => {
  const create = vi.fn();
  const user = userEvent.setup();
  const emptyContent = (
    <EmptyState
      title="尚未关联仓库"
      description="关联仓库后，可在产品分支中准备发布。"
      action={<Button onClick={create}>关联仓库</Button>}
    />
  );
  const { rerender } = render(
    <AsyncState loading empty emptyContent={emptyContent}>
      <p>已关联的仓库</p>
    </AsyncState>,
  );
  expect(screen.queryByRole("button", { name: "关联仓库" })).toBeNull();
  rerender(
    <AsyncState
      loading={false}
      error="读取失败"
      empty
      emptyContent={emptyContent}
    >
      <p>已关联的仓库</p>
    </AsyncState>,
  );
  expect(screen.getByRole("alert").textContent).toBe("读取失败");
  expect(screen.queryByRole("button", { name: "关联仓库" })).toBeNull();
  rerender(
    <AsyncState loading={false} empty emptyContent={emptyContent}>
      <p>已关联的仓库</p>
    </AsyncState>,
  );
  expect(screen.getByRole("status").textContent).toContain("尚未关联仓库");
  await user.click(screen.getByRole("button", { name: "关联仓库" }));
  expect(create).toHaveBeenCalledOnce();
  expect(screen.queryByText("已关联的仓库")).toBeNull();
});

function FocusDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>编辑</Button>
      <FormDialog
        open={open}
        title="编辑资料"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>取消</Button>}
      >
        <Input aria-label="名称" />
      </FormDialog>
    </>
  );
}

it("restores pointer-closed dialogs without forcing a keyboard focus outline", async () => {
  const user = userEvent.setup();
  render(<FocusDialog />);
  const opener = screen.getByRole("button", { name: "编辑" });
  const focus = vi.spyOn(opener, "focus");
  await user.click(opener);
  await user.click(screen.getByRole("textbox", { name: "名称" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(focus).toHaveBeenCalledWith({
      preventScroll: true,
      focusVisible: false,
    }),
  );
  expect(document.activeElement).toBe(opener);
});

it("preserves a visible focus target after closing a dialog with Escape", async () => {
  const user = userEvent.setup();
  render(<FocusDialog />);
  const opener = screen.getByRole("button", { name: "编辑" });
  const focus = vi.spyOn(opener, "focus");
  await user.click(opener);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(focus).toHaveBeenCalledWith({
      preventScroll: true,
      focusVisible: true,
    }),
  );
  expect(document.activeElement).toBe(opener);
});
