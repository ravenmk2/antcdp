import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AdminNavigation } from "@/areas/console/pages/admin-navigation";

afterEach(() => localStorage.clear());

function mount(route = "/admin/models/3", compact = false) {
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
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
  const resources = screen.getByRole("button", { name: "连接与资源" });
  expect(resources).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "平台管理" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    within(navigation).getByRole("link", { name: "模型管理" }),
  ).toHaveAttribute("aria-current", "page");
  expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(resources).not.toHaveAttribute("aria-current");
  await user.click(resources);
  expect(resources).toHaveAttribute("aria-expanded", "false");
  expect(resources).toHaveAttribute("data-section-active", "true");
  expect(
    within(navigation).queryByRole("link", { name: "模型管理" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "消息通知" }));
  await user.click(screen.getByRole("link", { name: "外部模型入口" }));
  expect(resources).toHaveAttribute("aria-expanded", "true");
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
  expect(screen.getByRole("button", { name: "消息通知" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("button", { name: "系统维护" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.click(screen.getByRole("button", { name: "连接与资源" }));
  await user.click(screen.getByRole("button", { name: "系统维护" }));
  await user.click(screen.getByRole("button", { name: "智能体" }));
  expect(
    within(screen.getByRole("navigation", { name: "主导航" })).getAllByRole(
      "link",
    ),
  ).toHaveLength(19);
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
  const trigger = screen.getByRole("button", { name: "连接与资源" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const menu = await screen.findByRole("menu", { name: "连接与资源" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
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

it("finds technical names through keyboard menu search without fake counters", async () => {
  const { user } = mount();
  await user.keyboard("{Control>}k{/Control}");
  const search = screen.getByRole("combobox", { name: "菜单名称或技术词" });
  await user.type(search, "ssh");
  expect(
    await screen.findByRole("option", { name: /远程主机/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await screen.findAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "远程主机" })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
});

it("restores focus to the compact search button when the dialog closes", async () => {
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
