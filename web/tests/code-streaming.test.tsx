import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownView } from "@/components/markdown";
import { CodeBlock } from "@/components/code-block";

const highlighter = vi.hoisted(() => vi.fn());
vi.mock("shiki", () => ({ codeToHtml: highlighter }));
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));

it.each(["mermaid", "typescript"])(
  "keeps %s code mounted and unhighlighted until streaming finishes",
  async (language) => {
    let finish!: (html: string) => void;
    highlighter.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const source = "```" + language + "\nfirst\nsecond\n";
    const { container, rerender } = render(
      <MarkdownView source={source} streaming navigation={false} />,
    );
    const code = container.querySelector('[data-slot="code-block"]');
    const rows = () =>
      container.querySelectorAll('[data-slot="code-block-line"]');
    fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
    if (language === "mermaid")
      expect(screen.getByRole("button", { name: "图形" })).toBeDisabled();
    rerender(
      <MarkdownView
        source={source + "third\n```"}
        streaming
        navigation={false}
      />,
    );
    await act(async () => {});
    expect(highlighter).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
    expect(code).toHaveTextContent("third");
    rerender(
      <MarkdownView source={source + "third\n```"} navigation={false} />,
    );
    await waitFor(() => expect(highlighter).toHaveBeenCalledTimes(1));
    expect(highlighter).toHaveBeenCalledWith(
      "first\nsecond\nthird",
      expect.anything(),
    );
    expect(container.querySelector('[data-slot="code-block"]')).toBe(code);
    expect(screen.getByRole("button", { name: "自动换行" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await act(async () =>
      finish(
        '<pre><code><span class="line"><span style="color:red">first</span></span>\n<span class="line">second</span>\n<span class="line">third</span></code></pre>',
      ),
    );
    expect(rows()).toHaveLength(3);
    expect(container.querySelector('[style="color:red"]')).not.toBeNull();
    if (language === "mermaid")
      expect(screen.getByRole("button", { name: "图形" })).toBeEnabled();
  },
);

it("normalizes only the final newline for both display modes and preserves blank lines", async () => {
  highlighter.mockImplementation(
    async (source: string) =>
      `<pre><code>${source
        .split("\n")
        .map((line) => `<span class="line">${line}</span>`)
        .join("\n")}</code></pre>`,
  );
  const { container } = render(
    <CodeBlock source={"one\n\n"} language="text" />,
  );
  expect(
    container.querySelectorAll('[data-slot="code-block-line"]'),
  ).toHaveLength(2);
  await waitFor(() =>
    expect(highlighter).toHaveBeenCalledWith("one\n", expect.anything()),
  );
  await act(async () => {});
  expect(
    container.querySelectorAll('[data-slot="code-block-line"]'),
  ).toHaveLength(2);
});

it("ignores a previous asynchronous highlight after streaming resumes", async () => {
  let finish!: (html: string) => void;
  highlighter.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const { container, rerender } = render(
    <CodeBlock source="old" language="text" />,
  );
  await waitFor(() => expect(highlighter).toHaveBeenCalledTimes(1));
  rerender(<CodeBlock source="new content" language="text" streaming />);
  await act(async () =>
    finish('<pre><code><span class="line">old</span></code></pre>'),
  );
  expect(
    container.querySelector('[data-slot="code-block-content"]'),
  ).toHaveTextContent("new content");
  expect(highlighter).toHaveBeenCalledTimes(1);
});
