import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pencil, Trash2 } from "lucide-react";
import { RowActions, RowAction } from "@/components/row-actions";
import { Drawer, Modal } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";

function MenuDialog({ sheet = false }: { sheet?: boolean }) {
  const [open, setOpen] = useState(false);
  const Overlay = sheet ? Drawer : Modal;
  const content = open && (
    <Overlay
      open
      title="编辑用户"
      description="维护资料"
      onClose={() => setOpen(false)}
    >
      <input aria-label="显示名称" />
    </Overlay>
  );
  return (
    <>
      <RowActions label="示例用户">
        <RowAction icon={<Pencil />} onSelect={() => setOpen(true)}>
          编辑
        </RowAction>
      </RowActions>
      {sheet ? <OverlayPresence>{content}</OverlayPresence> : content}
    </>
  );
}

function ConditionalDrawer({
  pending = false,
  dirty = false,
}: {
  pending?: boolean;
  dirty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开抽屉</button>
      <OverlayPresence>
        {open && (
          <Drawer
            open
            title="维护材料"
            description="保存草稿"
            dirty={dirty}
            pending={pending}
            onClose={() => setOpen(false)}
          >
            <input aria-label="材料名称" defaultValue="草稿" />
          </Drawer>
        )}
      </OverlayPresence>
    </>
  );
}

describe("row action and drawer interactions", () => {
  it("keeps focus in the form when it replaces a loading drawer", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { rerender, unmount } = render(
      <Drawer
        finalFocus={false}
        key="loading"
        open
        title="加载编辑器"
        onClose={() => {}}
        restoreFocusTo={trigger}
      >
        正在加载
      </Drawer>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus(),
    );
    rerender(
      <Drawer
        key="form"
        open
        title="编辑资料"
        onClose={() => {}}
        restoreFocusTo={trigger}
      >
        <input aria-label="名称" />
      </Drawer>,
    );
    const dialog = await screen.findByRole("dialog", { name: "编辑资料" });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await userEvent.type(screen.getByLabelText("名称"), "草稿");
    expect(screen.getByLabelText("名称")).toHaveValue("草稿");
    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("supports keyboard navigation, disabled items, dispatch once, and Escape focus restoration", async () => {
    const user = userEvent.setup();
    const edit = vi.fn(),
      remove = vi.fn();
    render(
      <RowActions label="用户">
        <RowAction icon={<Pencil />} onSelect={edit}>
          编辑
        </RowAction>
        <RowAction icon={<Trash2 />} disabled onSelect={remove}>
          删除
        </RowAction>
      </RowActions>,
    );
    const trigger = screen.getByRole("button", { name: "用户的操作" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeVisible();
    await user.keyboard("{End}");
    // Base UI keeps disabled menu items discoverable through keyboard focus.
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(remove).not.toHaveBeenCalled();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "编辑" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{Enter}{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("hands focus from a row menu to a dialog and back to its trigger", async () => {
    const user = userEvent.setup();
    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "示例用户的操作" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("hands focus from the menu to the Sheet and returns it on close", async () => {
    const user = userEvent.setup();
    render(<MenuDialog sheet />);
    const trigger = screen.getByRole("button", { name: "示例用户的操作" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "编辑" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("data-slot", "sheet-content");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("retains the conditional drawer and draft until its exit animation completes", async () => {
    // Model the Web Animations API used by Base UI; jsdom does not run CSS animations.
    let finishExit!: () => void;
    const finished = new Promise<void>((resolve) => {
      finishExit = resolve;
    });
    const getAnimations = vi.fn(function (this: HTMLElement) {
      return this.matches('[data-slot="sheet-content"][data-ending-style]')
        ? [
            {
              finished,
              effect: { getTiming: () => ({ duration: 200, iterations: 1 }) },
            },
          ]
        : [];
    });
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: getAnimations,
    });
    const user = userEvent.setup();
    render(<ConditionalDrawer />);
    const trigger = screen.getByRole("button", { name: "打开抽屉" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText("材料名称"), "内容");
    await user.keyboard("{Escape}");
    expect(dialog).toHaveAttribute("data-ending-style");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("材料名称")).toHaveValue("草稿内容");
    await waitFor(() => expect(getAnimations).toHaveBeenCalled());
    await act(async () => finishExit());
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(await screen.findByLabelText("材料名称")).toHaveValue("草稿");
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  });

  it("requires discard confirmation and prevents closing pending drawers", async () => {
    const user = userEvent.setup();
    const view = render(<ConditionalDrawer dirty />);
    await user.click(screen.getByRole("button", { name: "打开抽屉" }));
    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("dialog", { name: "放弃未保存的修改？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("dialog", { name: "维护材料" })).toHaveAttribute(
      "data-open",
    );
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "放弃修改" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打开抽屉" })).toHaveFocus(),
    );
    view.unmount();
    render(<ConditionalDrawer pending />);
    await user.click(screen.getByRole("button", { name: "打开抽屉" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-open");
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  });
});
