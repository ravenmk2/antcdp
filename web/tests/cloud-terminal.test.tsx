import { SurfaceContext } from "@/components/platform/surface-context";
import CloudTerminal from "@/features/agents/cloud/cloud-terminal";
import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    open() {}
    loadAddon() {}
    onResize() {}
    onData() {}
    onBinary() {}
    focus() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

afterEach(() => vi.unstubAllGlobals());

const send = vi.fn();
let receive: (type: string, message?: string) => void;
let disconnect: () => void;

beforeEach(() => {
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      send = send;
      onclose?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() {
        receive = (type, message) =>
          this.onmessage?.({ data: JSON.stringify({ type, message }) });
        disconnect = () => this.onclose?.();
        queueMicrotask(() => this.onmessage?.({ data: '{"type":"ready"}' }));
      }
      close() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

function TerminalWindow() {
  const [open, setOpen] = useState(true);
  return open ? (
    <CloudTerminal computerId="9" onClose={() => setOpen(false)} />
  ) : null;
}

it("keeps the confirmation above the terminal and closes the window on acknowledged exit", async () => {
  const portal = document.body.appendChild(document.createElement("div"));
  const view = render(
    <SurfaceContext value={{ area: "console", portal }}>
      <TerminalWindow />
    </SurfaceContext>,
  );
  try {
    const terminal = await screen.findByRole("dialog", {
      name: "云电脑 9 终端",
    });
    expect(portal).toContainElement(terminal);
    const user = userEvent.setup();
    await user.click(
      await within(terminal).findByRole("button", { name: "结束终端" }),
    );
    const confirmation = await within(portal).findByRole("dialog", {
      name: "结束终端？",
    });
    expect(
      terminal.compareDocumentPosition(confirmation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(
      within(confirmation).getByRole("button", { name: "确认结束" }),
    );
    expect(send).toHaveBeenCalledWith('{"type":"end"}');
    expect(terminal).toBeInTheDocument();
    act(() => receive("exit", "终端已结束"));
    expect(terminal).not.toBeInTheDocument();
  } finally {
    view.unmount();
    portal.remove();
  }
});

it("keeps the terminal open after cancel, disconnection or an end failure", async () => {
  render(<TerminalWindow />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "结束终端" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(send).not.toHaveBeenCalledWith('{"type":"end"}');
  act(() => disconnect());
  await user.click(await screen.findByRole("button", { name: "重新连接" }));
  await user.click(await screen.findByRole("button", { name: "结束终端" }));
  await user.click(screen.getByRole("button", { name: "确认结束" }));
  act(() => receive("error", "无法确认终端已结束"));
  expect(screen.getByText("无法确认终端已结束")).toBeVisible();
  expect(screen.getByRole("button", { name: "重新连接" })).toBeVisible();
});
