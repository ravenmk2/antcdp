import { fireEvent, render, screen } from "@testing-library/react";
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
