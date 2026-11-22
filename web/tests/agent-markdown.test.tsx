import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ChatMarkdown } from "@/features/agents/chat/markdown";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("shiki", () => ({ codeToHtml: vi.fn(async () => "") }));
const renderDiagram = vi.hoisted(() => vi.fn());
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: renderDiagram },
}));

afterEach(() => {
  renderDiagram.mockReset();
  vi.unstubAllGlobals();
});

it("shows a Mermaid graph after streaming and reuses it across mode changes", async () => {
  renderDiagram.mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text>Graph</text></svg>',
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const diagram = "flowchart LR\nA --> B\n";
  const source = "```mermaid\n" + diagram;
  const { rerender } = render(<ChatMarkdown source={source} streaming />);
  const toggle = screen.getByRole("button", { name: "查看图形" });
  expect(toggle).toBeDisabled();
  expect(screen.getByText("A --> B")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "自动换行" }));
  expect(renderDiagram).not.toHaveBeenCalled();

  rerender(<ChatMarkdown source={source + "```"} />);
  await screen.findByRole("button", { name: "查看完整图表" });
  expect(screen.getByRole("button", { name: "查看代码" })).toBe(toggle);
  expect(screen.queryByText("A --> B")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  expect(write).toHaveBeenLastCalledWith(diagram);
  await user.click(toggle);
  expect(screen.getByText("A --> B")).toBeVisible();
  expect(screen.getByRole("button", { name: "自动换行" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(toggle);
  expect(renderDiagram).toHaveBeenCalledTimes(1);

  const preview = screen.getByRole("button", { name: "查看完整图表" });
  await user.click(preview);
  const viewer = screen.getByRole("dialog", { name: "图表查看" });
  expect(within(viewer).getByRole("button", { name: "放大" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(viewer).not.toBeInTheDocument();
  expect(preview).toHaveFocus();
});

it("keeps malformed Mermaid source visible and navigable", async () => {
  renderDiagram.mockRejectedValue(new Error("Invalid Mermaid"));
  render(<ChatMarkdown source={"```mermaid\ninvalid graph\n```"} />);
  expect(await screen.findByText(/已显示源码/)).toHaveAttribute(
    "role",
    "status",
  );
  expect(screen.getByText("invalid graph")).toBeVisible();
  expect(screen.getByRole("button", { name: "复制代码" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "重试图形" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "查看完整图表" })).toBeNull();
});

it("keeps completed blocks and code controls mounted while the tail grows", () => {
  const source = "段落。\n\n```typescript\nconst a = 1;\n```\n\n";
  const { container, rerender } = render(
    <ChatMarkdown source={source + "尾部"} streaming />,
  );
  const first = screen.getByText("段落。");
  const code = container.querySelector(".agent-markdown-code");
  fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
  rerender(
    <ChatMarkdown
      source={source + "尾部继续输出\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"}
      streaming
    />,
  );
  expect(screen.getByText("段落。")).toBe(first);
  expect(container.querySelector(".agent-markdown-code")).toBe(code);
  expect(screen.getByRole("button", { name: "自动换行" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("region", { name: "Markdown 表格" }),
  ).toHaveTextContent("A");
  rerender(<ChatMarkdown source={source} />);
  expect(container.querySelector(".agent-markdown-code")).toBe(code);
});

it("retains table scroll and focus as rows stream and copies the current source", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const source = "| 项目 | 数量 |\r\n| --- | ---: |\r\n| 甲 | 1 |\r\n";
  const next = `${source}| 乙 | 2 |`;
  const { rerender } = render(<ChatMarkdown source={source} streaming />);
  const region = screen.getByRole("region", { name: "Markdown 表格" });
  const copy = within(region).getByRole("button", {
    name: "复制表格 Markdown",
  });
  region.scrollLeft = 64;
  copy.focus();

  rerender(<ChatMarkdown source={next} streaming />);
  expect(screen.getByRole("region", { name: "Markdown 表格" })).toBe(region);
  expect(region.scrollLeft).toBe(64);
  expect(copy).toHaveFocus();
  expect(within(region).getByRole("cell", { name: "乙" })).toBeVisible();
  await user.click(copy);
  expect(write).toHaveBeenLastCalledWith(next);

  const revised = next.replace("| 乙 |", "|  乙  |");
  rerender(<ChatMarkdown source={revised} streaming />);
  await user.click(copy);
  expect(write).toHaveBeenLastCalledWith(revised);
});

it("renders empty fragments silently and keeps untrusted markup inert", () => {
  const { container, rerender } = render(
    <ChatMarkdown source={" \n"} streaming />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <ChatMarkdown
      source={
        "<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n![image](https://invalid.test/a)"
      }
      streaming
    />,
  );
  expect(
    container.querySelector("img,script,[onerror],a[href^='javascript:']"),
  ).toBeNull();
  expect(screen.queryByText(/暂无介绍/)).toBeNull();
});
