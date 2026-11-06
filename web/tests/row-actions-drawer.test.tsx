import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pencil, Trash2 } from "lucide-react";
import { RowActions, RowAction } from "@/components/row-actions";
import { Drawer, Modal } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";

function MenuDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RowActions label="示例用户">
        <RowAction icon={<Pencil />} onSelect={() => setOpen(true)}>
          编辑
        </RowAction>
      </RowActions>
      {open && (
        <Modal
          open
          title="编辑用户"
          description="维护资料"
          onClose={() => setOpen(false)}
        >
          <input aria-label="显示名称" />
        </Modal>
      )}
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
      <style>{`.drawer-content[data-state="open"] { animation-name: drawer-enter; animation-duration: 200ms; } .drawer-content[data-state="closed"] { animation-name: drawer-exit; animation-duration: 160ms; }`}</style>
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
    expect(screen.getByRole("menuitem", { name: "编辑" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(edit).toHaveBeenCalledTimes(1);
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

  it("retains the conditional drawer and draft until its exit animation completes", async () => {
    // Browsers return live computed styles; jsdom returns a snapshot. Radix
    // reads that same object again to decide whether to retain exit content.
    const compute = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const styles = compute(element);
      return new Proxy(styles, {
        get(target, property) {
          if (
            property === "animationName" &&
            element.classList.contains("drawer-content")
          )
            return element.getAttribute("data-state") === "closed"
              ? "drawer-exit"
              : "drawer-enter";
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    const user = userEvent.setup();
    render(<ConditionalDrawer />);
    const trigger = screen.getByRole("button", { name: "打开抽屉" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.animationEnd(dialog, { animationName: "drawer-enter" });
    await user.type(screen.getByLabelText("材料名称"), "内容");
    await user.keyboard("{Escape}");
    expect(dialog).toHaveAttribute("data-state", "closed");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("材料名称")).toHaveValue("草稿内容");
    const exitEvent = new Event("animationend", { bubbles: true });
    Object.defineProperty(exitEvent, "animationName", { value: "drawer-exit" });
    fireEvent(dialog, exitEvent);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(await screen.findByLabelText("材料名称")).toHaveValue("草稿");
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
      "data-state",
      "open",
    );
    view.unmount();
    render(<ConditionalDrawer pending />);
    await user.click(screen.getByRole("button", { name: "打开抽屉" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "open");
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  });
});
