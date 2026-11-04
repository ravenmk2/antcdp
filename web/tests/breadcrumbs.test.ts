import { afterEach, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  Breadcrumbs,
  breadcrumbLayout,
  projectBreadcrumbRows,
  trail,
} from "@/app/Breadcrumbs";

afterEach(cleanup);
it("shows only local project hierarchy while the project shell owns identity and primary navigation", () => {
  const path = "/projects/4/variants";
  const data = {
    project: { name: "支付" },
    variant: { name: "标准版" },
    releases: { release: { name: "秋季更新", version_label: "1.4" } },
  };
  const search = "?variant=8&vview=releases&release=73";
  const rows = trail(path, search, data);
  expect(rows.at(-1)?.label).toBe("秋季更新");
  expect(projectBreadcrumbRows(rows, path, search)).toEqual([]);
  expect(
    projectBreadcrumbRows(
      trail(path, "?variant=8", data),
      path,
      "?variant=8",
    ).map((row) => row.label),
  ).toEqual(["产品变体", "标准版"]);
  const credentials = "/projects/4/integrations/3";
  expect(
    projectBreadcrumbRows(
      trail(credentials, "", {
        project: { name: "支付", is_member: false },
        selected: { name: "GitLab" },
      }),
      credentials,
      "",
    )[0],
  ).toEqual({
    label: "访问凭证",
    to: "/admin/projects/4?tab=settings&section=credentials",
  });
});
it("keeps administration and workspace project hierarchies separate", () => {
  for (const prefix of ["", "/admin"]) {
    const rows = trail(
      prefix + "/projects/4/variants",
      "?q=client&variant=8&epage=3",
      { project: { name: "支付" }, variant: { name: "定制" } },
    );
    expect(rows.map((c) => c.label)).toEqual([
      prefix ? "控制台" : "工作区",
      prefix ? "项目管理" : "我的项目",
      "支付",
      "产品变体",
      "定制",
    ]);
    expect(rows.at(-2)?.to).toBe(prefix + "/projects/4/variants?q=client");
  }
});
it("uses scoped names from the current loader", () => {
  expect(
    trail("/projects/4/integrations/3", "", {
      project: { name: "测试项目" },
      selected: { name: "GitLab" },
    }).map((c) => c.label),
  ).toEqual(["工作区", "我的项目", "测试项目", "项目集成凭证", "GitLab"]);
});

it("returns to the filtered release list without keeping the detail selection", () => {
  const path = "/admin/projects/4/variants";
  const rows = trail(
    path,
    "?variant=8&vview=releases&rpage=2&rstatus=reviewing&release=73",
    {
      variant: { name: "标准版" },
      releases: { release: { version_label: "1.4.0" } },
    },
  );
  expect(rows.slice(-3).map(({ label, to }) => [label, to])).toEqual([
    ["标准版", path + "?variant=8"],
    ["发布管理", path + "?variant=8&vview=releases&rpage=2&rstatus=reviewing"],
    [
      "1.4.0",
      path + "?variant=8&vview=releases&rpage=2&rstatus=reviewing&release=73",
    ],
  ]);
});

it.each([
  ["description", "项目介绍"],
  ["releases", "发布"],
  ["repositories", "仓库"],
])(
  "labels project %s pages without mixing them into team navigation",
  (tab, label) => {
    expect(
      trail("/projects/4", "?tab=" + tab, { resource: { name: "支付" } }).map(
        (c) => c.label,
      ),
    ).toEqual(["工作区", "我的项目", "支付", label]);
    expect(
      trail("/teams/4", "?tab=" + tab, { resource: { name: "交付" } }).at(-1)
        ?.label,
    ).toBe("交付");
  },
);

it.each([
  ["?tab=settings", "general", "基本资料"],
  ["?tab=settings&section=members", "members", "成员"],
  ["?tab=settings&section=teams", "teams", "团队授权"],
  ["?tab=settings&section=branches", "branches", "分支规则"],
  ["?tab=settings&section=credentials", "credentials", "访问凭证"],
  ["?tab=members", "members", "成员"],
  ["?tab=teams", "teams", "团队授权"],
  ["?tab=branch-model", "branches", "分支规则"],
  ["?tab=settings&section=unknown", "general", "基本资料"],
])(
  "preserves settings hierarchy for %s and canonical parent links",
  (search, section, label) => {
    const rows = trail("/admin/projects/4", search, {
      resource: { name: "支付" },
    });
    expect(rows.slice(-2)).toEqual([
      { label: "项目设置", to: "/admin/projects/4?tab=settings" },
      { label, to: "/admin/projects/4?tab=settings&section=" + section },
    ]);
    expect(new Set(rows.map((c) => c.to)).size).toBe(rows.length);
  },
);

it("labels linked SSH subviews without exposing administrative tabs in personal scope", () => {
  expect(
    trail("/admin/remote-hosts/5", "?tab=keys", {
      host: { name: "构建机" },
    }).at(-1)?.label,
  ).toBe("主机公钥");
  expect(
    trail("/account/remote-hosts/5", "?tab=keys", {
      host: { name: "构建机" },
    }).at(-1)?.label,
  ).toBe("构建机");
});

it.each(["integrations", "remote-hosts"])(
  "returns a non-member system administrator from project %s to a reachable console parent",
  (section) => {
    const rows = trail(`/projects/4/${section}/3`, "", {
      project: { name: "测试项目", is_member: false },
    });
    expect(rows.find((row) => row.label === "测试项目")?.to).toBe(
      "/admin/projects/4",
    );
    expect(rows.find((row) => row.label === "项目管理")?.to).toBe(
      "/admin/projects",
    );
    expect(rows.at(-2)?.to).toBe(`/projects/4/${section}`);
  },
);

it.each(["", "/admin"])(
  "keeps project, variant and release context in a compact desktop trail for %s",
  (prefix) => {
    const path = prefix + "/projects/4/variants";
    const rows = trail(
      path,
      "?q=client&variant=8&vview=releases&rpage=2&rstatus=reviewing&release=73",
      {
        project: { name: "支付" },
        variant: { name: "标准版" },
        releases: { release: { version_label: "1.4.0" } },
      },
    );
    const desktop = breadcrumbLayout(rows);
    expect(desktop.visible.map((c) => c.label)).toEqual([
      "支付",
      "标准版",
      "1.4.0",
    ]);
    expect(desktop.collapsed.at(-1)?.to).toBe(
      path + "?q=client&variant=8&vview=releases&rpage=2&rstatus=reviewing",
    );
    expect(desktop.collapsed.map((c) => c.label)).toContain("产品变体");

    const narrow = breadcrumbLayout(rows, true);
    expect(narrow.visible.map((c) => c.label)).toEqual(["发布管理", "1.4.0"]);
    expect(narrow.collapsed.map((c) => c.label)).toContain("支付");
    expect(narrow.collapsed.map((c) => c.label)).toContain("标准版");
    expect(new Set([...desktop.visible, ...desktop.collapsed])).toEqual(
      new Set(rows),
    );
  },
);

it("preserves short desktop trails and the nearest generic navigation levels", () => {
  const short = trail("/projects/4", "", { resource: { name: "支付" } });
  expect(breadcrumbLayout(short)).toEqual({ visible: short, collapsed: [] });
  const settings = trail("/projects/4", "?tab=settings&section=members", {
    resource: { name: "支付" },
  });
  expect(breadcrumbLayout(settings).visible.map((c) => c.label)).toEqual([
    "支付",
    "项目设置",
    "成员",
  ]);
});

it("reveals a full current name through keyboard focus and dismisses it with Escape", async () => {
  const user = userEvent.setup();
  const name =
    "面向多个交付团队的超长项目名称，用于验证完整名称可以通过键盘查看";
  const data = { resource: { name } };
  const router = createMemoryRouter(
    [
      {
        id: "project",
        path: "/projects/:id",
        loader: () => data,
        element: createElement(Breadcrumbs, { user: "breadcrumb-test" }),
      },
    ],
    {
      initialEntries: ["/projects/4"],
      hydrationData: { loaderData: { project: data } },
    },
  );
  render(createElement(RouterProvider, { router }));
  const current = screen.getByText(name);
  for (let i = 0; i < 6 && document.activeElement !== current; i++)
    await user.tab();
  expect(document.activeElement).toBe(current);
  expect(current.getAttribute("aria-current")).toBe("page");
  expect((await screen.findByRole("tooltip")).textContent).toBe(name);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  router.dispose();
});
