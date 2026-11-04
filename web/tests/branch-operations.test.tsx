import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { request, ApiError } from "@/lib/api";
import { CreationDrawer } from "@/features/delivery/CreationDrawer";
import { BranchModelPanel } from "@/features/delivery/BranchModelPanel";
import { RepositoryBranches } from "@/features/delivery/RepositoryBranches";
import type { Variant } from "@/shared/delivery";
vi.mock("@/lib/date", () => ({ useDate: () => (v: string) => v }));
vi.mock("@/lib/api", async (o) => ({
  ...(await o<object>()),
  request: vi.fn(),
}));
const mock = vi.mocked(request);
beforeEach(() => {
  mock.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const variant = {
  id: "9",
  name: "客户版",
  main_branch: "custom/a",
  etag: "v1",
  can_manage: true,
  binding_validity: "valid",
  archived_at: null,
} as Variant;
const plan = {
  id: "4",
  variant_id: "9",
  target_branch: "custom/a",
  default_source_branch: "main",
  status: "prepared",
  etag: "p1",
  expired: false,
  can_execute: true,
  counts: {},
};
it("verifies a lost preparation with the exact same key and never executes as part of preparing", async () => {
  let attempts = 0;
  mock.mockImplementation(async (path, opts) => {
    if (opts?.method === "POST") {
      if (++attempts === 1) throw new ApiError("NETWORK_ERROR", "响应丢失");
      return { data: plan, etag: "p1" };
    }
    return {
      data: path.includes("/items?") ? { items: [], total: 0 } : plan,
      etag: "",
    };
  });
  const u = userEvent.setup();
  render(
    <CreationDrawer
      projectId="1"
      variant={variant}
      selection={{
        items: [{ id: "7", full_path: "org/api" }],
        scope: "scope1",
      }}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(screen.queryByLabelText("org/api")).toBeNull();
  await u.selectOptions(screen.getByLabelText("为个别仓库指定来源"), "7");
  await u.type(screen.getByLabelText("org/api"), "release");
  await u.click(screen.getByText("预览创建清单"));
  await u.click(await screen.findByText("核对原创建计划"));
  await screen.findByLabelText("创建计划清单");
  const posts = mock.mock.calls.filter(([, o]) => o?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]![1]?.headers?.["Idempotency-Key"]).toMatch(/^[a-f0-9-]{36}$/);
  expect(posts[0]![1]?.body).toMatchObject({
    repository_ids: ["7"],
    scope_token: "scope1",
    default_source_branch: "main",
  });
});
it("requires explicit adoption of an existing branch and a separate execution confirmation", async () => {
  let executed = false;
  mock.mockImplementation(async (path, o) => {
    if (o?.method === "POST") {
      executed = true;
      return { data: {}, etag: "" };
    }
    return {
      data: path.includes("/items?")
        ? {
            total: 1,
            items: [
              {
                id: "6",
                repository_id: "7",
                repository_path: "org/api",
                preview_state: "existing",
                preview_reason: "",
                source_branch: "main",
                status: executed ? "used_existing" : "pending",
              },
            ],
          }
        : {
            ...plan,
            can_execute: !executed,
            status: executed ? "completed" : "prepared",
          },
      etag: "",
    };
  });
  const u = userEvent.setup();
  render(
    <CreationDrawer
      projectId="1"
      variant={variant}
      initialId="4"
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
  const choice = await screen.findByLabelText("org/api 执行动作");
  expect((choice as HTMLSelectElement).value).toBe("skip");
  expect((screen.getByText("确认执行") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await u.selectOptions(choice, "use_existing");
  await u.click(screen.getByText("确认执行"));
  expect(executed).toBe(false);
  await u.click(screen.getByText("执行已选动作"));
  await waitFor(() => expect(executed).toBe(true));
  expect(mock).toHaveBeenCalledWith("/projects/1/branch-creations/4/execute", {
    method: "POST",
    etag: "p1",
    body: { items: [{ id: "6", action: "use_existing" }] },
  });
});
it("requires an impact preview for the current draft before saving branch rules", async () => {
  const model = {
    can_manage: true,
    types: [
      { branch_type: "mainline", label: "主线", allow_environment: true },
    ],
    rules: [
      {
        branch_type: "mainline",
        enabled: true,
        rule: { mode: "exact", pattern: "main" },
      },
    ],
    etag: "m1",
  };
  mock.mockImplementation(async (path) => ({
    data: path.includes("/preview")
      ? {
          samples: [],
          impacts: { items: [], total: 1 },
          impact_token: "checked",
        }
      : model,
    etag: "m1",
  }));
  const u = userEvent.setup();
  render(<BranchModelPanel projectId="1" canManage />);
  await u.click(await screen.findByRole("button", { name: "编辑规则" }));
  const field = await screen.findByLabelText("mainline 命名规则");
  await u.type(field, "2");
  await u.click(screen.getByText("检查匹配与影响"));
  await screen.findByText(/受影响绑定/);
  await u.type(field, "3");
  expect((screen.getByText("保存规则") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await u.click(screen.getByText("检查匹配与影响"));
  await screen.findByText(/受影响绑定/);
  await u.click(screen.getByText("保存规则"));
  await u.click(screen.getByText("确认修改规则"));
  expect(mock).toHaveBeenCalledWith("/projects/1/branch-model", {
    method: "PUT",
    etag: "m1",
    body: {
      rules: [
        {
          branch_type: "mainline",
          enabled: true,
          rule: { mode: "exact", pattern: "main23" },
        },
      ],
      impact_token: "checked",
    },
  });
});
it("clears repository selection when the server changes the scope token", async () => {
  let scope = "s1";
  mock.mockImplementation(async () => ({
    data: {
      scope_token: scope,
      total: 1,
      can_manage: true,
      items: [{ id: "7", full_path: "org/api" }],
    },
    etag: "",
  }));
  const u = userEvent.setup(),
    view = render(
      <RepositoryBranches projectId="1" variant={variant} allowed />,
    );
  await u.click(await screen.findByLabelText("选择 org/api"));
  scope = "s2";
  view.rerender(
    <RepositoryBranches
      projectId="1"
      variant={{ ...variant, etag: "v2" }}
      allowed
    />,
  );
  await screen.findByText(/仓库范围已变化/);
  expect(
    (screen.getByRole("button", { name: "校验所选分支" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("shows rules read-only and requires explicit discard before leaving a modified rule editor", async () => {
  mock.mockResolvedValue({
    data: {
      can_manage: true,
      types: [
        { branch_type: "mainline", label: "主线", allow_environment: true },
      ],
      rules: [
        {
          branch_type: "mainline",
          enabled: true,
          rule: { mode: "exact", pattern: "main" },
        },
      ],
      etag: "m1",
    },
    etag: "m1",
  });
  render(<BranchModelPanel projectId="1" canManage />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "编辑规则" });
  expect(screen.queryByLabelText("mainline 命名规则")).toBeNull();
  await user.click(screen.getByRole("button", { name: "编辑规则" }));
  const field = screen.getByLabelText("mainline 命名规则");
  expect(document.activeElement).toBe(field);
  await user.type(field, "-draft");
  await user.click(screen.getByRole("button", { name: "取消编辑" }));
  expect(screen.getByRole("dialog", { name: "放弃规则修改" })).toBeTruthy();
  expect(screen.getByDisplayValue("main-draft")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.queryByLabelText("mainline 命名规则")).toBeNull();
  expect(screen.getByText("main")).toBeTruthy();
  expect(mock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
