import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "@/features/collaboration/MarkdownEditor";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  vi.unstubAllGlobals();
});
it("preserves document, selection and undo history while switching preview mode", async () => {
  function Harness() {
    const [value, setValue] = useState("# Hello");
    const [hidden, setHidden] = useState(false);
    return (
      <>
        <button onClick={() => setHidden(!hidden)}>切换</button>
        <div hidden={hidden}>
          <MarkdownEditor
            id="source"
            value={value}
            onChange={setValue}
            aria-invalid={false}
          />
        </div>
      </>
    );
  }
  render(<Harness />);
  const textbox = screen.getByRole("textbox", { name: "Markdown 正文" });
  const view = EditorView.findFromDOM(textbox)!;
  await act(async () =>
    view.dispatch({
      changes: { from: 7, insert: " world" },
      selection: { anchor: 13 },
    }),
  );
  fireEvent.click(screen.getByText("切换"));
  fireEvent.click(screen.getByText("切换"));
  expect(EditorView.findFromDOM(textbox)).toBe(view);
  expect(view.state.doc.toString()).toBe("# Hello world");
  expect(view.state.selection.main.head).toBe(13);
  fireEvent.keyDown(textbox, { key: "z", code: "KeyZ", ctrlKey: true });
  await waitFor(() => expect(view.state.doc.toString()).toBe("# Hello"));
});
it("updates read-only permission and exposes validation focus on the editor", () => {
  const props = {
    id: "source",
    value: "content",
    onChange: vi.fn(),
    "aria-invalid": false,
  };
  const view = render(<MarkdownEditor {...props} />);
  view.rerender(<MarkdownEditor {...props} disabled aria-invalid />);
  const textbox = screen.getByLabelText("Markdown 正文");
  expect(textbox.getAttribute("contenteditable")).toBe("false");
  expect(textbox.getAttribute("aria-invalid")).toBe("true");
  expect(textbox.id).toBe("source");
});
