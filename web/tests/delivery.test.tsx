import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { request, ApiError } from "@/lib/api";
import { ScopeEditor } from "@/features/delivery/ScopeEditor";
import { ConfigurationDrawer } from "@/features/delivery/ConfigurationDrawer";
import {
  emptyScope,
  type BranchModel,
  type Environment,
  type Variant,
} from "@/shared/delivery";
import { useQuery } from "@/lib/use-query";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
const page = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
  mutation_version: '"collection-1"',
  can_manage: true,
};
const variant: Variant = {
  id: "1",
  code: "standard",
  name: "标准产品分支",
  summary: "",
  kind: "standard",
  main_branch: "main",
  repository_scope: emptyScope(),
  archived_at: null,
  etag: '"v1"',
  can_manage: true,
  binding_validity: "valid",
  binding_reason: "",
  repository_count: 0,
  environment_count: 1,
};
const environment: Environment = {
  id: "2",
  code: "test",
  name: "测试环境",
  summary: "",
  branch_type: "mainline",
  branch_name: "main",
  repository_scope: emptyScope(true),
  etag: '"e1"',
  can_manage: true,
  binding_validity: "valid",
  binding_reason: "",
  repository_count: 0,
};
const model: BranchModel = {
  rules: [
    {
      branch_type: "mainline",
      enabled: true,
      rule: { mode: "exact", pattern: "main" },
    },
  ],
  types: [
    {
      branch_type: "mainline",
      label: "主线",
      description: "",
      allow_environment: true,
    },
  ],
  etag: '"m1"',
  can_manage: true,
};
beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({ data: page, etag: "" });
});
afterEach(cleanup);
function drawer({ archived = false, edit = false } = {}) {
  const close = vi.fn(),
    saved = vi.fn();
  render(
    <ConfigurationDrawer
      projectId="9"
      variant={{ ...variant, archived_at: archived ? "2026-01-01" : null }}
      model={model}
      target={{
        kind: "environment",
        value: environment,
        collectionTag: '"ec1"',
        edit,
      }}
      canManage
      onClose={close}
      onSaved={saved}
    />,
  );
  return { close, saved, user: userEvent.setup() };
}
it("does not display an old scope preview after the draft changes", async () => {
  let resolve!: (value: unknown) => void;
  mocked.mockImplementation((path) =>
    path.includes("scope-preview")
      ? (new Promise((r) => {
          resolve = r;
        }) as never)
      : (Promise.resolve({ data: page, etag: "" }) as never),
  );
  function Harness() {
    const [scope, setScope] = useState(emptyScope());
    return (
      <ScopeEditor
        projectId="9"
        value={scope}
        onChange={setScope}
        connections={[]}
      />
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "预览匹配范围" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "仓库范围模式" }),
    "custom",
  );
  await act(async () => resolve({ data: { ...page, total: 99 }, etag: "" }));
  expect(screen.queryByText("当前匹配 99 个仓库")).toBeNull();
});
it("keeps manual selection across pages and clears it only on an explicit mode change", async () => {
  mocked.mockResolvedValue({
    data: {
      ...page,
      items: [{ id: "7", full_path: "group/api", connection_name: "服务" }],
    },
    etag: "",
  });
  function Harness() {
    const [scope, setScope] = useState({
      ...emptyScope(),
      mode: "custom",
      repository_ids: ["8"],
    });
    return (
      <ScopeEditor
        projectId="9"
        value={scope}
        onChange={setScope}
        connections={[]}
      />
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: "group/api" }));
  expect(screen.getByText(/已选择 2 个/)).toBeTruthy();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "仓库范围模式" }),
    "all",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "仓库范围模式" }),
    "custom",
  );
  expect(screen.getByText(/已选择 0 个/)).toBeTruthy();
});
it("returns from dirty editing to the original detail after explicit discard", async () => {
  const { user, close } = drawer();
  await user.click(screen.getByRole("button", { name: "编辑环境" }));
  await user.clear(screen.getByLabelText("名称", { exact: false }));
  await user.type(
    screen.getByLabelText("名称", { exact: false }),
    "未保存名称",
  );
  await user.click(screen.getByRole("button", { name: "取消编辑" }));
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "未保存修改确认",
  );
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.getByRole("button", { name: "编辑环境" })).toBeTruthy();
  expect(screen.queryByDisplayValue("未保存名称")).toBeNull();
  expect(mocked.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it("keeps archived environments read-only", () => {
  drawer({ archived: true });
  expect(screen.queryByRole("button", { name: "编辑环境" })).toBeNull();
  expect(screen.getByText("当前配置只读。")).toBeTruthy();
});
it("saves environment configuration with its exact ETag and without changing its code", async () => {
  mocked.mockImplementation(
    async (_path, options) =>
      ({
        data:
          options?.method === "PATCH"
            ? { ...environment, name: "新名称", etag: '"e2"' }
            : page,
        etag: "",
      }) as never,
  );
  const { user, saved } = drawer({ edit: true });
  await user.clear(screen.getByLabelText("名称", { exact: false }));
  await user.type(screen.getByLabelText("名称", { exact: false }), "新名称");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const write = mocked.mock.calls.find(([, o]) => o?.method === "PATCH")!;
  expect(write[0]).toBe("/projects/9/variants/1/environments/2");
  expect(write[1]?.etag).toBe('"e1"');
  expect(write[1]?.body).toEqual({
    name: "新名称",
    summary: "",
    branch_name: "main",
    branch_type: "mainline",
    repository_scope: emptyScope(true),
  });
  expect(screen.getByRole("button", { name: "编辑环境" })).toBeTruthy();
});
it("focuses a repository scope error and preserves the invalid draft", async () => {
  mocked.mockRejectedValue(
    new ApiError("VALIDATION_FAILED", "范围无效", [
      {
        field: "repository_scope.repository_ids",
        code: "repository_out_of_scope",
      },
    ]),
  );
  const { user } = drawer({ edit: true });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("所选仓库已不在当前产品分支范围内，请重新选择");
  expect(document.activeElement).toBe(
    screen.getByRole("combobox", { name: "仓库范围模式" }),
  );
});
it("blocks dismissal and duplicate submits while a write is pending", async () => {
  let finish!: (value: unknown) => void;
  mocked.mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }) as never,
  );
  const { user, close } = drawer({ edit: true });
  await user.dblClick(screen.getByRole("button", { name: "保存" }));
  expect(mocked).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish({ data: environment, etag: '"e2"' }));
});
it("ignores a late read after switching resource identity", async () => {
  let old!: (value: unknown) => void;
  mocked.mockImplementation((path) =>
    path === "/old"
      ? (new Promise((r) => {
          old = r;
        }) as never)
      : (Promise.resolve({ data: { name: "新对象" }, etag: "" }) as never),
  );
  function Read({ path }: { path: string }) {
    const q = useQuery<{ name: string }>(path);
    return <p>{q.data?.name || "加载中"}</p>;
  }
  const view = render(<Read path="/old" />);
  view.rerender(<Read path="/new" />);
  await screen.findByText("新对象");
  await act(async () => old({ data: { name: "旧对象" }, etag: "" }));
  expect(screen.queryByText("旧对象")).toBeNull();
});
