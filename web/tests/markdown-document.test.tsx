import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseMarkdown } from "@/lib/markdown-document";
import { MarkdownView } from "@/components/markdown";
import { normalizeDiagram } from "@/components/mermaid-block";

const diagram = vi.hoisted(() => vi.fn());
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("shiki", () => ({
  codeToHtml: async () => {
    throw new Error("plain fallback");
  },
}));
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: diagram },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("copies each complete table from its original Markdown source", async () => {
  const first =
    "| 名称 | 链接 |\r\n| --- | --- |\r\n| `a` | [站点](/home) |\r\n";
  const second = "| 数量 |\n| ---: |\n| 12 |";
  const source = `正文\r\n\r\n${first}\r\n间隔\n\n${second}`;
  expect(parseMarkdown(source).tables).toEqual([first, second]);
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<MarkdownView source={source} />);
  const buttons = screen.getAllByRole("button", { name: "复制表格 Markdown" });
  expect(screen.getAllByRole("table")).toHaveLength(2);
  await user.click(buttons[0]);
  expect(write).toHaveBeenLastCalledWith(first);
  await user.click(buttons[1]);
  expect(write).toHaveBeenLastCalledWith(second);
});

it("reads explicit code filenames and bounded line ranges from fences", () => {
  const document = parseMarkdown(
    '```ts title="app/api/chat/route.ts" {2-3,999999999}\none\ntwo\nthree\n```',
  );
  expect(document.blocks[0]).toMatchObject({
    title: "app/api/chat/route.ts",
    language: "ts",
    highlightedLines: [2, 3],
  });
});

it("keeps focus on the chosen heading when the compact directory closes", async () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<MarkdownView source={"# Intro\n## Details"} compact preview />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "目录" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("link", {
      name: "Details",
    }),
  );
  expect(screen.getByRole("heading", { name: "Details" })).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(scroll).toHaveBeenCalled();
});

it("keeps nested fences inside lists and quotes and generates unique Unicode anchors", () => {
  const parsed = parseMarkdown(
    "# 介绍\n## 介绍\n## 介绍-2\n\n[返回](#介绍)\n\n- 示例\n\n  ~~~ts\n  const a = 1\n  ~~~\n\n> ```mermaid\n> graph TD; A-->B\n> ```\n\n<script>alert(1)</script>",
  );
  expect(parsed.headings.map((h) => h.id)).toEqual([
    "md-介绍",
    "md-介绍-2",
    "md-介绍-2-2",
  ]);
  expect(parsed.blocks.map((b) => b.language)).toEqual(["ts", "mermaid"]);
  const dom = new DOMParser().parseFromString(parsed.html, "text/html");
  expect(dom.querySelector('li [data-markdown-block="0"]')).not.toBeNull();
  expect(
    dom.querySelector('blockquote [data-markdown-block="1"]'),
  ).not.toBeNull();
  expect(dom.querySelector("a")?.getAttribute("href")).toBe("#md-介绍");
  expect(dom.querySelector("script")).toBeNull();
});

it("navigates duplicate headings in the preview scroll container without changing the page fragment", async () => {
  const pageScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState({}, "", "/#original");
  const { container } = render(
    <div data-markdown-scroll>
      <MarkdownView source={"# Title\n## Title"} preview />
    </div>,
  );
  const scroller = container.firstElementChild as HTMLElement;
  const scroll = vi.fn();
  scroller.scrollTo = scroll;
  const user = userEvent.setup();
  const links = within(
    screen.getByRole("navigation", { name: "文档目录" }),
  ).getAllByRole("link", { name: "Title" });
  expect(links[1]).toHaveAttribute("href", "#md-title-2");
  await user.click(links[1]);
  expect(scroll).toHaveBeenCalledOnce();
  expect(pageScroll).not.toHaveBeenCalled();
  expect(location.hash).toBe("#original");
  expect(links[1]).toHaveAttribute("aria-current", "location");
});

it("omits the directory for a document without headings and returns a long page to its top", async () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<MarkdownView source="正文" />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  const article = screen.getByRole("article");
  vi.spyOn(article, "getBoundingClientRect").mockReturnValue({
    top: -2000,
  } as DOMRect);
  await act(async () => {
    fireEvent.scroll(window);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await userEvent.click(screen.getByRole("button", { name: "回到顶部" }));
  expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
});

it("renders Mermaid only on request, supports the image viewer and restores trigger focus", async () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize!: () => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  diagram.mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3000 1000"><text x="10" y="20">Graph</text></svg>',
  });
  const user = userEvent.setup();
  render(<MarkdownView source={"```mermaid\ngraph TD; A-->B\n```"} />);
  expect(diagram).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "代码" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "代码" }));
  expect(diagram).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "图形" }));
  const trigger = await screen.findByRole("button", { name: "查看完整图表" });
  await user.click(trigger);
  const viewer = screen.getByRole("dialog", { name: "图表查看" });
  const canvas = viewer.querySelector(".diagram-viewport")!;
  expect(observe).toHaveBeenCalledWith(canvas);
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: 1548 },
    clientHeight: { configurable: true, value: 848 },
  });
  act(() => resize());
  expect(within(viewer).getByRole("img").style.transform).toContain(
    "scale(0.5)",
  );
  fireEvent.wheel(canvas, { deltaY: -120 });
  const enlarged = within(viewer).getByRole("img").style.transform;
  expect(enlarged).not.toContain("scale(0.5)");
  fireEvent.wheel(canvas, { deltaY: 120 });
  expect(within(viewer).getByRole("img").style.transform).toContain(
    "scale(0.5)",
  );
  expect(within(viewer).getByRole("img")).toHaveStyle({
    width: "3000px",
    height: "1000px",
  });
  await user.click(within(viewer).getByRole("button", { name: "实际大小" }));
  expect(within(viewer).getByRole("img").style.transform).toContain("scale(1)");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(disconnect).toHaveBeenCalled();
});

it("keeps source available on malformed Mermaid and rejects unsafe SVG content", async () => {
  diagram.mockRejectedValue(new Error("语法错误"));
  render(<MarkdownView source={"```mermaid\ninvalid graph\n```"} />);
  await userEvent.click(screen.getByRole("button", { name: "图形" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("语法错误");
  expect(screen.getByText("invalid graph")).toBeInTheDocument();
  const clean = normalizeDiagram(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><script>alert(1)</script><image href="https://example.test/a.png"/><text onclick="alert(1)">Safe</text></svg>',
  );
  expect(clean.width).toBe(200);
  expect(clean.svg).not.toMatch(/script|onclick|https:|<image/);
  expect(() => normalizeDiagram('<svg viewBox="0 0 0 100"></svg>')).toThrow();
});
