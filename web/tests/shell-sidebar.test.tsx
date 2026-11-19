import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "./fixtures/area-shell";

vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: "1",
      username: "founder",
      display_name: "创始人",
      role: "admin",
      is_founder: true,
    },
  }),
  useAuth: () => ({ settings: { site_name: "AntCDP" } }),
}));
vi.mock("@/app/theme", async (original) => ({
  ...(await original<typeof import("@/app/theme")>()),
  useTheme: () => ({
    appearance: "light",
    resolved: "light",
    setAppearance: vi.fn(),
    cycle: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-api", () => ({ useApiQuery: () => ({}) }));

afterEach(() => {
  localStorage.clear();
});

it.each(["/admin"])(
  "collapses group labels without a sidebar shortcut manager at %s",
  async (route) => {
    localStorage.setItem("antcdp.sidebar-collapsed", "true");
    const user = userEvent.setup();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[route]}>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const navigation = container.querySelector(".sidebar-navigation");
    expect(navigation).toHaveAttribute("data-compact", "true");
    expect(
      screen.queryByRole("button", { name: "管理关注项目" }),
    ).not.toBeInTheDocument();
    const labels = container.querySelectorAll(".sidebar-navigation .nav-label");
    expect(screen.getByRole("button", { name: "平台管理" })).toBeVisible();
    expect(screen.getByRole("link", { name: "系统概览" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const label of labels) {
      expect(label).toHaveAttribute("aria-hidden", "true");
    }

    await user.click(screen.getByRole("button", { name: "展开侧栏" }));
    await waitFor(() =>
      expect(navigation).toHaveAttribute("data-compact", "false"),
    );
    expect(
      localStorage.getItem(
        `antcdp.${route === "/admin" ? "console" : "workspace"}.sidebar-collapsed`,
      ),
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: "管理关注项目" }),
    ).not.toBeInTheDocument();
  },
);
