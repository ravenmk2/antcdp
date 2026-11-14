import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { getSearchQuery } from "@codemirror/search";
import { MarkdownEditor } from "@/components/markdown-editor";
import { mapMarkdownScroll } from "@/lib/markdown-scroll";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => vi.unstubAllGlobals());

function view() {
  return EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown 源码" }),
  )!;
}

it("uses a single-selection shadcn group and preserves source across display modes", async () => {
  const user = userEvent.setup();
  render(<MarkdownEditor initial="# Original" onChange={vi.fn()} workspace />);
  const group = screen.getByRole("group", { name: "编辑显示模式" });
  expect(group).toHaveAttribute("data-slot", "toggle-group");
  expect(screen.getByRole("button", { name: "分栏" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "分栏" }));
  expect(screen.getByRole("button", { name: "分栏" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(
    screen.queryByRole("textbox", { name: "Markdown 源码" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect(view().state.doc.toString()).toBe("# Original");
});

it("finds, replaces and undoes through the editor search state and restores focus on Escape", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <MarkdownEditor
      initial={"alpha ALPHA alphabet\nalpha"}
      onChange={changed}
    />,
  );
  const editor = view();
  const searchToggle = screen.getByRole("button", { name: "查找与替换" });
  expect(searchToggle).toHaveAttribute("aria-pressed", "false");
  await user.click(searchToggle);
  expect(searchToggle).toHaveAttribute("aria-pressed", "true");
  await user.click(searchToggle);
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
  expect(searchToggle).toHaveAttribute("aria-pressed", "false");
  await user.keyboard("{Control>}f{/Control}");
  expect(searchToggle).toHaveAttribute("aria-pressed", "true");
  const find = screen.getByRole("textbox", { name: "查找内容" });
  expect(find).toHaveFocus();
  await user.type(find, "alpha");
  expect(getSearchQuery(editor.state).search).toBe("alpha");
  await user.click(screen.getByRole("button", { name: "区分大小写" }));
  await user.click(screen.getByRole("button", { name: "全词匹配" }));
  expect(editor.state.doc.toString()).toBe("alpha ALPHA alphabet\nalpha");
  expect(getSearchQuery(editor.state)).toMatchObject({
    search: "alpha",
    wholeWord: true,
    caseSensitive: true,
  });
  expect(screen.getByRole("status")).toHaveTextContent("— / 2");
  await user.type(screen.getByRole("textbox", { name: "替换内容" }), "beta");
  await user.click(screen.getByRole("button", { name: "全部替换" }));
  expect(editor.state.doc.toString()).toBe("beta ALPHA alphabet\nbeta");
  expect(changed).toHaveBeenLastCalledWith("beta ALPHA alphabet\nbeta");
  await user.click(find);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
  expect(searchToggle).toHaveAttribute("aria-pressed", "false");
  expect(editor.contentDOM).toHaveFocus();
  await user.keyboard("{Control>}z{/Control}");
  expect(editor.state.doc.toString()).toBe("alpha ALPHA alphabet\nalpha");
});

it("blocks invalid regular expressions and replacement in a read-only editor", async () => {
  const user = userEvent.setup();
  render(<MarkdownEditor initial="alpha" onChange={vi.fn()} disabled />);
  await user.click(screen.getByRole("button", { name: "查找与替换" }));
  await user.click(screen.getByRole("button", { name: "正则表达式" }));
  fireEvent.change(screen.getByRole("textbox", { name: "查找内容" }), {
    target: { value: "[" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("无效正则");
  expect(screen.getByRole("button", { name: "下一个匹配" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "全部替换" })).toBeDisabled();
});

it("maps paragraphs in both directions and clamps scroll boundaries", () => {
  const anchors = [
    { source: 0, preview: 0 },
    { source: 100, preview: 400 },
    { source: 500, preview: 600 },
  ];
  expect(mapMarkdownScroll(50, anchors, "source")).toBe(200);
  expect(mapMarkdownScroll(500, anchors, "preview")).toBe(300);
  expect(mapMarkdownScroll(-20, anchors, "source")).toBe(0);
  expect(mapMarkdownScroll(9999, anchors, "preview")).toBe(500);
});

it("synchronizes both scroll containers without feeding its own scroll event back", async () => {
  const { container } = render(
    <MarkdownEditor initial={"one\n\ntwo"} onChange={vi.fn()} workspace />,
  );
  const editor = view();
  const preview = container.querySelector<HTMLElement>(
    ".markdown-preview-scroll",
  )!;
  Object.defineProperties(editor.scrollDOM, {
    scrollHeight: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 200 },
  });
  Object.defineProperties(preview, {
    scrollHeight: { configurable: true, value: 2200 },
    clientHeight: { configurable: true, value: 200 },
  });
  await act(async () => {
    editor.scrollDOM.scrollTop = 500;
    fireEvent.scroll(editor.scrollDOM);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(preview.scrollTop).toBe(1000);
  fireEvent.scroll(preview);
  await act(async () => {
    preview.scrollTop = 1600;
    fireEvent.scroll(preview);
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  await waitFor(() => expect(editor.scrollDOM.scrollTop).toBe(800));
});
