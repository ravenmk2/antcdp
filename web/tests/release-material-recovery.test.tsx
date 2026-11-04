import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaterialDrawer } from "@/features/delivery/ReleaseMaterialDrawer";
import type { Kind, Material, MaterialSet } from "@/features/delivery/releases";
import { ApiError, request } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const api = vi.mocked(request);
const path = "/projects/1/variants/2/releases/3";
const item: Material = {
  id: "4",
  kind: "sql",
  filename: "schema.sql",
  description_md: "原说明",
  repository_id: "",
  database_name: "app",
  bucket_name: "",
  target_path: "",
  config_format: "",
  config_mode: "",
  revision_id: "5",
  revision_no: 1,
  size_bytes: 20,
  sha256: "original-sha",
  sql_position: 1,
};
function latest(
  items = [item],
  can_edit = true,
  repositories: MaterialSet["repositories"] = [],
) {
  return { data: { items, can_edit, repositories }, etag: "latest-release" };
}
function drawer(
  value: Material | null = item,
  kind: Kind = value?.kind || "attachment",
) {
  const saved = vi.fn();
  render(
    <MaterialDrawer
      path={path}
      etag="original-release"
      kind={kind}
      value={value ?? undefined}
      repos={[]}
      close={vi.fn()}
      saved={saved}
    />,
  );
  return { user: userEvent.setup(), saved };
}
const save = () => screen.getByRole("button", { name: "保存材料" });
const review = () => screen.getByRole("region", { name: "材料保存结果核对" });
function uploadedText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
beforeEach(() => {
  api.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("preserves the file and metadata through a 412 and only retries after review with the latest ETag", async () => {
  const remote = {
    ...item,
    description_md: "另一位成员的说明",
    revision_no: 2,
    revision_id: "6",
  };
  api
    .mockRejectedValueOnce(new ApiError("VERSION_CONFLICT", "版本冲突"))
    .mockResolvedValueOnce(latest([remote]))
    .mockResolvedValue({ data: {}, etag: "saved-release" });
  const { user, saved } = drawer();
  const upload = screen.getByLabelText(/替换文件/);
  const description = screen.getByLabelText("材料说明（Markdown）");
  const database = screen.getByLabelText("数据库名");
  const file = new File(["alter table app;"], "migration.sql", {
    type: "text/plain",
  });
  await user.upload(upload, file);
  await user.clear(description);
  await user.type(description, "本地迁移说明");
  await user.clear(database);
  await user.type(database, "next_app");
  await user.click(save());
  expect(save().matches(":disabled")).toBe(true);
  expect(upload.matches(":disabled")).toBe(true);
  await user.click(save());
  expect(api).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "读取最新材料" }));
  expect(within(review()).getByText("另一位成员的说明")).toBeTruthy();
  expect(within(review()).getByText("本地迁移说明")).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
  expect(save().matches(":disabled")).toBe(true);
  await user.click(
    screen.getByRole("button", { name: "已核对，保留草稿继续编辑" }),
  );
  expect((description as HTMLTextAreaElement).value).toBe("本地迁移说明");
  expect((database as HTMLInputElement).value).toBe("next_app");
  expect((upload as HTMLInputElement).files?.[0]).toBe(file);
  expect(api).toHaveBeenCalledTimes(2);
  await user.click(save());
  const [endpoint, options] = api.mock.calls[2];
  expect(endpoint).toBe(path + "/items/4");
  expect(options).toMatchObject({ method: "PATCH", etag: "latest-release" });
  const body = options?.body as FormData;
  expect(JSON.parse(String(body.get("metadata")))).toMatchObject({
    filename: "migration.sql",
    description_md: "本地迁移说明",
    database_name: "next_app",
  });
  expect(await uploadedText(body.get("file") as File)).toBe("alter table app;");
  expect(saved).toHaveBeenCalledOnce();
});

it.each([true, false])(
  "shows the saved configuration beside the retained draft before retrying (local edit: %s)",
  async (editLocal) => {
    const config = {
      ...item,
      kind: "config" as const,
      filename: "app.yaml",
      target_path: "config/app.yaml",
      database_name: "",
      config_format: "yaml",
      config_mode: "full",
    };
    const remote = { ...config, revision_no: 2, revision_id: "6" };
    const fetchFile = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => "port: 80\n" })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "port: 90\nremote: true\n",
      });
    vi.stubGlobal("fetch", fetchFile);
    api
      .mockRejectedValueOnce(new ApiError("VERSION_CONFLICT", "版本冲突"))
      .mockResolvedValueOnce(latest([remote]))
      .mockResolvedValue({ data: {}, etag: "saved-release" });
    const { user, saved } = drawer(config);
    const content = screen.getByLabelText("配置内容") as HTMLTextAreaElement;
    await waitFor(() => expect(content.value).toBe("port: 80\n"));
    const draft = editLocal ? "port: 81\nlocal: true\n" : "port: 80\n";
    if (editLocal) {
      await user.clear(content);
      await user.type(content, draft);
    }
    await user.click(save());
    await user.click(screen.getByRole("button", { name: "读取最新材料" }));
    expect(
      await within(review()).findByText("port: 90 remote: true", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      within(review()).getByText(/远端新增或修改的内容不会自动合并/),
    ).toBeTruthy();
    expect(content.value).toBe(draft);
    expect(fetchFile.mock.calls[1][0]).toContain("/revisions/6/file");
    await user.click(
      screen.getByRole("button", { name: "已核对，保留草稿继续编辑" }),
    );
    expect(content.value).toBe(draft);
    expect(api).toHaveBeenCalledTimes(2);
    expect(saved).not.toHaveBeenCalled();
    await user.click(save());
    const options = api.mock.calls[2][1];
    expect(options?.etag).toBe("latest-release");
    expect(
      await uploadedText((options?.body as FormData).get("file") as File),
    ).toBe(draft);
    expect(saved).toHaveBeenCalledOnce();
  },
);

it("does not repeat an unknown upload or assume a same-name record succeeded until the user verifies it", async () => {
  const stored = {
    ...item,
    kind: "attachment" as const,
    filename: "release.txt",
  };
  api
    .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "网络错误"))
    .mockResolvedValueOnce(latest([stored]));
  const { user, saved } = drawer(null, "attachment");
  const upload = screen.getByLabelText(/上传文件/) as HTMLInputElement;
  await user.upload(upload, new File(["release notes"], "release.txt"));
  expect(upload.files?.[0]?.name).toBe("release.txt");
  // jsdom's native required-file validity does not see user-event's mocked FileList.
  fireEvent.submit(upload.form!);
  expect(await screen.findByText(/提交结果尚未确认/)).toBeTruthy();
  expect(save().matches(":disabled")).toBe(true);
  await user.click(screen.getByRole("button", { name: "读取最新材料" }));
  expect(
    screen.getByRole("link", { name: "下载已保存修订" }).getAttribute("href"),
  ).toBe("/api/v1" + path + "/items/4/revisions/5/file");
  expect(saved).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(2);
  await user.click(
    screen.getByRole("button", { name: "已核对，使用此已保存材料" }),
  );
  expect(saved).toHaveBeenCalledOnce();
  expect(
    api.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});

it("keeps the draft blocked when latest material cannot be read, then honors a read-only release", async () => {
  api
    .mockRejectedValueOnce(new ApiError("VERSION_CONFLICT", "版本冲突"))
    .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "网络错误"))
    .mockResolvedValueOnce(latest([item], false));
  const { user } = drawer();
  const description = screen.getByLabelText("材料说明（Markdown）");
  await user.clear(description);
  await user.type(description, "保留我的草稿");
  await user.click(save());
  await user.click(screen.getByRole("button", { name: "读取最新材料" }));
  expect((description as HTMLTextAreaElement).value).toBe("保留我的草稿");
  expect(save().matches(":disabled")).toBe(true);
  expect(
    screen.queryByRole("button", { name: "已核对，保留草稿继续编辑" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "读取最新材料" }));
  expect(screen.getByText(/当前发布或父对象已只读/)).toBeTruthy();
  expect(save().matches(":disabled")).toBe(true);
  expect(
    screen.queryByRole("button", { name: "已核对，保留草稿继续编辑" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "复制文字草稿" }).matches(":disabled"),
  ).toBe(false);
  expect(
    api.mock.calls.filter(([, options]) => options?.method === "PATCH"),
  ).toHaveLength(1);
});

it("resolves an unknown removal from the latest list without repeating the delete or restoring the material", async () => {
  api
    .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "网络错误"))
    .mockResolvedValueOnce(latest([]));
  const { user, saved } = drawer();
  await user.click(screen.getByRole("button", { name: "移出清单" }));
  await user.click(screen.getByRole("button", { name: "确认移出" }));
  expect(
    screen.getByRole("button", { name: "确认移出" }).matches(":disabled"),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "读取最新材料" }));
  expect(screen.getByText(/此材料已不在当前清单中/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "已核对，继续移出" })).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "已核对，返回材料列表" }),
  );
  expect(saved).toHaveBeenCalledOnce();
  expect(
    api.mock.calls.filter(([, options]) => options?.method === "DELETE"),
  ).toHaveLength(1);
});
