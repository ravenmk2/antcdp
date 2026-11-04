import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  ProjectOverview,
  ProjectReleases,
} from "@/features/collaboration/ProjectWorkspace";
import type { Resource } from "@/shared/collaboration";
import { useQuery } from "@/lib/use-query";
import { useIdentity, type Identity } from "@/app/identity";

vi.mock("@/lib/use-query", () => ({ useQuery: vi.fn() }));
vi.mock("@/app/identity", () => ({
  useIdentity: vi.fn(() => ({ session: { user: { role: "user" } } })),
}));
vi.mock("@/lib/date", () => ({ useDate: () => (v: string) => v }));
const project = {
  id: "7",
  status: "active",
  can_manage: true,
  etag: "p1",
} as Resource;
const release = {
  id: "4",
  variant_id: "2",
  variant_name: "企业版",
  version_label: "1.2",
  tag_name: "ent-1.2",
  status: "draft",
  updated_at: "2026-11-04",
  needs_attention: false,
};
const page = { items: [release], total: 31, page: 1, page_size: 20 };
function result(data: unknown) {
  return {
    data,
    response: undefined,
    loading: false,
    error: "",
    refresh: vi.fn(),
  };
}
function mount(element: React.ReactNode, search = "") {
  const router = createMemoryRouter([{ path: "/projects/7", element }], {
    initialEntries: ["/projects/7" + search],
  });
  render(<RouterProvider router={router} />);
  return router;
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("prioritizes uncertain operations and uses server totals with bounded previews", () => {
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 25,
      releases: page,
      attention: {
        items: [{ ...release, id: "6", needs_attention: true }],
        total: 2,
      },
      variants: { items: [], total: 12 },
    }),
  );
  mount(<ProjectOverview project={project} admin={false} />);
  expect(
    screen.getByRole("link", { name: "查看并核实" }).getAttribute("href"),
  ).toBe(
    "/projects/7/variants?variant=2&vview=releases&release=6&return_to=%2Fprojects%2F7",
  );
  expect(screen.getByRole("heading", { name: "进行中的发布 31" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "未归档变体 12" })).toBeTruthy();
});
it("offers read-only history for archived projects without a setup call to action", () => {
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 0,
      releases: { items: [], total: 0 },
      attention: { items: [], total: 0 },
      variants: { items: [], total: 0 },
    }),
  );
  mount(<ProjectOverview project={{ ...project, status: "archived" }} admin />);
  expect(
    screen.getByRole("link", { name: "查看发布记录" }).getAttribute("href"),
  ).toBe("/admin/projects/7?tab=releases&status=all");
  expect(screen.queryByRole("link", { name: "关联项目仓库" })).toBeNull();
  expect(screen.queryByText(/代码协作从关联仓库开始/)).toBeNull();
  expect(screen.queryByText(/准备一个版本/)).toBeNull();
});

it("directs a read-only member to view uncertain results and contact a project administrator", () => {
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 1,
      releases: page,
      attention: { items: [{ ...release, needs_attention: true }], total: 1 },
      variants: { items: [], total: 0 },
    }),
  );
  mount(
    <ProjectOverview
      project={{ ...project, can_manage: false }}
      admin={false}
    />,
  );
  expect(screen.getByRole("link", { name: "查看发布详情" })).toBeTruthy();
  expect(screen.getByText(/请项目管理员核实后继续处理/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "查看并核实" })).toBeNull();
});

it("applies page-size changes inside the variant picker", async () => {
  vi.mocked(useQuery).mockImplementation((path) =>
    result(
      path?.includes("/variants?")
        ? {
            items: [{ id: "2", name: "企业版", main_branch: "main" }],
            total: 42,
          }
        : page,
    ),
  );
  mount(<ProjectReleases project={project} admin={false} />, "?tab=releases");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "创建发布" }));
  const dialog = screen.getByRole("dialog");
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "每页条数" }),
    "50",
  );
  expect(useQuery).toHaveBeenLastCalledWith(
    "/projects/7/variants?q=&archived=active&page=1&page_size=50",
  );
});
it("keeps project release filtering in the URL, resets pagination and respects read-only access", async () => {
  vi.mocked(useQuery).mockReturnValue(result(page));
  const router = mount(
    <ProjectReleases
      project={{ ...project, can_manage: false }}
      admin={false}
    />,
    "?tab=releases&page=2&status=all&variant_id=2",
  );
  expect(screen.queryByRole("button", { name: "创建发布" })).toBeNull();
  expect(screen.getByRole("link", { name: "1.2" }).getAttribute("href")).toBe(
    "/projects/7/variants?variant=2&vview=releases&release=4&return_to=%2Fprojects%2F7%3Ftab%3Dreleases%26page%3D2%26status%3Dall%26variant_id%3D2",
  );
  await userEvent
    .setup()
    .selectOptions(
      screen.getByRole("combobox", { name: "发布状态" }),
      "attention",
    );
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("page")).toBeNull();
  expect(params.get("variant_id")).toBe("2");
  expect(params.get("tab")).toBe("releases");
  expect(useQuery).toHaveBeenLastCalledWith(
    "/projects/7/releases?page=1&page_size=20&q=&status=attention&variant_id=2",
  );
});

it("shows each attention release once while retaining its phase and the actual total", () => {
  const named = {
    ...release,
    name: "会员体系升级",
    status: "integrating",
    needs_attention: true,
  };
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 3,
      releases: { ...page, items: [named], total: 14 },
      attention: { items: [named], total: 1 },
      variants: { items: [], total: 0 },
    }),
  );
  mount(<ProjectOverview project={project} admin={false} />);
  expect(screen.getAllByRole("link", { name: "会员体系升级" })).toHaveLength(1);
  expect(screen.getByText("合并与备料")).toBeTruthy();
  expect(screen.getByText("结果待核实")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "进行中的发布 14" })).toBeTruthy();
  expect(screen.queryByText("暂无进行中的发布")).toBeNull();
  expect(screen.getByText(/总数包含需核实的发布/)).toBeTruthy();
});

it("does not choose an arbitrary variant for repository navigation", () => {
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 2,
      releases: page,
      attention: { items: [], total: 0 },
      variants: {
        items: [
          {
            id: "8",
            name: "客户版",
            main_branch: "customer/main",
            repository_count: 2,
            binding_validity: "invalid",
            binding_reason: "changed",
          },
        ],
        total: 22,
      },
    }),
  );
  mount(<ProjectOverview project={project} admin={false} />);
  expect(
    screen.getByRole("link", { name: "关联仓库 2" }).getAttribute("href"),
  ).toBe("/projects/7?tab=repositories");
  expect(
    screen
      .getByRole("link", { name: /客户版.*customer\/main/ })
      .getAttribute("href"),
  ).toBe("/projects/7/variants?variant=8&vview=repositories");
  expect(screen.queryByRole("link", { name: "查看仓库与分支" })).toBeNull();
  expect(screen.getByRole("link", { name: "未归档变体 22" })).toBeTruthy();
});

it("lets an empty project prepare a materials-only release without requiring a repository", () => {
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 0,
      releases: { items: [], total: 0 },
      attention: { items: [], total: 0 },
      variants: { items: [], total: 1 },
    }),
  );
  mount(<ProjectOverview project={project} admin={false} />);
  expect(
    screen.getByRole("link", { name: "创建发布" }).getAttribute("href"),
  ).toBe("/projects/7?tab=releases&create=1&return_to=%2Fprojects%2F7");
  expect(screen.getByText(/只包含材料的发布/)).toBeTruthy();
  expect(
    screen.getByText(/开始发布仍需至少一个仓库及已确认的基线/),
  ).toBeTruthy();
  expect(screen.getByText(/请系统管理员在控制台关联仓库/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "在控制台关联仓库" })).toBeNull();
});

it("gives a system administrator in the workspace a console repository entry", () => {
  vi.mocked(useIdentity).mockReturnValue({
    session: { user: { role: "admin" } },
  } as Identity);
  vi.mocked(useQuery).mockReturnValue(
    result({
      repository_count: 0,
      releases: { items: [], total: 0 },
      attention: { items: [], total: 0 },
      variants: { items: [], total: 1 },
    }),
  );
  mount(<ProjectOverview project={project} admin={false} />);
  expect(
    screen.getByRole("link", { name: "在控制台关联仓库" }).getAttribute("href"),
  ).toBe("/admin/projects/7?tab=repositories");
});

it.each([
  ["?tab=releases&create=1&return_to=%2Fprojects%2F7", "/projects/7"],
  [
    "?tab=releases&q=hotfix&status=attention&page=3&page_size=50&variant_id=2",
    "/projects/7?tab=releases&q=hotfix&status=attention&page=3&page_size=50&variant_id=2",
  ],
])(
  "preserves the creation source when choosing a variant from %s",
  async (search, origin) => {
    vi.mocked(useQuery).mockImplementation((path) =>
      result(
        path?.includes("/variants?")
          ? {
              items: [
                {
                  id: "2",
                  name: "企业版",
                  main_branch: "main",
                  repository_count: 0,
                },
              ],
              total: 1,
            }
          : page,
      ),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/projects/7",
          element: <ProjectReleases project={project} admin={false} />,
        },
        { path: "/projects/7/variants", element: <p>创建发布目标</p> },
      ],
      { initialEntries: ["/projects/7" + search] },
    );
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    if (!search.includes("create=1"))
      await user.click(screen.getByRole("button", { name: "创建发布" }));
    await user.click(await screen.findByRole("button", { name: /企业版/ }));
    const next = new URLSearchParams(router.state.location.search);
    expect(next.get("return_to")).toBe(origin);
    expect(next.get("create")).toBe("1");
  },
);
