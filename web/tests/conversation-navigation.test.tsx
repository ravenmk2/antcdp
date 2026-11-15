import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { Shell } from "@/areas/workspace/shell/shell";

vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
vi.mock("@/app/auth", () => ({
  useSession: () => ({ user: { id: "1" } }),
  useAuth: () => ({ settings: { site_name: "AntCDP" } }),
}));
vi.mock("@/app/session-actions", () => ({
  LogoutDialog: () => null,
  ShellActions: () => null,
  useLogout: () => ({}),
}));
vi.mock("@/components/platform/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/areas/workspace/pages/workspace-sidebar", () => ({
  WorkspaceSidebar: () => null,
}));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(() => new Promise(() => {})),
}));

const detail = (id: string, agentId = "9") => ({
  data: { configuration: { id, agent_id: agentId, title: `Session ${id}` } },
});
const row = (id: string, agentId = "9") => ({
  id,
  agent_id: agentId,
  title: `Session ${id}`,
  attention: {
    question_interaction_count: 0,
    approval_interaction_count: 0,
    unviewed_run_count: 0,
  },
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  cache.setQueryData(["agent-session", "31", "detail"], detail("31"));
  cache.setQueryData(["agent-summary", "9"], {
    data: { id: "9", name: "Agent 9" },
  });
  cache.setQueryData(["agent-summary", "10"], {
    data: { id: "10", name: "Agent 10" },
  });
  cache.setQueryData(["agent-favorites"], {
    pages: [{ data: [], pagination: { total: 0 } }],
    pageParams: [1],
  });
  cache.setQueryData(["agent-sessions", "sidebar", "9"], {
    pages: [{ data: [row("31"), row("32")], pagination: { total: 2 } }],
    pageParams: [1],
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/agents/sessions/31"]}>
        <Shell />
        <Link to="/agents/sessions/99">Other session</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}

it("preserves sidebar DOM and scroll while fetching another session's detail", async () => {
  const cache = mount();
  const previous = screen.getByRole("link", { name: "Session 32" });
  const sidebar = screen.getByRole("complementary", { name: "对话导航" });
  sidebar.scrollTop = 120;
  fireEvent.click(previous);
  expect(screen.queryByText("正在读取会话所属智能体…")).toBeNull();
  expect(screen.getByRole("link", { name: "Session 32" })).toBe(previous);
  expect(previous).toHaveAttribute("aria-current", "page");
  expect(sidebar.scrollTop).toBe(120);
  await act(async () => {
    cache.setQueryData(["agent-session", "32", "detail"], detail("32"));
  });
  expect(screen.getByRole("link", { name: "Session 32" })).toBe(previous);
  fireEvent.click(screen.getByRole("link", { name: "Session 31" }));
  expect(screen.getByRole("link", { name: "Session 32" })).toBe(previous);
});

it("uses cached search results for a different agent, then trusts the fetched detail", async () => {
  const cache = mount();
  cache.setQueryData(["agent-sessions", "interactive", "search"], {
    data: [row("99", "10")],
  });
  fireEvent.click(screen.getByRole("link", { name: "Other session" }));
  expect(
    screen.getByRole("button", { name: "选择智能体：Agent 10" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Session 31" })).toBeNull();
  await act(async () => {
    cache.setQueryData(["agent-session", "99", "detail"], detail("99", "9"));
  });
  expect(
    await screen.findByRole("button", { name: "选择智能体：Agent 9" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Session 31" })).toBeInTheDocument();
});

it("does not assign an unknown session to the previous agent", () => {
  mount();
  fireEvent.click(screen.getByRole("link", { name: "Other session" }));
  expect(screen.getByText("正在读取会话所属智能体…")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Session 31" })).toBeNull();
});
