import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import {
  AdminMenuSearch,
  AdminNavigation,
} from "@/areas/console/pages/admin-navigation";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function mount(route = "/admin/models/3", compact = false) {
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <AdminMenuSearch userId="1" onNavigate={close} />
      <AdminNavigation compact={compact} close={close} />
      <Link to="/admin/settings">外部设置入口</Link>
      <Link to="/admin/models/new">外部模型入口</Link>
    </MemoryRouter>,
  );
  return { user, close };
}

it("expands the destination group and keeps only its leaf marked as current", async () => {
  const { user } = mount();
  const navigation = screen.getByRole("navigation", { name: "主导航" });
  const agents = screen.getByRole("button", { name: "助手与模型" });
  expect(agents).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "账号与组织" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    within(navigation).getByRole("link", { name: "模型管理" }),
  ).toHaveAttribute("aria-current", "page");
  expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(agents).not.toHaveAttribute("aria-current");
  await user.click(agents);
  expect(agents).toHaveAttribute("aria-expanded", "false");
  expect(agents).toHaveAttribute("data-section-active", "true");
  expect(
    within(navigation).queryByRole("link", { name: "模型管理" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "消息通知" }));
  await user.click(screen.getByRole("link", { name: "外部模型入口" }));
  expect(agents).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "消息通知" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await user.click(screen.getByRole("link", { name: "外部设置入口" }));
  expect(screen.getByRole("button", { name: "系统维护" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    within(navigation).getByRole("link", { name: "系统设置" }),
  ).toHaveAttribute("aria-current", "page");
});

it("restores only safe group preferences and reveals implemented routes", async () => {
  localStorage.setItem(
    "antcdp.admin-navigation-groups",
    JSON.stringify({ messages: true, maintenance: "true", unknown: true }),
  );
  const { user } = mount("/admin");
  const nav = within(screen.getByRole("navigation", { name: "主导航" }));
  expect(
    nav.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["账号与组织", "助手与模型", "连接与环境", "消息通知", "系统维护"]);
  expect(screen.getByRole("button", { name: "消息通知" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("button", { name: "系统维护" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.getByRole("link", { name: "系统概览" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("button", { name: "账号与组织" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.click(screen.getByRole("button", { name: "账号与组织" }));
  await user.click(screen.getByRole("button", { name: "连接与环境" }));
  await user.click(screen.getByRole("button", { name: "系统维护" }));
  await user.click(screen.getByRole("button", { name: "助手与模型" }));
  expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "系统概览",
    "用户管理",
    "机器人账号",
    "团队管理",
    "项目管理",
    "助手管理",
    "运行与用量",
    "模型管理",
    "技能库",
    "MCP 服务",
    "网络检索",
    "凭据管理",
    "服务集成",
    "远程主机",
    "沙箱配置",
    "云电脑",
    "邮件管理",
    "短信管理",
    "钉钉机器人",
    "审计日志",
    "系统设置",
  ]);
  expect(screen.getByRole("link", { name: "沙箱配置" })).toHaveAttribute(
    "href",
    "/admin/sandboxes",
  );
  expect(screen.getByRole("link", { name: "云电脑" })).toHaveAttribute(
    "href",
    "/admin/cloud-computers",
  );
  expect(
    JSON.parse(localStorage.getItem("antcdp.admin-navigation-groups")!),
  ).toEqual({
    platform: true,
    resources: true,
    agents: true,
    messages: true,
    maintenance: true,
  });
});

it("provides keyboard-operated compact submenus and restores focus on Escape", async () => {
  const { user, close } = mount("/admin/models", true);
  const trigger = screen.getByRole("button", { name: "助手与模型" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const menu = await screen.findByRole("menu", { name: "助手与模型" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(6);
  expect(
    within(menu).getByRole("menuitem", { name: "模型管理" }),
  ).toHaveAttribute("aria-current", "page");
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(
    within(menu).getByRole("menuitem", { name: "模型管理" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "系统维护" }));
  await user.click(await screen.findByRole("menuitem", { name: "审计日志" }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "系统维护" })).toHaveAttribute(
    "data-section-active",
    "true",
  );
});

it.each([
  ["ssh", "远程主机"],
  ["真人用户", "用户管理"],
])("finds %s through keyboard menu search", async (keyword, label) => {
  const { user } = mount();
  await user.keyboard("{Control>}k{/Control}");
  const search = screen.getByRole("combobox", { name: "菜单名称或技术词" });
  await user.type(search, keyword);
  expect(
    await screen.findByRole("option", { name: new RegExp(label) }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await screen.findAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
});

it("restores focus to the topbar search button when the dialog closes", async () => {
  const { user } = mount("/admin", true);
  const trigger = screen.getByRole("button", { name: "搜索控制台菜单" });
  await user.tab();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("combobox", { name: "菜单名称或技术词" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("offers previous console destinations when the search is empty", async () => {
  const { user } = mount("/admin/models/3");
  await user.click(screen.getByRole("link", { name: "外部设置入口" }));
  await user.keyboard("{Control>}k{/Control}");
  const recent = screen.getByRole("listbox", { name: "最近访问" });
  expect(within(recent).getAllByRole("option")).toHaveLength(1);
  expect(within(recent).getByRole("option")).toHaveTextContent("模型管理");
  await user.keyboard("{Enter}");
  expect(screen.getByRole("link", { name: "模型管理" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
