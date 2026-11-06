import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/clipboard";
import { CopyButton } from "@/components/copy-button";
import { MarkdownActions, MarkdownView } from "@/components/markdown";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: async () => ({ svg: "<svg></svg>" }),
  },
}));

const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  if (originalExec)
    Object.defineProperty(document, "execCommand", originalExec);
  else Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

function legacyCopy(result = true) {
  const copy = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: copy,
  });
  return copy;
}
function noClipboard() {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue(
    undefined as unknown as Clipboard,
  );
}

describe("clipboard", () => {
  it("uses the async API when available", async () => {
    userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const legacy = legacyCopy();
    await copyText("中文\noriginal source");
    expect(write).toHaveBeenCalledWith("中文\noriginal source");
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "denied"])(
    "copies exact text inside a dialog when async API is %s, then restores focus and selection",
    async (mode) => {
      userEvent.setup();
      if (mode === "unavailable") noClipboard();
      else
        vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
          new DOMException("Denied", "NotAllowedError"),
        );
      render(
        <div role="dialog">
          <input aria-label="draft" defaultValue="keep this draft" />
          <CopyButton value="unused" />
        </div>,
      );
      const input = screen.getByRole("textbox") as HTMLInputElement;
      input.focus();
      input.setSelectionRange(2, 7, "backward");
      const source = "  中文\n<literal>&\n";
      const legacy = legacyCopy();
      legacy.mockImplementation(() => {
        const field = document.activeElement as HTMLTextAreaElement;
        expect(field.tagName).toBe("TEXTAREA");
        expect(screen.getByRole("dialog")).toContainElement(field);
        expect(field.value).toBe(source);
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe(source.length);
        return true;
      });
      await copyText(source, screen.getByRole("button"));
      expect(legacy).toHaveBeenCalledWith("copy");
      expect(input).toHaveFocus();
      expect([
        input.selectionStart,
        input.selectionEnd,
        input.selectionDirection,
      ]).toEqual([2, 7, "backward"]);
      expect(document.querySelector("textarea")).toBeNull();
    },
  );

  it.each([false, "throws"])(
    "cleans up and restores document selection when legacy copy fails (%s)",
    async (failure) => {
      userEvent.setup();
      noClipboard();
      render(
        <>
          <p>selected text</p>
          <button>trigger</button>
        </>,
      );
      const button = screen.getByRole("button");
      button.focus();
      const range = document.createRange();
      range.selectNodeContents(screen.getByText("selected text"));
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      expect(window.getSelection()?.toString()).toBe("selected text");
      const legacy = legacyCopy(false);
      if (failure === "throws")
        legacy.mockImplementation(() => {
          throw new Error("Denied");
        });
      await expect(copyText("test", button)).rejects.toThrow();
      expect(button).toHaveFocus();
      expect(window.getSelection()?.toString()).toBe("selected text");
      expect(document.querySelector("textarea")).toBeNull();
      window.getSelection()?.removeAllRanges();
    },
  );

  it.each(["shared", "markdown", "mermaid"])(
    "reports failure and successful retry for %s copy",
    async (kind) => {
      const user = userEvent.setup();
      noClipboard();
      const legacy = legacyCopy(false);
      const source = "graph TD\nA-->B\n";
      render(
        kind === "shared" ? (
          <CopyButton value={source} />
        ) : kind === "markdown" ? (
          <MarkdownActions source={source} />
        ) : (
          <MarkdownView source={"```mermaid\n" + source + "```"} />
        ),
      );
      await act(async () => {});
      const button = screen.getByRole("button", { name: /^复制/ });
      await user.click(button);
      expect(screen.getByRole("alert")).toHaveTextContent("复制失败");
      expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
      legacy.mockReturnValue(true);
      await user.click(button);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "已复制" })).toBeVisible();
      expect(button).toHaveFocus();
    },
  );
});
