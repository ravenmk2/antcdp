import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "@/features/admin/audit-page";

vi.mock("@/app/auth", () => ({
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));

const events = Array.from({ length: 27 }, (_, index) => ({
  id: String(27 - index),
  occurred_at: "2026-11-06T08:00:00Z",
  action: "user.profile_updated",
  actor: { display_name: "测试操作者", username: "tester" },
  target: { type: "user", label: `对象 ${27 - index}` },
  detail: { enabled: true, count: 3, name: "<script>示例</script>" },
}));
let requests: URL[];
beforeEach(() => {
  localStorage.clear();
  requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    if (url.pathname.endsWith("/27"))
      return new Response(JSON.stringify({ data: events[0] }));
    const page = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("page_size"));
    const rows = url.searchParams.get("q") ? events.slice(0, 2) : events;
    return new Response(
      JSON.stringify({
        data: rows.slice((page - 1) * size, page * size),
        pagination: { page, page_size: size, total: rows.length },
      }),
    );
  });
});
afterEach(() => vi.restoreAllMocks());
function mount(entry = "/admin/audit") {
  const router = createMemoryRouter(
    [{ path: "/admin/audit", element: <AuditPage /> }],
    { initialEntries: [entry] },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
describe("audit numbered pagination", () => {
  it("opens details from a row click or keyboard and restores focus", async () => {
    const user = userEvent.setup();
    mount();
    const target = await screen.findByText("对象 27");
    const row = target.closest("tr")!;
    expect(
      screen.getByRole("columnheader", { name: "事件代码" }),
    ).toBeVisible();
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("更新用户资料");
    expect(cells[2]).toHaveTextContent("user.profile_updated");
    expect(cells[3]).toHaveTextContent("测试操作者@tester");
    await user.click(target);
    expect(await screen.findByText("操作数据")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const key of ["{Enter}", " "]) {
      row.focus();
      await user.keyboard(key);
      expect(await screen.findByText("操作数据")).toBeVisible();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(row).toHaveFocus();
    }
  });
  it("moves beyond page two, returns and jumps to both ends", async () => {
    const user = userEvent.setup();
    const router = mount();
    expect(await screen.findByText("对象 27")).toBeVisible();
    expect(screen.getByText("共 27 条")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("对象 17")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("对象 7")).toBeVisible();
    expect(screen.getByText("3/3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "上一页" }));
    expect(await screen.findByText("对象 17")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "首页" }));
    expect(await screen.findByText("对象 27")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "末页" }));
    expect(await screen.findByText("对象 7")).toBeVisible();
    expect(router.state.location.search).toContain("page=3");
    expect(requests.every((url) => !url.searchParams.has("cursor"))).toBe(true);
  });
  it("restores URL pagination, resets for size and search, and uses the new detail title", async () => {
    const user = userEvent.setup();
    const router = mount("/admin/audit?page=3&limit=10");
    expect(await screen.findByText("对象 7")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "每页条数" }));
    await user.click(await screen.findByRole("option", { name: "20" }));
    expect(await screen.findByText("对象 27")).toBeVisible();
    expect(router.state.location.search).toContain("page=1");
    expect(router.state.location.search).toContain("page_size=20");
    expect(router.state.location.search).not.toContain("limit=");
    expect(localStorage.getItem("antcdp.page-size.audit")).toBe("20");
    await user.click(screen.getByRole("button", { name: "末页" }));
    expect(await screen.findByText("对象 7")).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "搜索审计" }),
      "tester{Enter}",
    );
    expect(await screen.findByText("共 2 条")).toBeVisible();
    expect(router.state.location.search).toContain("page=1");
    await user.click(
      screen.getAllByRole("button", { name: "查看 更新用户资料" })[0],
    );
    expect(await screen.findByText("操作数据")).toBeVisible();
    const dialog = screen.getByRole("dialog", { name: "审计事件详情" });
    expect(dialog.querySelector("dl")?.querySelectorAll("dt")).toHaveLength(8);
    expect(within(dialog).getByText("ID").nextElementSibling).toHaveTextContent(
      "27",
    );
    const code = within(dialog).getByLabelText("操作数据");
    expect(code).toHaveAttribute("tabindex", "0");
    await waitFor(() =>
      expect(code.querySelector("span[style*='--shiki-light']")).not.toBeNull(),
    );
    expect(code.querySelector("span[style*='--shiki-dark']")).not.toBeNull();
    expect(code).toHaveTextContent("<script>示例</script>");
    expect(code.querySelector("script")).toBeNull();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      within(dialog).getByRole("button", { name: "复制操作数据" }),
    );
    expect(copy).toHaveBeenCalledWith(
      JSON.stringify(events[0].detail, null, 2),
    );
    expect(within(dialog).queryByText("操作详情")).not.toBeInTheDocument();
    expect(screen.queryByText("白名单变更详情")).not.toBeInTheDocument();
  });
  it("recovers from an out-of-range bookmarked page", async () => {
    const router = mount("/admin/audit?page=99&page_size=10");
    expect(await screen.findByText("对象 7")).toBeVisible();
    await waitFor(() =>
      expect(router.state.location.search).toContain("page=3"),
    );
  });
  it("keeps bookmarked dates during search and resets both controls and the query", async () => {
    const user = userEvent.setup();
    const router = mount(
      "/admin/audit?action_prefix=user.&from=2026-11-06T00%3A00%3A00Z&to=2026-11-07T00%3A00%3A00Z",
    );
    expect(await screen.findByText("对象 27")).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "搜索审计" }),
      "tester{Enter}",
    );
    await waitFor(() =>
      expect(router.state.location.search).toContain("q=tester"),
    );
    expect(new URLSearchParams(router.state.location.search).get("from")).toBe(
      "2026-11-06T00:00:00Z",
    );
    await user.click(screen.getByRole("button", { name: "重置筛选" }));
    await waitFor(() =>
      expect(router.state.location.search).not.toContain("from="),
    );
    expect(screen.getByRole("textbox", { name: "搜索审计" })).toHaveValue("");
    expect(
      screen.getByRole("combobox", { name: "事件类型" }),
    ).toHaveTextContent("全部事件");
    expect(screen.getByRole("button", { name: "时间范围" })).toHaveTextContent(
      "全部时间",
    );
    await user.click(screen.getByRole("button", { name: "时间范围" }));
    expect(screen.getByLabelText("开始时间")).toHaveValue("");
    expect(screen.getByLabelText("结束时间")).toHaveValue("");
  });
});
