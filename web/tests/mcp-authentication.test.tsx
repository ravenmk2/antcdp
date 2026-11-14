import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ResourceAuthenticationEditor } from "@/features/agents/resources/resource-actions";

vi.mock("@/hooks/use-unsaved", () => ({ useUnsaved: () => () => {} }));
vi.mock("@/features/agents/data/agent-runtime", () => ({
  useAgentCommand: () => ({
    pending: false,
    uncertain: false,
    state: { phase: "idle" },
    command: { run: vi.fn(), reset: vi.fn() },
    recovery: null,
  }),
  useCommandResult: () => {},
}));

it("shows distinct MCP authentication choices and defaults custom headers to X-API-Key", async () => {
  const user = userEvent.setup();
  render(
    <ResourceAuthenticationEditor
      domain="/admin/agents"
      path="/mcp-servers/7"
      scope="mcp_server:7"
      command="mcp_server.authentication"
      etag='"v1"'
      authentication={{ auth_method: "none", has_secret: false }}
      mcp
      drawer
      onSaved={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByRole("combobox", { name: "认证方式" })).toHaveTextContent(
    "无需认证",
  );
  await user.click(screen.getByRole("combobox", { name: "认证方式" }));
  expect(
    screen.getByRole("option", { name: "Bearer Token" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "无需认证" })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "自定义" }));
  expect(screen.getByLabelText("认证请求头")).toHaveValue("X-API-Key");
  expect(screen.getByLabelText("新认证凭据")).toHaveAttribute(
    "type",
    "password",
  );
});
