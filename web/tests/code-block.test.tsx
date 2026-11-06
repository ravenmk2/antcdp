import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "@/components/code-block";

const mocks = vi.hoisted(() => ({
  codeToHtml: vi.fn(),
  theme: { resolved: "light" },
}));
vi.mock("shiki", () => ({ codeToHtml: mocks.codeToHtml }));
vi.mock("@/app/theme", () => ({ useTheme: () => mocks.theme }));

beforeEach(() => {
  mocks.codeToHtml.mockReset();
  mocks.theme.resolved = "light";
});

describe("code block", () => {
  it("never displays stale audit details while another highlight is pending or fails", async () => {
    let resolveFirst!: (value: string) => void;
    let rejectSecond!: (reason: Error) => void;
    mocks.codeToHtml
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, reject) => {
            rejectSecond = reject;
          }),
      );
    const first = '{"name":"first"}';
    const second = '{"name":"<script>second</script>"}';
    const { container, rerender } = render(
      <CodeBlock source={first} language="json" />,
    );
    await waitFor(() => expect(mocks.codeToHtml).toHaveBeenCalledTimes(1));
    rerender(<CodeBlock source={second} language="json" />);
    await waitFor(() => expect(mocks.codeToHtml).toHaveBeenCalledTimes(2));
    await act(async () => resolveFirst("<pre><code>first</code></pre>"));
    expect(container.querySelector("pre")?.textContent).toBe(second);
    await act(async () => rejectSecond(new Error("highlight unavailable")));
    expect(container.querySelector("pre")?.textContent).toBe(second);
    expect(container.querySelector("script")).toBeNull();
  });

  it("sanitizes highlighted content, follows the theme and copies the original JSON", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    const source = '{"enabled":true,"count":3}';
    mocks.codeToHtml.mockResolvedValue(
      '<pre><code><span style="color:#123456">JSON</span></code></pre><script>alert(1)</script>',
    );
    const { container, rerender } = render(
      <CodeBlock source={source} language="json" />,
    );
    await screen.findByText("JSON");
    expect(container.querySelector("script")).toBeNull();
    expect(mocks.codeToHtml).toHaveBeenLastCalledWith(source, {
      lang: "json",
      theme: "github-light",
    });
    mocks.theme.resolved = "dark";
    rerender(<CodeBlock source={source} language="json" />);
    await waitFor(() =>
      expect(mocks.codeToHtml).toHaveBeenLastCalledWith(source, {
        lang: "json",
        theme: "github-dark",
      }),
    );
    await user.click(screen.getByRole("button", { name: "复制代码" }));
    expect(copy).toHaveBeenCalledWith(source);
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });
});
