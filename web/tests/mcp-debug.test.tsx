import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { ApiError } from "@/api/client";
import { MCPDebugWorkspace } from "@/features/agents/resources/mcp-debug";
import type { MCPServer, MCPTestResult } from "@/types/agent-resources";

const mocks = vi.hoisted(() => ({ request: vi.fn(), refetch: vi.fn() }));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: mocks.request,
}));
vi.mock("@/hooks/use-api", () => ({
  useApiQuery: () => ({
    data: { data: { latest: null } },
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/hooks/use-unsaved", () => ({ useUnsaved: () => () => {} }));
vi.mock("@/app/theme", () => ({ useTheme: () => ({ resolved: "light" }) }));
const server: MCPServer = {
  agent_count: 0,
  id: "7",
  code: "fixture",
  name: "MCP test",
  description: "",
  enabled: true,
  version: "version1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  config: {
    url: "http://fixture.test/mcp",
    transport: "streamable_http",
    timeout_seconds: 60,
    requested_protocol_versions: [],
  },
  authentication: { auth_method: "none", has_secret: false },
  latest_test: null,
};
const found: MCPTestResult = {
  session_id: "debug-session",
  expires_at: "2099-01-01T00:00:00Z",
  server_version: "version1",
  tool_count: 1,
  tools: [
    {
      name: "echo",
      title: "回声",
      description: "Return a message",
      input_schema: { type: "object" },
      output_schema: null,
      annotations: {},
      definition_fingerprint: "a".repeat(64),
    },
  ],
  diagnostic: {
    kind: "connection_test",
    status: "succeeded",
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:01Z",
    duration_ms: 1000,
    outdated: false,
    checks: [],
  },
};
async function discover() {
  mocks.request.mockResolvedValueOnce({ data: found });
  render(
    <MCPDebugWorkspace
      server={server}
      etag='"version1"'
      onRefresh={() => {}}
    />,
  );
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "MCP 工具列表" }),
    ).getByRole("button", { name: "连接" }),
  );
  await screen.findByRole("button", { name: "调用工具" });
}
describe("MCP lightweight debug", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({});
  });
  it("tests saved configuration without calling a tool, then validates JSON locally", async () => {
    await discover();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toMatch(/\/debug-sessions$/);
    fireEvent.change(screen.getByLabelText("调用参数（JSON）"), {
      target: { value: "{" },
    });
    fireEvent.click(screen.getByRole("button", { name: "调用工具" }));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("调用参数（JSON）")).toHaveFocus();
    expect(screen.getByLabelText("调用参数（JSON）")).toHaveValue("{");
  });
  it("sends the discovered fingerprint and preserves unknown outcomes without automatic retry", async () => {
    await discover();
    mocks.request.mockRejectedValueOnce(
      new ApiError(
        "NETWORK_ERROR",
        "connection lost",
        0,
        [],
        undefined,
        undefined,
        true,
      ),
    );
    fireEvent.change(screen.getByLabelText("调用参数（JSON）"), {
      target: { value: '{"message":"hello"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "调用工具" }));
    await screen.findByText("结果未知");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][1].body).toEqual({
      session_id: "debug-session",
      tool_name: "echo",
      definition_fingerprint: "a".repeat(64),
      arguments: { message: "hello" },
    });
    expect(screen.getByRole("button", { name: "调用工具" })).toBeDisabled();
    expect(screen.getByLabelText("调用参数（JSON）")).toHaveValue(
      '{"message":"hello"}',
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "调用工具" })).toBeDisabled();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    mocks.request.mockResolvedValueOnce({ data: found });
    fireEvent.click(
      within(
        screen.getByRole("complementary", { name: "MCP 工具列表" }),
      ).getByRole("button", { name: "连接" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "调用工具" })).toBeEnabled(),
    );
  });
  it("previews validated examples without overwriting input or invoking tools", async () => {
    await discover();
    fireEvent.change(screen.getByLabelText("调用参数（JSON）"), {
      target: { value: '{"message":"draft"}' },
    });
    mocks.request.mockResolvedValueOnce({
      data: { arguments: { message: "example" }, valid: true, issues: [] },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成示例参数" }));
    await screen.findByText("示例参数 · 尚未替换当前内容");
    expect(screen.getByLabelText("调用参数（JSON）")).toHaveValue(
      '{"message":"draft"}',
    );
    expect(mocks.request.mock.calls[1][0]).toMatch(/\/example-arguments$/);
    fireEvent.click(screen.getByRole("button", { name: "使用示例替换参数" }));
    expect(
      JSON.parse(
        (screen.getByLabelText("调用参数（JSON）") as HTMLTextAreaElement)
          .value,
      ),
    ).toEqual({ message: "example" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("retains a session across calls and safely highlights JSON output", async () => {
    await discover();
    const content = '{"message":"<script>alert(1)</script>","ok":true}';
    mocks.request.mockResolvedValue({
      data: {
        status: "succeeded",
        executed: true,
        content,
        structured_content: null,
        duration_ms: 10,
        truncated: false,
        error: null,
        session_active: true,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "调用工具" }));
    const output = await screen.findByLabelText("返回结果内容");
    expect(screen.getByLabelText("返回结果语法高亮")).toBeInTheDocument();
    expect(output.querySelector("script")).toBeNull();
    expect(output).toHaveTextContent("<script>alert(1)</script>");
    fireEvent.click(screen.getByRole("button", { name: "调用工具" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    expect(mocks.request.mock.calls[2][1].body.session_id).toBe(
      "debug-session",
    );
  });
  it("connects once under StrictMode for save-and-connect", async () => {
    mocks.request.mockResolvedValue({ data: found });
    render(
      <StrictMode>
        <MCPDebugWorkspace
          server={server}
          etag='"version1"'
          onRefresh={() => {}}
          autoConnect
        />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "断开" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
