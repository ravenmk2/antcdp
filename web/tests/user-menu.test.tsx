import { ThemeProvider } from "@/app/theme";
import { ConsoleThemeProvider } from "@/areas/console/shell/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./fixtures/area-shell";

const identity = vi.hoisted(() => ({ role: "admin", is_founder: true }));
vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: "1",
      username: "reviewer",
      display_name: "测试用户",
      ...identity,
    },
  }),
  useAuth: () => ({ settings: { site_name: "AntCDP" } }),
}));
vi.mock("@/hooks/use-api", () => ({ useApiQuery: () => ({}) }));

beforeEach(() => {
  identity.role = "admin";
  identity.is_founder = true;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="当前位置测试">
      {location.pathname + location.search + location.hash}
    </output>
  );
}

function ThemedShell() {
  const { pathname } = useLocation();
  const Theme = pathname.startsWith("/admin")
    ? ConsoleThemeProvider
    : ThemeProvider;
  return (
    <Theme>
      <AppShell />
    </Theme>
  );
}

function renderMenu(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ThemedShell />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it.each([
  ["/home?view=recent#activity", "工作区"],
  ["/account/remote-hosts/123", "个人设置"],
  ["/admin/users?create=1", "控制台"],
])(
  "marks the current destination without navigating away from %s",
  async (path, currentArea) => {
    renderMenu(path);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "用户菜单，测试用户" }),
    );
    const items = await screen.findAllByRole("menuitem");
    expect(
      items
        .filter((item) =>
          /^(工作区|控制台|个人设置|退出登录)/.test(item.textContent ?? ""),
        )
        .map((item) => item.textContent),
    ).toEqual(
      ["工作区", "控制台", "个人设置", "退出登录"].map(
        (label) => label + (label === currentArea ? "当前" : ""),
      ),
    );
    const current = await screen.findByRole("menuitem", {
      name: new RegExp(`^${currentArea}\\s*当前$`),
    });
    expect(current).toHaveAttribute("aria-current", "location");
    expect(
      items.filter((item) => item.hasAttribute("aria-current")),
    ).toHaveLength(1);
    await user.click(current);
    expect(screen.getByLabelText("当前位置测试")).toHaveTextContent(path);
    expect(await screen.findByRole("menu")).toBeVisible();
    const target = currentArea === "工作区" ? "个人设置" : "工作区";
    await user.click(await screen.findByRole("menuitem", { name: target }));
    expect(screen.getByLabelText("当前位置测试")).toHaveTextContent(
      target === "工作区" ? "/home" : "/account",
    );
  },
);

it.each([
  ["admin", true, "创始人", "text-(--role-founder)"],
  ["admin", false, "管理员", "text-info"],
  ["user", false, null, null],
])(
  "shows role-appropriate entries and badges for %s (founder=%s)",
  async (role, founder, badge, color) => {
    identity.role = role;
    identity.is_founder = founder;
    renderMenu("/account");
    await userEvent.click(
      screen.getByRole("button", { name: "用户菜单，测试用户" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "工作区" }),
    ).toHaveAttribute("href", "/home");
    expect(screen.queryByText("普通用户")).not.toBeInTheDocument();
    if (badge && color) {
      expect(await screen.findByRole("menuitem", { name: badge })).toHaveClass(
        color,
      );
      expect(
        await screen.findByRole("menuitem", { name: "控制台" }),
      ).toHaveAttribute("href", "/admin");
    } else {
      expect(
        screen.queryByRole("menuitem", { name: "管理员" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "创始人" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "控制台" }),
      ).not.toBeInTheDocument();
    }
  },
);

it("selects all three appearance segments without closing the menu and restores focus on escape", async () => {
  localStorage.setItem("antcdp.console.appearance", "system");
  const user = userEvent.setup();
  renderMenu("/admin");
  const trigger = screen.getByRole("button", { name: "用户菜单，测试用户" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  expect(
    await screen.findByRole("menuitemradio", { name: "跟随" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Home}{ArrowDown}{ArrowDown}{Enter}");
  await waitFor(() =>
    expect(localStorage.getItem("antcdp.console.appearance")).toBe("dark"),
  );
  expect(await screen.findByRole("menu")).toBeVisible();
  expect(
    await screen.findByRole("menuitemradio", { name: "深色" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(document.documentElement).toHaveClass("dark");
  await user.click(screen.getByRole("menuitemradio", { name: "浅色" }));
  expect(localStorage.getItem("antcdp.console.appearance")).toBe("light");
  expect(document.documentElement).not.toHaveClass("dark");
  await user.click(screen.getByRole("menuitemradio", { name: "跟随" }));
  expect(localStorage.getItem("antcdp.console.appearance")).toBe("system");
  expect(screen.getByRole("menu")).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  expect(
    await screen.findByRole("menuitemradio", { name: "跟随" }),
  ).toHaveAttribute("aria-checked", "true");
});

it.each([false, true])(
  "toggles the console header without changing the workspace theme (system dark=%s)",
  async (systemDark) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: systemDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const workspaceTheme = systemDark ? "dark" : "light";
    localStorage.setItem("antcdp.appearance", workspaceTheme);
    renderMenu("/admin");
    const user = userEvent.setup();
    expect(
      screen.getByRole("button", { name: "消息通知（预留）" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("button", { name: "快速创建" }),
    ).not.toBeInTheDocument();
    const nextLabel = systemDark ? "浅色" : "深色";
    const previousLabel = systemDark ? "深色" : "浅色";
    await user.click(
      screen.getByRole("button", { name: `切换为${nextLabel}主题` }),
    );
    expect(localStorage.getItem("antcdp.console.appearance")).toBe(
      systemDark ? "light" : "dark",
    );
    await user.click(
      screen.getByRole("button", { name: `切换为${previousLabel}主题` }),
    );
    expect(localStorage.getItem("antcdp.console.appearance")).toBe(
      systemDark ? "dark" : "light",
    );
    await user.click(
      screen.getByRole("button", { name: "用户菜单，测试用户" }),
    );
    expect(
      await screen.findByRole("menuitemradio", { name: previousLabel }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "跟随" }));
    expect(localStorage.getItem("antcdp.console.appearance")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(
      systemDark,
    );
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: `切换为${nextLabel}主题` }),
    );
    await user.click(screen.getByRole("link", { name: "返回工作区" }));
    expect(screen.getByLabelText("当前位置测试")).toHaveTextContent("/home");
    expect(document.documentElement.dataset.appearance).toBe(workspaceTheme);
    expect(localStorage.getItem("antcdp.appearance")).toBe(workspaceTheme);
    expect(localStorage.getItem("antcdp.console.appearance")).toBe(
      systemDark ? "light" : "dark",
    );
  },
);

it("explains the identity icon on keyboard focus and returns focus after closing", async () => {
  renderMenu("/account");
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "用户菜单，测试用户" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("tooltip", { name: "创始人" })).toBeVisible();
  expect(
    await screen.findByRole("menuitem", { name: "创始人" }),
  ).toHaveAccessibleDescription("创始人");
  expect(await screen.findByRole("menuitem", { name: "创始人" })).toHaveFocus();
  expect(
    await screen.findByRole("menuitem", { name: "创始人" }),
  ).toHaveAttribute("data-keyboard", "true");
  await user.hover(await screen.findByRole("menuitem", { name: "创始人" }));
  expect(
    await screen.findByRole("menuitem", { name: "创始人" }),
  ).toHaveAttribute("data-keyboard", "false");
  await user.keyboard("{ArrowDown}");
  expect(
    await screen.findByRole("menuitemradio", { name: "浅色" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(await screen.findByRole("menuitem", { name: "创始人" })).toHaveFocus();
  expect(
    await screen.findByRole("menuitem", { name: "创始人" }),
  ).toHaveAttribute("data-keyboard", "true");
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
