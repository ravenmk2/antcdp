import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReleaseEditor } from "@/features/delivery/ReleaseEditor";
import type { Release } from "@/features/delivery/releases";
import type { Variant } from "@/shared/delivery";
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
const variant = {
  id: "2",
  name: "标准版",
  main_branch: "main",
  release_tag_prefix: "v",
  etag: "v1",
  can_manage: true,
  archived_at: null,
} as Variant;
const release: Release = {
  id: "3",
  name: "冬季发布",
  version_label: "1.0",
  tag_name: "v1.0",
  description_md: "已有说明",
  status: "draft",
  updated_at: "2026-11-04",
  etag: "r1",
};
const base = "/projects/1/variants/2";
function editor(
  kind: "create" | "details" | "description" | "settings",
  r: Release | null = release,
  v = variant,
) {
  const saved = vi.fn(),
    close = vi.fn();
  render(
    <ReleaseEditor
      kind={kind}
      r={r}
      variant={v}
      base={base}
      close={close}
      saved={saved}
    />,
  );
  return { saved, close, user: userEvent.setup() };
}

it.each(["draft", "integrating"])(
  "clears an optional release name without changing the version or Tag while %s",
  async (status) => {
    api.mockResolvedValue({ data: {}, etag: "r2" });
    const { user, saved } = editor("details", { ...release, status });
    const version = screen.getByLabelText(/版本号/) as HTMLInputElement;
    expect(version.readOnly).toBe(status === "integrating");
    await user.clear(screen.getByLabelText("发布名称"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(api).toHaveBeenCalledWith(base + "/releases/3", {
      method: "PATCH",
      etag: "r1",
      body: { name: "" },
    });
    expect(saved).toHaveBeenCalledOnce();
  },
);

it("accepts 120 Unicode characters and focuses an overlong name error", async () => {
  api.mockResolvedValue({ data: {}, etag: "r2" });
  const { user } = editor("details");
  const name = screen.getByLabelText("发布名称");
  await user.clear(name);
  await user.paste("🦊".repeat(121));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(api).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(name);
  expect(name.getAttribute("aria-invalid")).toBe("true");
  await user.clear(name);
  await user.paste("🦊".repeat(120));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(api).toHaveBeenCalledWith(base + "/releases/3", {
    method: "PATCH",
    etag: "r1",
    body: { name: "🦊".repeat(120) },
  });
});

it("saves a first prefix once and keeps the creation draft after a rejected release write", async () => {
  api.mockResolvedValueOnce({ data: { tag_prefix: "standard-v" }, etag: "v2" });
  api.mockRejectedValueOnce(
    new ApiError("VALIDATION_FAILED", "版本号不可用", [
      { field: "version_label", code: "invalid_tag" },
    ]),
  );
  const { user, saved } = editor("create", null, {
    ...variant,
    release_tag_prefix: "",
  });
  await user.type(screen.getByLabelText("发布名称"), "新功能发布");
  await user.type(screen.getByLabelText(/版本号/), "1.0");
  await user.type(screen.getByLabelText(/Tag 前缀/), "standard-v");
  await user.type(screen.getByLabelText("发布说明"), "保留这份说明");
  await user.click(screen.getByRole("button", { name: "保存前缀并创建发布" }));
  expect(api).toHaveBeenNthCalledWith(1, base + "/release-settings", {
    method: "PATCH",
    etag: "v1",
    body: { tag_prefix: "standard-v" },
  });
  expect(api).toHaveBeenNthCalledWith(2, base + "/releases", {
    method: "POST",
    body: {
      name: "新功能发布",
      version_label: "1.0",
      description_md: "保留这份说明",
    },
  });
  expect(saved).not.toHaveBeenCalled();
  expect((screen.getByLabelText("发布名称") as HTMLInputElement).value).toBe(
    "新功能发布",
  );
  expect((screen.getByLabelText("发布说明") as HTMLTextAreaElement).value).toBe(
    "保留这份说明",
  );
  expect(screen.queryByLabelText(/Tag 前缀/)).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText(/版本号/));
  api.mockResolvedValueOnce({ data: { ...release, id: "4" }, etag: "r1" });
  await user.clear(screen.getByLabelText(/版本号/));
  await user.type(screen.getByLabelText(/版本号/), "1.1");
  await user.click(screen.getByRole("button", { name: "创建发布" }));
  expect(api).toHaveBeenCalledTimes(3);
  expect(api.mock.calls[2]![0]).toBe(base + "/releases");
  expect(saved).toHaveBeenCalledWith("4");
});

it("blocks duplicate creation after a lost response and reads the matching record before opening it", async () => {
  api.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "连接中断"));
  const { user, saved } = editor("create", null);
  await user.type(screen.getByLabelText("发布名称"), "冬季发布");
  await user.type(screen.getByLabelText(/版本号/), "1.0");
  await user.click(screen.getByRole("button", { name: "创建发布" }));
  expect(
    (
      screen.getByRole("button", {
        name: "创建发布",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "创建发布" }));
  expect(api).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  api.mockResolvedValueOnce({ data: { items: [release], total: 1 }, etag: "" });
  api.mockResolvedValueOnce({ data: release, etag: "r1" });
  await user.click(screen.getByRole("button", { name: "读取已保存记录" }));
  await user.click(
    await screen.findByRole("button", { name: "打开已存在发布" }),
  );
  expect(api).toHaveBeenNthCalledWith(
    2,
    base + "/releases?q=1.0&status=all&page=1&page_size=100",
  );
  expect(api).toHaveBeenNthCalledWith(3, base + "/releases/3");
  expect(saved).toHaveBeenCalledWith("3");
});

it("reconciles a lost prefix response and continues in the same creation editor", async () => {
  api.mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "连接中断"));
  const { user } = editor("create", null, {
    ...variant,
    release_tag_prefix: "",
  });
  await user.type(screen.getByLabelText("发布名称"), "冬季发布");
  await user.type(screen.getByLabelText(/版本号/), "1.0");
  await user.type(screen.getByLabelText(/Tag 前缀/), "v");
  await user.click(screen.getByRole("button", { name: "保存前缀并创建发布" }));
  expect(api).toHaveBeenCalledOnce();
  api.mockResolvedValueOnce({ data: { ...variant, etag: "v2" }, etag: "v2" });
  await user.click(screen.getByRole("button", { name: "读取已保存记录" }));
  await user.click(
    await screen.findByRole("button", { name: "使用已保存前缀继续" }),
  );
  api.mockResolvedValueOnce({ data: release, etag: "r1" });
  await user.click(screen.getByRole("button", { name: "创建发布" }));
  expect(api).toHaveBeenCalledTimes(3);
  expect(api).toHaveBeenLastCalledWith(base + "/releases", {
    method: "POST",
    body: { name: "冬季发布", version_label: "1.0", description_md: "" },
  });
});

it("requires a fresh read and explicit review after an edit conflict while preserving the proposed name", async () => {
  api.mockRejectedValueOnce(new ApiError("VERSION_CONFLICT", "版本冲突"));
  const { user } = editor("details");
  await user.clear(screen.getByLabelText("发布名称"));
  await user.type(screen.getByLabelText("发布名称"), "我的新名称");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(
    (
      screen.getByRole("button", {
        name: "保存",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  api.mockResolvedValueOnce({
    data: { ...release, name: "其他人的名称", etag: "r2" },
    etag: "r2",
  });
  await user.click(screen.getByRole("button", { name: "读取已保存记录" }));
  await user.click(
    await screen.findByRole("button", { name: "已核对，以最新版本继续编辑" }),
  );
  expect((screen.getByLabelText("发布名称") as HTMLInputElement).value).toBe(
    "我的新名称",
  );
  api.mockResolvedValueOnce({ data: {}, etag: "r3" });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(base + "/releases/3", {
      method: "PATCH",
      etag: "r2",
      body: { name: "我的新名称" },
    }),
  );
});
