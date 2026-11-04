import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Component } from "@/features/delivery/VariantsPage";
import type { Variant, Environment } from "@/shared/delivery";

vi.mock("@/features/delivery/RepositoryBranches", () => ({
  RepositoryBranches: () => <section aria-label="仓库与分支工作区" />,
}));
vi.mock("@/features/delivery/ReleasePanel", () => ({
  ReleasePanel: () => <section aria-label="发布工作区" />,
}));
vi.mock("@/features/delivery/ConfigurationDrawer", () => ({
  ConfigurationDrawer: ({
    target,
  }: {
    target: { kind: string; value?: { name: string } };
  }) => (
    <div role="dialog" aria-label={target.kind}>
      {target.value?.name || "新建"}
    </div>
  ),
}));
afterEach(cleanup);
const variant: Variant = {
  id: "2",
  name: "标准版",
  code: "standard",
  summary: "",
  kind: "standard",
  main_branch: "main",
  repository_scope: { mode: "all", rules: [], repository_ids: [] },
  archived_at: null,
  can_manage: true,
  binding_validity: "valid",
  binding_reason: "",
  repository_count: 1,
  environment_count: 1,
  etag: "v1",
};
const environment: Environment = {
  id: "3",
  name: "测试环境",
  code: "test",
  summary: "",
  branch_type: "mainline",
  branch_name: "main",
  repository_scope: { mode: "inherit", rules: [], repository_ids: [] },
  can_manage: true,
  binding_validity: "valid",
  binding_reason: "",
  repository_count: 1,
  etag: "e1",
};
function show({
  invalid = false,
  empty = false,
  manage = true,
  release = "",
  view = "environments",
  archived = false,
  projectArchived = false,
} = {}) {
  const data = {
    project: {
      id: "1",
      name: "项目",
      can_manage: manage,
      status: projectArchived ? "archived" : "active",
    },
    model: {},
    variant: {
      ...variant,
      kind: archived ? "custom" : "standard",
      archived_at: archived ? "2026-11-04" : null,
      binding_validity: invalid ? "unclassified" : "valid",
      binding_reason: invalid ? "unclassified" : "",
    },
    releases: release
      ? { release: release === "detail" ? { id: "4" } : null }
      : null,
    variantCollection: "c1",
    environments: {
      items: empty ? [] : [environment],
      total: empty ? 0 : 1,
      mutation_version: "e1",
    },
    variants: null,
    page: 1,
    size: 20,
    status: "active",
    q: "",
    admin: false,
  };
  const router = createMemoryRouter(
    [{ path: "/projects/:projectId/variants", loader: () => data, Component }],
    {
      initialEntries: [
        "/projects/1/variants?variant=2" +
          (release ? "&vview=releases" : view ? "&vview=" + view : "") +
          (release === "detail" ? "&release=4" : ""),
      ],
    },
  );
  render(<RouterProvider router={router} />);
}
it("keeps task navigation compact and opens an environment from its name", async () => {
  show();
  const nav = await screen.findByRole("navigation", { name: "产品分支功能" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["仓库与分支", "环境", "发布"]);
  expect(screen.queryByText("删除环境")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "查看环境 测试环境" }));
  expect(screen.getByRole("dialog", { name: "environment" })).toBeTruthy();
});

it.each(["list", "detail"])(
  "explains an archived variant on its release %s and offers authorized restoration",
  async (release) => {
    show({ release, archived: true });
    expect(
      await screen.findByText(/此产品分支已归档，配置、环境和发布只读/),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "恢复产品分支" }));
    expect(
      await screen.findByRole("dialog", { name: "恢复产品分支" }),
    ).toBeTruthy();
  },
);

it.each([
  { manage: false, projectArchived: false },
  { manage: true, projectArchived: true },
])(
  "does not offer restoration without an active manageable parent (%j)",
  async (options) => {
    show({ release: "detail", archived: true, ...options });
    expect(
      await screen.findByText(/此产品分支已归档，配置、环境和发布只读/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复产品分支" })).toBeNull();
  },
);
it("explains an invalid main branch binding before users attempt branch work", async () => {
  show({ invalid: true });
  expect(await screen.findByText("主干绑定需要核对")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "查看 Git 分支规则" })
      .getAttribute("href"),
  ).toBe("/projects/1?tab=branch-model");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "检查产品分支设置" }));
  expect(screen.getByRole("dialog", { name: "variant" })).toBeTruthy();
});
it.each([true, false])(
  "gives an empty environment list a permission-aware next action (%s)",
  async (manage) => {
    show({ empty: true, manage });
    await screen.findByText("为需要长期跟踪的环境绑定 Git 分支");
    if (manage)
      expect(screen.getByRole("button", { name: "添加首个环境" })).toBeTruthy();
    else {
      expect(screen.queryByRole("button", { name: "添加首个环境" })).toBeNull();
      expect(screen.getByRole("link", { name: "查看仓库与分支" })).toBeTruthy();
    }
  },
);
it.each(["list", "detail"])(
  "keeps variant navigation only at the release list level (%s)",
  async (release) => {
    show({ release });
    await screen.findByRole("region", { name: "发布工作区" });
    expect(screen.queryByRole("navigation", { name: "项目导航" })).toBeNull();
    if (release === "detail")
      expect(
        screen.queryByRole("navigation", { name: "产品分支功能" }),
      ).toBeNull();
    else
      expect(
        screen.getByRole("navigation", { name: "产品分支功能" }),
      ).toBeTruthy();
  },
);

it("opens repository work by default and keeps explicit environment bookmarks", async () => {
  show({ view: "" });
  expect(
    await screen.findByRole("region", { name: "仓库与分支工作区" }),
  ).toBeTruthy();
  const navigation = screen.getByRole("navigation", { name: "产品分支功能" });
  expect(
    within(navigation)
      .getByRole("link", { name: "仓库与分支" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    within(navigation).getByRole("link", { name: "环境" }).getAttribute("href"),
  ).toBe("/projects/1/variants?variant=2&vview=environments");
});
