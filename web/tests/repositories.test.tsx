import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { request, ApiError } from "@/lib/api";
import { RepositoryPicker } from "@/features/repositories/RepositoryPicker";
import { Sync } from "@/features/repositories/RepositoryActions";
import type { ProjectRepository } from "@/shared/repositories";
vi.mock("@/lib/date", () => ({ useDate: () => () => "测试时间" }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
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
const row = (n: number) =>
  ({
    repo_id: String(n),
    name: "仓库" + n,
    full_path: "org/repo" + n,
    id: String(n),
    etag: "old",
  }) as ProjectRepository;
it("keeps explicit cross-page choices and the opening collection version on a rejected write", async () => {
  mock.mockImplementation(async (path, opts) => {
    if (opts?.method === "POST")
      throw new ApiError("COLLECTION_VERSION_CONFLICT", "版本变化");
    if (path.includes("/containers?"))
      return { data: { items: [], next_cursor: null }, etag: "" };
    const second = path.includes("cursor=second");
    return {
      data: {
        items: second
          ? [row(2)]
          : [row(1), { ...row(3), already_linked: true }],
        next_cursor: second ? null : "second",
      },
      etag: "",
    };
  });
  const user = userEvent.setup(),
    saved = vi.fn();
  render(
    <RepositoryPicker
      projectId="9"
      etag={'"opened"'}
      connections={["a", "b"].map((id) => ({ id, name: id, enabled: true }))}
      onSaved={saved}
      onClose={() => {}}
    />,
  );
  await user.click(await screen.findByRole("checkbox", { name: /仓库1/ }));
  expect(
    (screen.getByRole("checkbox", { name: /仓库3/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await user.click(await screen.findByRole("checkbox", { name: /仓库2/ }));
  expect(screen.getByText("本页 1 条")).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("每页条数"), "50");
  await screen.findByRole("checkbox", { name: /仓库1/ });
  expect(
    mock.mock.calls.some(
      ([path]) =>
        path.includes("limit=50&cursor=") && !path.includes("cursor=second"),
    ),
  ).toBe(true);
  await user.selectOptions(screen.getByLabelText("服务连接"), "b");
  await user.click(screen.getByRole("button", { name: "保留选择" }));
  expect((screen.getByLabelText("服务连接") as HTMLSelectElement).value).toBe(
    "a",
  );
  await user.click(screen.getByRole("button", { name: "确认关联" }));
  await screen.findByText(/草稿已保留/);
  expect(mock).toHaveBeenCalledWith("/projects/9/repositories", {
    method: "POST",
    etag: '"opened"',
    body: { connection_id: "a", repo_ids: ["1", "2"] },
  });
  expect(saved).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "确认关联" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: /查看已选/ }));
  expect(screen.getByRole("button", { name: "移除 org/repo2" })).toBeTruthy();
});
it("refreshes each row with its fresh version, caps concurrency and preserves failures for review", async () => {
  const rows = [1, 2, 3, 4, 5].map(row),
    done = vi.fn(),
    user = userEvent.setup();
  let active = 0,
    peak = 0;
  mock.mockImplementation(async (path, opts) => {
    const id = path.split("/")[2];
    if (opts?.method === "POST") {
      expect(opts.etag).toBe("fresh-" + id);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      if (id === "3") throw new ApiError("NETWORK_ERROR", "响应丢失");
      if (id === "2") throw new ApiError("REMOTE_UNAVAILABLE", "连接失败");
      return { data: {}, etag: "" };
    }
    return { data: { etag: "fresh-" + id }, etag: "" };
  });
  render(
    <Sync
      base="/repositories"
      rows={rows}
      allowed
      onClose={() => {}}
      onDone={done}
    />,
  );
  await user.click(screen.getByRole("button", { name: "开始同步" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(done.mock.calls[0]![0].sort()).toEqual(["1", "4", "5"]);
  expect(peak).toBe(3);
  expect(screen.getByText("连接失败")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "读取最新快照" }));
  expect(mock.mock.calls.at(-1)?.[0]).toBe("/repositories/3");
  expect(mock.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(
    5,
  );
});
