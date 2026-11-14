import type { Resource } from "@/types/collaboration";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
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

const project: Resource = {
  id: "7",
  code: "delivery",
  name: "交付平台",
  summary: "",
  description: "",
  icon_key: null,
  icon_file_id: null,
  created_by_user_id: "1",
  version: "1",
  membership_version: "1",
  ended_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  direct_role: "",
  is_member: false,
  member_count: 1,
  status: "active",
  etag: '"project-v1"',
  membership_etag: '"members-v1"',
  can_manage: true,
};

vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (_key: unknown, path: string) => {
    if (path === "/projects/7") return { data: { data: project } };
    if (path === "/admin/agents/mcp-servers/7")
      return { data: { data: { name: "文档检索 MCP" } } };
    return {};
  },
}));

it("shows four breadcrumb levels with the current MCP server name", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/admin/mcp-servers/7"]}>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const navigation = screen.getByRole("navigation", { name: "当前位置" });
  expect(within(navigation).getAllByRole("link")).toHaveLength(3);
  expect(
    within(navigation).getByRole("link", { name: "文档检索 MCP" }),
  ).toHaveAttribute("href", "/admin/mcp-servers?edit=7");
  expect(within(navigation).getByText("工具调试")).toHaveAttribute(
    "aria-current",
    "page",
  );
});
