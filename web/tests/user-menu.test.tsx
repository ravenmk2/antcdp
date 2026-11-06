import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "@/app/Shell";
import { ThemeProvider } from "@/app/theme";

vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: 1,
      username: "reviewer",
      display_name: "测试用户",
      role: "admin",
      is_founder: true,
    },
  }),
  useAuth: () => ({ settings: { site_name: "AntCDP" } }),
}));
vi.mock("@/hooks/use-api", () => ({ useApiQuery: () => ({}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

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
    await screen.findByRole("menuitemradio", { name: "跟随电脑" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Home}{ArrowDown}{Enter}");
  await waitFor(() =>
    expect(localStorage.getItem("antcdp.appearance")).toBe("dark"),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("menuitem", { name: /外观\s*深色/ }),
  ).toBeInTheDocument();
  await user.keyboard("{End}{ArrowUp}{ArrowRight}");
  expect(
    await screen.findByRole("menuitemradio", { name: "深色" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(localStorage.getItem("antcdp.appearance")).toBe("dark");
});
