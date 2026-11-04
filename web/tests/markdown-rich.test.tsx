import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Markdown, parseDescription } from "@/features/collaboration/Markdown";
import { highlight } from "@/features/collaboration/markdown-highlight";

vi.mock("@/features/collaboration/markdown-mermaid", () => ({
  renderDiagram: vi.fn(
    async () =>
      '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>',
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("highlights code with both themes while retaining exact code text", async () => {
  const source = 'const value = "<script>";\n';
  const html = await highlight(source, "js");
  const node = document.createElement("div");
  node.innerHTML = html;
  expect(node.querySelector("script")).toBeNull();
  expect(node.querySelector("code")?.textContent).toBe(source);
  expect(html).toContain("--shiki-dark");
  expect(await highlight(source, "unknown-language")).toBe("");
});
it("copies exact table Markdown, and replaces the copy icon with a resettable check", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("isSecureContext", true);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const source = "| A | B |\n| :--- | ---: |\n| **value** | a\\|b |";
  render(<Markdown text={source} enhanced />);
  expect(screen.getByRole("table").querySelectorAll("th")).toHaveLength(2);
  const button = screen.getByRole("button", { name: "复制表格 Markdown" });
  await user.click(button);
  expect(copy).toHaveBeenCalledWith(source);
  expect(button.dataset.copyState).toBe("copied");
  expect(button.querySelector("svg")).toBeTruthy();
  await waitFor(() => expect(button.dataset.copyState).toBe("idle"), {
    timeout: 3000,
  });
});
it("updates code and table portal content when preview text changes", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("isSecureContext", true);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const view = render(<Markdown text={"```yaml\na: old\n```"} enhanced />);
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  expect(copy).toHaveBeenLastCalledWith("a: old\n");
  view.rerender(
    <Markdown text={"```yaml\na: new\n```\n\n| A |\n|---|\n| B |"} enhanced />,
  );
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  expect(copy).toHaveBeenLastCalledWith("a: new\n");
  expect(
    screen.getByRole("button", { name: "复制表格 Markdown" }),
  ).toBeTruthy();
  view.rerender(<Markdown text="plain" enhanced />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("does not show success after a failed copy", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );
  render(<Markdown text={"```plain\ntext\n```"} enhanced />);
  const button = screen.getByRole("button", { name: "复制代码" });
  await user.click(button);
  expect(button.dataset.copyState).toBe("failed");
  expect(screen.getByRole("status").textContent).toContain("复制失败");
});
it("renders Mermaid, toggles source, and rerenders for theme changes", async () => {
  const { renderDiagram } =
    await import("@/features/collaboration/markdown-mermaid");
  const user = userEvent.setup();
  render(<Markdown text={"```mermaid\ngraph LR\nA-->B\n```"} enhanced />);
  expect(await screen.findByRole("img", { name: "Mermaid 图表" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "源码" }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(
    screen.getByRole("button", { name: "源码" }).getAttribute("aria-pressed"),
  ).toBe("true");
  document.documentElement.classList.add("dark");
  await waitFor(() =>
    expect(renderDiagram).toHaveBeenLastCalledWith("graph LR\nA-->B\n", true),
  );
  document.documentElement.classList.remove("dark");
});
it("preserves source and surrounding text on a diagram failure", async () => {
  const { renderDiagram } =
    await import("@/features/collaboration/markdown-mermaid");
  vi.mocked(renderDiagram).mockRejectedValueOnce(new Error("invalid syntax"));
  render(
    <Markdown
      text={"before\n\n```mermaid\ninvalid diagram\n```\n\nafter"}
      enhanced
    />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("before")).toBeTruthy();
  expect(screen.getByText("after")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "复制 Mermaid 源码" }),
  ).toBeTruthy();
});
it("keeps raw HTML inert in enhanced mode and extracts table source independently", () => {
  const parsed = parseDescription(
    "<script>bad</script>\n\n| a |\n|---|\n| b |",
    "safe",
    true,
  );
  expect(parsed.html).not.toContain("<script>");
  expect(parsed.blocks?.[0]?.source).toBe("| a |\n|---|\n| b |");
});
