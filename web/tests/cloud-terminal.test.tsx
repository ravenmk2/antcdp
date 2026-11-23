import { SurfaceContext } from "@/components/platform/surface-context";
import CloudTerminal from "@/features/agents/cloud/cloud-terminal";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

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

it("keeps the end confirmation above the terminal in the console portal", async () => {
  const send = vi.fn();
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      send = send;
      onmessage?: (event: { data: string }) => void;
      constructor() {
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
  const portal = document.body.appendChild(document.createElement("div"));
  const view = render(
    <SurfaceContext value={{ area: "console", portal }}>
      <CloudTerminal computerId="9" onClose={() => {}} />
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
  } finally {
    view.unmount();
    portal.remove();
  }
});
