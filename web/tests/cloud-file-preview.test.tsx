import { Blob as NodeBlob } from "node:buffer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilePreview } from "@/features/agents/cloud/file-preview";
import type { CloudFileEntry } from "@/types/cloud-computer";

const fetchFile = vi.fn();
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchFile);
  vi.stubGlobal("Blob", NodeBlob);
  fetchFile.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("shows file metadata in the header information popover without a footer", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  fetchFile.mockResolvedValue(new Response("<h1>Report</h1>"));
  const { user } = mount(file("report.html"));
  await screen.findByTitle("report.html 预览");
  expect(screen.queryByText("修改时间")).not.toBeInTheDocument();
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "文件信息" }));
  expect(await screen.findByText("/data/reports/report.html")).toBeVisible();
  expect(screen.getByText("100 B")).toBeVisible();
  expect(screen.getByText("静态预览 · 脚本及外部资源已禁用")).toBeVisible();
  expect(screen.getByRole("link", { name: "下载" })).toBeVisible();
});
function file(name: string, size: string | null = "100"): CloudFileEntry {
  return {
    name,
    path: `reports/${name}`,
    kind: "file",
    size_bytes: size,
    modified_at: null,
    entry_token: name,
  };
}
function mount(entry: CloudFileEntry) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (value: CloudFileEntry) => (
    <QueryClientProvider client={cache}>
      <FilePreview computerId="9" entry={value} />
    </QueryClientProvider>
  );
  const result = render(view(entry));
  return {
    user: userEvent.setup(),
    select: (value: CloudFileEntry) => result.rerender(view(value)),
  };
}
it("renders Markdown and switches to its exact source without downloading again", async () => {
  const source = "# 本周成果\n\n**预览内容**";
  fetchFile.mockResolvedValue(new Response(source));
  const { user } = mount(file("report.md"));
  const clipboard = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();
  expect(
    await screen.findByRole("heading", { name: "本周成果" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "源码" }));
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  expect(clipboard).toHaveBeenCalledWith(source);
  expect(fetchFile).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute(
    "href",
    expect.stringContaining("path=reports%2Freport.md"),
  );
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("heading", { name: "本周成果" })).toBeVisible();
});
it("isolates HTML previews and keeps unmodified HTML available as source", async () => {
  const source =
    '<style>h1{color:red}</style><h1>网页预览</h1><script>alert(1)</script><img src=x onerror="alert(1)">';
  fetchFile.mockResolvedValue(new Response(source));
  const { user } = mount(file("index.html"));
  const frame = await screen.findByTitle("index.html 预览");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  expect(frame.getAttribute("srcdoc")).toContain("h1{color:red}");
  expect(frame.getAttribute("srcdoc")).not.toMatch(/<script|onerror/);
  await user.click(screen.getByRole("button", { name: "源码" }));
  expect(screen.getByLabelText("文件源码").textContent).toBe(source);
  await waitFor(() =>
    expect(
      screen.getByLabelText("文件源码").querySelector("span[style*='color']"),
    ).not.toBeNull(),
  );
});
it("offers downloads without fetching unsupported and oversized files", async () => {
  const { select } = mount(file("archive.zip"));
  expect(screen.getByText("此格式暂不支持在线预览")).toBeVisible();
  select(file("huge.txt", String(3 * 1024 * 1024)));
  expect(screen.getByText("文件较大，请下载查看")).toBeVisible();
  expect(fetchFile).not.toHaveBeenCalled();
});
it("enforces the text size limit even when directory metadata has no size", async () => {
  fetchFile.mockResolvedValue(new Response("a".repeat(2 * 1024 * 1024 + 1)));
  mount(file("large.log", null));
  expect(
    await screen.findByText("文件超过在线预览大小限制，请下载后查看。"),
  ).toBeVisible();
});
it("discards a late previous-file response and resets the preview mode", async () => {
  let finish: (value: Response) => void = () => {};
  fetchFile.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  fetchFile.mockImplementationOnce(async () => new Response("# 第二份文件"));
  const { user, select } = mount(file("first.md"));
  await waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(1));
  const firstSignal = fetchFile.mock.calls[0][1].signal as AbortSignal;
  await user.click(screen.getByRole("button", { name: "源码" }));
  select(file("second.md"));
  expect(
    await screen.findByRole("heading", { name: "第二份文件" }),
  ).toBeVisible();
  expect(firstSignal.aborted).toBe(true);
  finish(new Response("# 第一份文件"));
  expect(
    screen.queryByRole("heading", { name: "第一份文件" }),
  ).not.toBeInTheDocument();
});
it("shows server errors and allows a failed read to be retried", async () => {
  fetchFile.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { message: "文件已不存在" } }), {
      status: 404,
    }),
  );
  fetchFile.mockResolvedValueOnce(new Response("recovered"));
  const { user } = mount(file("report.txt"));
  await screen.findByText("文件已不存在");
  await user.click(screen.getByRole("button", { name: "重新加载" }));
  await waitFor(() =>
    expect(screen.getByLabelText("文件源码")).toHaveTextContent("recovered"),
  );
});
