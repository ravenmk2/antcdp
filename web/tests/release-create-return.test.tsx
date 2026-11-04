import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { NavigationGuard } from "@/components/platform/navigation-guard";
import { ReleasePanel } from "@/features/delivery/ReleasePanel";
import { ReleasePreparation } from "@/features/delivery/ReleasePreparation";
import type { Variant } from "@/shared/delivery";
import { request } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const api = vi.mocked(request);
beforeEach(() => api.mockReset());
afterEach(cleanup);
const variant = {
  id: "2",
  name: "企业版",
  main_branch: "main",
  release_tag_prefix: "ent-",
  repository_count: 0,
  archived_at: null,
  can_manage: true,
  etag: "v1",
} as Variant;

function creation(root: string, origin?: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <NavigationGuard>
            <Outlet />
          </NavigationGuard>
        ),
        children: [
          { path: root, element: <p>原始项目页面</p> },
          {
            path: root + "/variants",
            element: (
              <ReleasePanel
                base="/projects/7/variants/2"
                variant={variant}
                manage
                data={{
                  release: null,
                  materials: null,
                  flow: null,
                  list: {
                    items: [],
                    total: 0,
                    page: 3,
                    page_size: 50,
                    mutation_version: "c1",
                    can_manage: true,
                  },
                }}
              />
            ),
          },
        ],
      },
    ],
    {
      initialEntries: [
        root +
          "/variants?variant=2&vview=releases&create=1&rq=hotfix&rpage=3&rsize=50" +
          (origin ? "&return_to=" + encodeURIComponent(origin) : ""),
      ],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it.each([
  ["/projects/7", "/projects/7"],
  [
    "/projects/7",
    "/projects/7?tab=releases&q=hotfix&status=attention&page=3&page_size=50&variant_id=2",
  ],
  ["/admin/projects/7", "/admin/projects/7?tab=releases&status=all&page=2"],
])(
  "cancels project-origin creation to %s while preserving its source",
  async (root, origin) => {
    const router = creation(root, origin);
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: "创建发布" });
    expect(screen.getByText(/当前产品分支范围内没有仓库/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(
        router.state.location.pathname + router.state.location.search,
      ).toBe(origin),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  },
);

it("confirms a dirty creation once before returning and never creates a release on cancel", async () => {
  const origin = "/projects/7?tab=releases&q=hotfix&page=3";
  const router = creation("/projects/7", origin);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("发布名称"), "未保存的发布");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有未保存的修改，确定放弃？")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/projects/7/variants");
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    expect(router.state.location.pathname + router.state.location.search).toBe(
      origin,
    ),
  );
  expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  expect(api).not.toHaveBeenCalled();
});

it.each([undefined, "https://example.com", "/admin/projects/7?tab=releases"])(
  "keeps variant-origin creation in its filtered list for an absent or invalid origin (%s)",
  async (origin) => {
    const router = creation("/projects/7", origin);
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/projects/7/variants");
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("create")).toBeNull();
    expect(params.get("rq")).toBe("hotfix");
    expect(params.get("rpage")).toBe("3");
    expect(params.get("rsize")).toBe("50");
  },
);

it.each([true, false])(
  "limits repository association guidance to system administrators (%s)",
  (systemAdmin) => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <ReleasePreparation
            variant={variant}
            root="/projects/7"
            manage
            systemAdmin={systemAdmin}
          />
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText(/纯材料发布可以不包含 MR/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "检查产品分支仓库范围" }),
    ).toBeTruthy();
    const consoleLink = screen.queryByRole("link", {
      name: "在控制台关联仓库",
    });
    if (systemAdmin)
      expect(consoleLink?.getAttribute("href")).toBe(
        "/admin/projects/7?tab=repositories",
      );
    else {
      expect(consoleLink).toBeNull();
      expect(
        screen.getByText("关联仓库需由系统管理员在控制台维护。"),
      ).toBeTruthy();
    }
  },
);
