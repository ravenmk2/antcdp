import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceEditor } from "@/features/collaboration/ResourceEditor";
import { IdentityContext, type Identity } from "@/app/identity";
import { request, ApiError } from "@/lib/api";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const identity = {
  session: {
    user: {
      id: "1",
      role: "admin",
      display_name: "测试管理员",
      username: "admin",
    },
  },
} as Identity;
function setup() {
  const saved = vi.fn();
  const closed = vi.fn();
  render(
    <IdentityContext value={identity}>
      <ResourceEditor kind="projects" onClose={closed} onSaved={saved} />
    </IdentityContext>,
  );
  return { user: userEvent.setup(), saved, closed };
}
beforeEach(() => {
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
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("creates with the default admin and retains optional drafts across disclosure and preview", async () => {
  vi.mocked(request).mockResolvedValue({ data: { id: "created" }, etag: "" });
  const { user, saved } = setup();
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "项目描述" })).toBeNull();
  expect(screen.getByText("已选 1 人")).toBeTruthy();
  await user.type(screen.getByLabelText(/名称/), "示例项目");
  await user.type(screen.getByLabelText(/编码/), "example-project");
  await user.click(screen.getByRole("button", { name: /项目描述/ }));
  await user.type(
    screen.getByRole("textbox", { name: "项目描述" }),
    "## 开发说明",
  );
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("heading", { name: "开发说明" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "项目描述" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /收起描述/ }));
  expect(screen.getByRole("button", { name: /已填写/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "更换图标" }));
  await user.click(screen.getByRole("button", { name: "代码" }));
  await user.click(screen.getByRole("button", { name: "收起选择" }));
  await user.click(screen.getByRole("button", { name: "创建项目" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith(
    "/projects",
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        code: "example-project",
        name: "示例项目",
        description: "## 开发说明",
        admin_user_ids: ["1"],
        icon: { type: "builtin", key: "code" },
      }),
    }),
  );
});
it("opens and focuses invalid collapsed administrators, and preserves selection across searches", async () => {
  vi.mocked(request).mockResolvedValue({
    data: [{ id: "2", display_name: "另一管理员", username: "other" }],
    etag: "",
  });
  const { user } = setup();
  await user.type(screen.getByLabelText(/名称/), "示例项目");
  await user.type(screen.getByLabelText(/编码/), "example-project");
  await user.click(screen.getByRole("button", { name: "取消选择测试管理员" }));
  await user.click(screen.getByRole("button", { name: "创建项目" }));
  const search = await screen.findByRole("searchbox", {
    name: "搜索姓名或用户名",
  });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.click(await screen.findByRole("checkbox", { name: /另一管理员/ }));
  expect(screen.getByText("已选 1 人")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "收起候选" }));
  await user.click(screen.getByRole("button", { name: "添加管理员" }));
  await user.type(screen.getByRole("searchbox"), "无匹配");
  expect(
    screen.getByRole("button", { name: "取消选择另一管理员" }),
  ).toBeTruthy();
});
it("reveals a collapsed description on server validation failure and retains the draft", async () => {
  vi.mocked(request).mockRejectedValue(
    new ApiError(
      "VALIDATION_FAILED",
      "内容无效",
      [{ field: "description", code: "TOO_LONG" }],
      "test",
    ),
  );
  const { user, saved } = setup();
  await user.type(screen.getByLabelText(/名称/), "示例项目");
  await user.type(screen.getByLabelText(/编码/), "example-project");
  await user.click(screen.getByRole("button", { name: /项目描述/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "项目描述" }), {
    target: { value: "保留描述" },
  });
  await user.click(screen.getByRole("button", { name: "预览" }));
  await user.click(screen.getByRole("button", { name: /收起描述/ }));
  await user.click(screen.getByRole("button", { name: "创建项目" }));
  const field = await screen.findByRole("textbox", { name: "项目描述" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect((field as HTMLTextAreaElement).value).toBe("保留描述");
  expect(saved).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("有未保存的修改，确定放弃？")).toBeTruthy();
});
