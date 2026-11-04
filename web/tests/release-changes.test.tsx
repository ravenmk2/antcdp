import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ReleaseRepositories } from "@/features/delivery/ReleaseRepositories";
import { FlowDrawer } from "@/features/delivery/ReleaseFlowDrawer";
import type { Flow, MaterialSet, Release } from "@/features/delivery/releases";
import { ApiError, request } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const api = vi.mocked(request);
beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

const release: Release = {
  id: "1",
  version_label: "1.0",
  tag_name: "v1.0",
  description_md: "",
  status: "integrating",
  updated_at: "2026-11-04",
  etag: "r1",
};
const scope: MaterialSet = {
  can_edit: true,
  items: [],
  repositories: Array.from({ length: 20 }, (_, index) => ({
    id: String(index + 1),
    full_path: `team/repo-${index + 1}`,
    main_branch: "main",
    baseline_sha: "a".repeat(40),
    baseline_kind: "tag",
  })),
};
const flow: Flow = {
  can_manage: true,
  changes: [],
  manifests: [],
  operations: [],
  steps: [],
};
const mr: Flow["changes"][number] = {
  id: "mr-42",
  repo_id: "1",
  kind: "mr",
  ref: "42",
  status: "selected",
  evidence: {
    iid: 42,
    title: "修复登录",
    state: "opened",
    sha: "b".repeat(40),
  },
  note: "",
};
const commit: Flow["changes"][number] = {
  ...mr,
  id: "commit-1",
  repo_id: "2",
  kind: "commit",
  ref: "c".repeat(40),
  status: "included",
  evidence: { ...mr.evidence, iid: 0, title: "修正数据库索引", state: "" },
};
function repositories(currentFlow = flow, set = scope, status = "integrating") {
  const act = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/release",
        element: (
          <ReleaseRepositories
            path="/releases/1"
            flow={currentFlow}
            set={set}
            status={status}
            act={act}
          />
        ),
      },
    ],
    { initialEntries: ["/release"] },
  );
  render(<RouterProvider router={router} />);
  return act;
}
it("keeps a zero-change release compact while making every scoped baseline inspectable", async () => {
  repositories(
    flow,
    {
      ...scope,
      repositories: scope.repositories.map((repo, index) =>
        index === 19 ? { ...repo, baseline_sha: "" } : repo,
      ),
    },
    "draft",
  );
  expect(screen.getByText("本次尚未登记代码变更")).toBeTruthy();
  expect(screen.queryAllByText("本次未选变更，主干仍纳入快照。")).toHaveLength(
    0,
  );
  const disclosure = screen.getByRole("button", { name: /版本范围与基线/ });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("team/repo-20")).toBeNull();
  await userEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  const scopedRepositories = screen.getByRole("list", { name: "发布范围仓库" });
  expect(within(scopedRepositories).getAllByRole("listitem")).toHaveLength(20);
  expect(within(scopedRepositories).getByText("team/repo-1")).toBeTruthy();
  expect(within(scopedRepositories).getByText("team/repo-20")).toBeTruthy();
  expect(screen.getByText(/1 个仓库尚未确认基线/)).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});
it("explains that materials may be prepared before the empty draft scope is ready to start", () => {
  repositories(flow, { ...scope, repositories: [] }, "draft");
  expect(
    screen.getByText(
      /当前发布范围没有仓库，可先准备材料。开始发布前需补充仓库范围并确认基线/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/可以仅交付材料，或检查变体仓库配置/)).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
it("filters registered MRs and direct commits without mixing reverted history into current work", async () => {
  repositories({
    ...flow,
    changes: [
      mr,
      commit,
      {
        ...mr,
        id: "old",
        ref: "43",
        status: "reverted",
        evidence: { ...mr.evidence, iid: 43, title: "已回退优化" },
      },
    ],
  });
  const user = userEvent.setup();
  expect(screen.getByText(/修复登录/)).toBeTruthy();
  expect(screen.getByText(/修正数据库索引/)).toBeTruthy();
  expect(screen.queryByText(/已回退优化/)).toBeNull();
  const search = screen.getByRole("textbox", { name: "搜索本次变更" });
  await user.type(search, "数据库");
  expect(screen.queryByText(/修复登录/)).toBeNull();
  expect(screen.getByText(/修正数据库索引/)).toBeTruthy();
  await user.clear(search);
  await user.selectOptions(screen.getByLabelText("按仓库筛选变更"), "1");
  expect(screen.getByText(/修复登录/)).toBeTruthy();
  expect(screen.queryByText(/修正数据库索引/)).toBeNull();
  await user.selectOptions(
    screen.getByLabelText("按处理状态筛选变更"),
    screen.getByRole("option", { name: /历史记录/ }),
  );
  expect(screen.getByText(/已回退优化/)).toBeTruthy();
  expect(screen.queryByText(/修复登录/)).toBeNull();
});
it("lets a reader inspect changes and scope without exposing write commands", async () => {
  const act = repositories(
    { ...flow, can_manage: false, changes: [mr, commit] },
    { ...scope, can_edit: false },
  );
  expect(screen.getByText(/修复登录/)).toBeTruthy();
  await userEvent.click(screen.getByText(/版本范围与基线/));
  expect(
    screen.queryByRole("button", {
      name: /添加变更|选择 MR|合并 MR|确认基线|补录直接提交|刷新范围|更多变更操作/,
    }),
  ).toBeNull();
  expect(act).not.toHaveBeenCalled();
});
it("loads MR candidates automatically and preserves a manually entered IID when cancelling the drawer", async () => {
  api.mockImplementation(async (path) => {
    if (path.includes("mr-options")) return { data: [mr.evidence], etag: "" };
    return { data: {}, etag: "" };
  });
  const close = vi.fn(),
    saved = vi.fn();
  render(
    <FlowDrawer
      task={{ op: "select-mr", repo: scope.repositories[0] }}
      r={release}
      path="/releases/1"
      close={close}
      saved={saved}
    />,
  );
  const user = userEvent.setup();
  expect(
    await screen.findByRole("button", { name: "选择 MR !42：修复登录" }),
  ).toBeTruthy();
  expect(api).toHaveBeenCalledWith(
    "/releases/1/mr-options?page=1",
    expect.objectContaining({
      method: "POST",
      etag: "r1",
      body: { repo_id: "1" },
    }),
  );
  const input = screen.getByRole("textbox", { name: "MR 编号" });
  await user.type(input, "99");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有未保存的修改，确定放弃？")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect((input as HTMLInputElement).value).toBe("99");
  await user.click(screen.getByRole("button", { name: "确认添加 MR" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    "/releases/1/select-mr",
    expect.objectContaining({
      etag: "r1",
      body: { note: "", repo_id: "1", ref: "99" },
    }),
  );
});
it("retains the observed version and idempotency key when retrying a remote merge with an unknown result", async () => {
  api.mockImplementation(async (path) => {
    if (path.endsWith("/git-identity"))
      return { data: { identity: "release-bot", token: "actor-r1" }, etag: "" };
    throw new ApiError("NETWORK_ERROR", "结果未知，请核实远端状态");
  });
  const props = {
    task: { op: "merge", repo: scope.repositories[0], change: mr },
    r: release,
    path: "/releases/1",
    close: vi.fn(),
    saved: vi.fn(),
  };
  const { rerender } = render(<FlowDrawer {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "核对 GitLab 身份" }));
  expect(await screen.findByText(/release-bot/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "确认合并 MR" }));
  expect(await screen.findByText("结果未知，请核实远端状态")).toBeTruthy();
  rerender(<FlowDrawer {...props} r={{ ...release, etag: "r2" }} />);
  await user.click(screen.getByRole("button", { name: "确认合并 MR" }));
  await waitFor(() =>
    expect(
      api.mock.calls.filter(([path]) => path.endsWith("/merge")),
    ).toHaveLength(2),
  );
  const writes = api.mock.calls.filter(([path]) => path.endsWith("/merge"));
  expect(writes[0]![1]).toEqual(writes[1]![1]);
  expect(writes[0]![1]).toMatchObject({
    etag: "r1",
    headers: { "Idempotency-Key": expect.any(String) },
    body: { actor_token: "actor-r1", sha: mr.evidence.sha },
  });
  expect(
    (writes[0]![1]!.headers as Record<string, string>)["Idempotency-Key"],
  ).not.toBe("");
  expect(props.saved).not.toHaveBeenCalled();
});

it("prevents confirmation if the freeze preview expires while its drawer is already open", async () => {
  const props = {
    task: { op: "freeze" },
    r: release,
    path: "/releases/1",
    close: vi.fn(),
    saved: vi.fn(),
  };
  const { rerender } = render(<FlowDrawer {...props} token="preview-r1" />);
  expect(
    (screen.getByRole("button", { name: "确认冻结送验" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  rerender(
    <FlowDrawer {...props} r={{ ...release, etag: "r2" }} token={undefined} />,
  );
  const confirm = screen.getByRole("button", { name: "确认冻结送验" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(confirm);
  expect(api).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(props.close).toHaveBeenCalledOnce();
});
