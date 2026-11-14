import { ThemeProvider } from "@/app/theme";
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
      id: 1,
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
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="当前位置测试">
      {location.pathname + location.search + location.hash}
    </output>
  );
}

function renderMenu(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

it.each([
  ["/home?view=recent#activity", "工作区"],
  ["/account/remote-hosts/123", "个人中心"],
  ["/admin/users?create=1", "控制台"],
])(
  "marks the owning area without navigating away from %s",
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
          /^(工作区|个人中心|控制台)/.test(item.textContent ?? ""),
        )
        .map((item) => item.textContent),
    ).toEqual(
      ["工作区", "个人中心", "控制台"].map(
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
    const target = currentArea === "工作区" ? "个人中心" : "工作区";
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

it("selects appearance through the keyboard submenu and restores focus on close", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  localStorage.setItem("antcdp.appearance", "system");
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/admin"]}>
          <AppShell />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "用户菜单，测试用户" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  await user.keyboard("{End}{ArrowUp}{ArrowRight}");
  expect(
    await screen.findByRole("menuitemradio", { name: "跟随系统" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Home}{ArrowDown}{Enter}");
  await waitFor(() =>
    expect(localStorage.getItem("antcdp.appearance")).toBe("dark"),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("menuitem", { name: /外观\s*深色/ }),
  ).toBeInTheDocument();
  await user.keyboard("{End}{ArrowUp}{ArrowRight}");
  expect(
    await screen.findByRole("menuitemradio", { name: "深色" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(localStorage.getItem("antcdp.appearance")).toBe("dark");
});

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
  expect(await screen.findByRole("menuitem", { name: "工作区" })).toHaveFocus();
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
