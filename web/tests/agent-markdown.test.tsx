import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ChatMarkdown } from "@/features/agents/chat/markdown";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("shiki", () => ({ codeToHtml: vi.fn(async () => "") }));

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
