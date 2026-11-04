import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Component } from "@/features/collaboration/DetailPage";
import { ShortcutsProvider } from "@/features/collaboration/Shortcuts";
import { request } from "@/lib/api";
import type { Resource } from "@/shared/collaboration";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(request).mockImplementation(async (path) => ({
    data:
      path === "/me/sidebar-shortcuts"
        ? {
            projects: { items: [], etag: '"projects"' },
            teams: { items: [], etag: '"teams"' },
          }
        : [],
    etag: '"version"',
  }));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const team: Resource = {
  id: "8",
  code: "design",
  name: "设计团队",
  description: "协作说明",
  summary: "",
  status: "active",
  can_manage: true,
  is_member: true,
  direct_role: "admin",
  etag: '"info"',
  membership_etag: '"members"',
  dissolve_etag: '"both"',
  icon_key: null,
  icon_file_id: null,
  member_count: 3,
};
function openTeam(admin: boolean, tab: string, resource = team) {
  const base = admin ? "/admin/teams" : "/teams";
  const router = createMemoryRouter(
    [
      {
        path: base + "/8",
        loader: () => ({ resource, kind: "teams", admin, base }),
        element: (
          <ShortcutsProvider>
            <Component />
          </ShortcutsProvider>
        ),
      },
    ],
    { initialEntries: [base + "/8?tab=" + tab] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it("keeps team relation links and uses the team endpoint for bookmarked tabs", async () => {
  openTeam(false, "projects");
  await screen.findByText("展示当前团队已加入且你可以访问的项目。");
  const nav = within(screen.getByRole("navigation", { name: "详情导航" }));
  expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "概览",
    "成员 · 3",
    "加入项目",
  ]);
  expect(
    nav.getByRole("link", { name: "加入项目" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    vi
      .mocked(request)
      .mock.calls.some(([path]) => path === "/teams/8/projects"),
  ).toBe(true);
  expect(screen.queryByRole("navigation", { name: "项目设置分类" })).toBeNull();
});

it.each([true, false])(
  "retains team editing and reserves dissolution for console access: %s",
  async (admin) => {
    openTeam(admin, "overview");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: "编辑资料" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "退出团队" })).toBeTruthy();
    expect(!!screen.queryByRole("menuitem", { name: "解散团队" })).toBe(admin);
    expect(screen.queryByRole("menuitem", { name: "归档项目" })).toBeNull();
  },
);

it("keeps dissolved team details read only and falls back from unknown tabs", async () => {
  openTeam(true, "branch-model", { ...team, status: "dissolved" });
  const user = userEvent.setup();
  await screen.findByText("团队已解散，资料与关系只读。");
  expect(
    screen.getByRole("link", { name: "概览" }).getAttribute("aria-current"),
  ).toBe("page");
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.queryByRole("menuitem", { name: "编辑资料" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "解散团队" })).toBeNull();
});
