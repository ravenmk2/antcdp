import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceCommand } from "@/features/collaboration/ResourceCommand";
import { ResourceEditor } from "@/features/collaboration/ResourceEditor";
import { renderDescription } from "@/features/collaboration/Markdown";
import { IdentityContext, type Identity } from "@/app/identity";
import { request } from "@/lib/api";
import type { Resource } from "@/shared/collaboration";
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const resource: Resource = {
  id: "8",
  code: "Design",
  name: "设计团队",
  description: "",
  summary: "",
  status: "active",
  can_manage: true,
  is_member: true,
  direct_role: "admin",
  etag: '"info"',
  membership_etag: '"members"',
  dissolve_etag: '"both"',
  icon_key: null,
  icon_file_id: null,
  member_count: 1,
};
const identity = { session: { user: { id: "1", role: "admin" } } } as Identity;
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requires the team code and uses the version observed before the confirmation opened", async () => {
  const user = userEvent.setup(),
    saved = vi.fn();
  vi.mocked(request).mockResolvedValue({ data: {}, etag: "" });
  const dialog = (current: Resource) => (
    <IdentityContext value={identity}>
      <ResourceCommand
        kind="teams"
        resource={current}
        command={{ action: "dissolve" }}
        consoleMode
        onSaved={saved}
        onClose={() => {}}
      />
    </IdentityContext>
  );
  const view = render(dialog(resource));
  await user.click(screen.getByRole("button", { name: "确认" }));
  expect(request).not.toHaveBeenCalled();
  const field = screen.getByLabelText(/输入团队编码/);
  await waitFor(() => expect(document.activeElement).toBe(field));
  await user.type(field, "design");
  view.rerender(dialog({ ...resource, dissolve_etag: '"later"' }));
  await user.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith("/teams/8/dissolve", {
    method: "POST",
    etag: '"both"',
    body: {},
  });
});
it("previews the same project description draft and saves only that field with its original version", async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  vi.mocked(request).mockResolvedValue({ data: resource, etag: "" });
  const editor = (current: Resource) => (
    <IdentityContext value={identity}>
      <ResourceEditor
        kind="projects"
        resource={current}
        descriptionOnly
        onClose={() => {}}
        onSaved={saved}
      />
    </IdentityContext>
  );
  const view = render(editor(resource));
  await user.type(
    screen.getByRole("textbox", { name: "项目描述" }),
    "## 开发约定",
  );
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("heading", { name: "开发约定" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(editor({ ...resource, etag: '"later"' }));
  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "## 开发约定",
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("/projects/8", {
    method: "PATCH",
    etag: '"info"',
    body: { description: "## 开发约定" },
  });
});
it("preserves markdown formatting while rejecting executable HTML and embedded images", () => {
  const rendered = renderDescription(
    "**内容**\n\n<script>alert(1)</script>\n\n![img](https://example.invalid/a.png)\n\n[link](javascript:alert(1))",
  );
  const node = document.createElement("div");
  node.innerHTML = rendered;
  expect(node.querySelector("strong")?.textContent).toBe("内容");
  expect(node.querySelector('script,img,a[href^="javascript:"]')).toBeNull();
});
