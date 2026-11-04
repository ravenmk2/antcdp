import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { IdentityContext, type Identity } from "@/app/identity";
import { NavigationGuard } from "@/components/platform/navigation-guard";
import { ProjectDescription } from "@/features/collaboration/ProjectDescription";
import {
  Markdown,
  parseDescription,
  renderDescription,
} from "@/features/collaboration/Markdown";
import { ApiError, request } from "@/lib/api";
import type { Resource } from "@/shared/collaboration";

// Save/conflict tests use a plain input; CodeMirror behavior has dedicated tests.
vi.mock("@/features/collaboration/MarkdownEditor", () => ({
  MarkdownEditor: ({
    onChange,
    ...props
  }: {
    onChange: (value: string) => void;
  }) => (
    <textarea {...props} onChange={(event) => onChange(event.target.value)} />
  ),
}));
const afterSave = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
vi.mock("@/components/platform/navigation-guard", async (original) => ({
  ...(await original<object>()),
  useNavigateAfterSave: () => afterSave,
}));
const project: Resource = {
  id: "8",
  code: "AntCDP",
  name: "协作平台",
  description: "## 开始\n项目说明\n## 后续\n更多说明",
  summary: "",
  status: "active",
  can_manage: true,
  is_member: true,
  direct_role: "admin",
  etag: '"initial"',
  membership_etag: '"members"',
  dissolve_etag: '"both"',
  icon_key: null,
  icon_file_id: null,
  member_count: 1,
};
const identity = {
  session: { user: { id: "user-1", role: "admin" } },
} as Identity;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function editor(current = project, onSaved = vi.fn()) {
  return (
    <MemoryRouter initialEntries={["/projects/8?tab=description&edit=1"]}>
      <IdentityContext value={identity}>
        <ProjectDescription project={current} edit onSaved={onSaved} />
      </IdentityContext>
    </MemoryRouter>
  );
}

it("creates stable project-scoped anchors and avoids duplicate heading collisions", () => {
  const text = "# 标题\n## A\n## A-2\n## A\n### 标题";
  const parsed = parseDescription(text, "project-8");
  expect(parsed.headings.map((item) => item.id)).toEqual([
    "project-8-标题",
    "project-8-a",
    "project-8-a-2",
    "project-8-a-3",
    "project-8-标题-2",
  ]);
  expect(parseDescription(text, "project-8").headings).toEqual(parsed.headings);
  expect(parseDescription(text, "project-9").headings[0]!.id).toBe(
    "project-9-标题",
  );
});

it("keeps HTML, remote images and dangerous URL schemes inert", () => {
  const node = document.createElement("div");
  node.innerHTML = renderDescription(
    '<iframe src="https://example.test"></iframe>\n\n![remote](https://example.test/a.png)\n\n[bad](javascript:alert(1))\n\n[bad](data:text/html,hello)\n\n[good](https://example.test)\n\n```html\n<script>alert(1)</script>\n```',
  );
  expect(node.querySelector("script,iframe,img")).toBeNull();
  expect(
    node.querySelector('a[href^="javascript:"],a[href^="data:"]'),
  ).toBeNull();
  expect(node.querySelector('a[href="https://example.test"]')).not.toBeNull();
  expect(node.querySelector("pre code")?.textContent).toContain("<script>");
});

it("copies code with visible and accessible feedback", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("isSecureContext", true);
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<Markdown text={"```sh\ngo test ./...\n```"} />);
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  await waitFor(() => expect(write).toHaveBeenCalledWith("go test ./...\n"));
  expect(screen.getByRole("button", { name: "复制代码" }).textContent).toBe(
    "已复制",
  );
  expect(screen.getByRole("status").textContent).toBe("代码已复制。");
});

it("preserves the original version and submits only the description", async () => {
  const user = userEvent.setup(),
    saved = vi.fn();
  vi.mocked(request).mockResolvedValue({ data: project, etag: '"saved"' });
  const view = render(editor(project, saved));
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
    target: { value: "# 新介绍" },
  });
  expect(
    screen.getByRole("button", { name: "分栏" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: "新介绍" })).toBeTruthy();
  view.rerender(editor({ ...project, etag: '"newer"' }, saved));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(request).toHaveBeenCalledWith("/projects/8", {
    method: "PATCH",
    etag: '"initial"',
    body: { description: "# 新介绍" },
  });
  expect(saved).toHaveBeenCalledOnce();
  expect(afterSave).toHaveBeenCalledWith("/projects/8?tab=description");
});

it("keeps the draft when a refreshed project removes editing permission", () => {
  const view = render(editor());
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
    target: { value: "需要保留的草稿" },
  });
  view.rerender(editor({ ...project, can_manage: false }));
  const input = screen.getByRole("textbox", {
    name: "Markdown 正文",
  }) as HTMLTextAreaElement;
  expect(input.value).toBe("需要保留的草稿");
  expect(input.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("已有草稿仍保留");
  expect(
    (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("retains unknown writes and verifies the latest content before finishing", async () => {
  const user = userEvent.setup(),
    saved = vi.fn();
  vi.mocked(request)
    .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "网络中断"))
    .mockResolvedValueOnce({
      data: { ...project, description: "新草稿" },
      etag: '"newer"',
    });
  render(editor(project, saved));
  const input = screen.getByRole("textbox", { name: "Markdown 正文" });
  fireEvent.change(input, { target: { value: "新草稿" } });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/版本已变化或提交结果未确认/);
  expect((input as HTMLTextAreaElement).value).toBe("新草稿");
  expect(
    (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "读取最新内容" }));
  await user.click(
    await screen.findByRole("button", { name: "完成并返回阅读" }),
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(saved).toHaveBeenCalledOnce();
});

it("requires explicit review before resaving a conflicting draft against the latest version", async () => {
  const user = userEvent.setup();
  vi.mocked(request)
    .mockRejectedValueOnce(new ApiError("VERSION_CONFLICT", "版本冲突"))
    .mockResolvedValueOnce({
      data: { ...project, description: "其他人的修改" },
      etag: '"latest"',
    })
    .mockResolvedValueOnce({ data: project, etag: '"saved"' });
  render(editor());
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
    target: { value: "我的草稿" },
  });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(await screen.findByRole("button", { name: "读取最新内容" }));
  expect(await screen.findByText("其他人的修改")).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "已核对，保留草稿并继续编辑" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Markdown 正文",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("我的草稿");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(request).toHaveBeenLastCalledWith("/projects/8", {
    method: "PATCH",
    etag: '"latest"',
    body: { description: "我的草稿" },
  });
});

it("validates UTF-8 bytes and focuses the editor when validation fails from preview", async () => {
  const user = userEvent.setup();
  render(editor());
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
    target: { value: "中".repeat(34134) },
  });
  await user.click(screen.getByRole("button", { name: "预览" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  const input = screen.getByRole("textbox", { name: "Markdown 正文" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(screen.getByRole("alert").textContent).toContain("100 KiB");
  expect(request).not.toHaveBeenCalled();
});

it("protects a dirty full-page draft when canceling to the reading page", async () => {
  const user = userEvent.setup();
  function Route() {
    const location = useLocation();
    return (
      <ProjectDescription
        project={project}
        edit={location.search.includes("edit=1")}
        onSaved={vi.fn()}
      />
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: "/projects/8",
        element: (
          <IdentityContext value={identity}>
            <NavigationGuard>
              <Route />
            </NavigationGuard>
          </IdentityContext>
        ),
      },
    ],
    { initialEntries: ["/projects/8?tab=description&edit=1"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown 正文" }), {
    target: { value: "未保存内容" },
  });
  await user.click(screen.getByRole("link", { name: "取消" }));
  expect(
    await screen.findByRole("heading", { name: "放弃未保存的修改？" }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "继续停留" }));
  expect(router.state.location.search).toContain("edit=1");
  await user.click(screen.getByRole("link", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "放弃并离开" }));
  await waitFor(() =>
    expect(router.state.location.search).toBe("?tab=description"),
  );
});

it("restores reading position with an account and project scoped key", async () => {
  sessionStorage.setItem(
    "antcdp.project-description:user-1:8",
    JSON.stringify({ top: 640 }),
  );
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={["/projects/8?tab=description"]}>
      <IdentityContext value={identity}>
        <ProjectDescription project={project} edit={false} onSaved={vi.fn()} />
      </IdentityContext>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(scroll).toHaveBeenCalledWith({ top: 640, behavior: "instant" }),
  );
  expect(
    screen
      .getByRole("navigation", { name: "项目介绍目录" })
      .querySelector("a")
      ?.getAttribute("href"),
  ).toBe("#project-8-%E5%BC%80%E5%A7%8B");
});

it("hides navigation for a single heading and shows back to top after a viewport", async () => {
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <IdentityContext value={identity}>
        <ProjectDescription
          project={{ ...project, description: "# 单章节\n正文" }}
          edit={false}
          onSaved={vi.fn()}
        />
      </IdentityContext>
    </MemoryRouter>,
  );
  expect(screen.queryByRole("navigation", { name: "项目介绍目录" })).toBeNull();
  expect(screen.queryByRole("button", { name: "返回顶部" })).toBeNull();
  await waitFor(() => expect(sessionStorage.length).toBe(1));
  vi.stubGlobal("scrollY", window.innerHeight + 1);
  fireEvent.scroll(window);
  const button = await screen.findByRole("button", { name: "返回顶部" });
  fireEvent.click(button, { detail: 0 });
  expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  expect(document.activeElement).toBe(screen.getByRole("article"));
  vi.stubGlobal("scrollY", 0);
  fireEvent.scroll(window);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "返回顶部" })).toBeNull(),
  );
});
