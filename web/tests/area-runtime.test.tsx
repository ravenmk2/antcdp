import { agentRoot } from "@/features/agents/data/agent-api";
import {
  AgentRuntimeProvider,
  useAgentRuntime,
} from "@/features/agents/data/runtime-context";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/app/auth", () => ({ useSession: () => ({ user: { id: "1" } }) }));
vi.mock("@/api/client", async (original) => {
  const api = await original<typeof import("@/api/client")>();
  return {
    ...api,
    request: vi
      .fn()
      .mockRejectedValue(
        new api.ApiError(
          "NETWORK_ERROR",
          "结果未知",
          0,
          [],
          undefined,
          undefined,
          true,
        ),
      ),
  };
});

it("preserves drafts and uncertain command identity while region roots unmount", async () => {
  const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    "WebSocket",
    class {
      readyState = 0;
      close = vi.fn();
      constructor() {
        sockets.push(this);
      }
    },
  );
  let runtime: ReturnType<typeof useAgentRuntime> | undefined;
  function Probe() {
    runtime = useAgentRuntime();
    return (
      <>
        <p>工作区</p>
        <Link to="/account">个人中心</Link>
      </>
    );
  }
  const router = createMemoryRouter(
    [
      {
        element: (
          <AgentRuntimeProvider>
            <Outlet />
          </AgentRuntimeProvider>
        ),
        children: [
          { path: "/home", element: <Probe /> },
          { path: "/account", element: <p>个人中心</p> },
        ],
      },
    ],
    { initialEntries: ["/home"] },
  );
  const view = render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  expect(screen.getByText("工作区")).toBeVisible();
  expect(sockets).toHaveLength(1);
  const original = runtime!;
  const draft = original.drafts.get("session:7");
  draft.patch({
    text: "保留草稿",
    files: [new File(["content"], "draft.txt")],
  });
  const command = original.commands.get("session:7:control");
  await act(() =>
    command.run({
      domain: agentRoot,
      path: "/sessions/7/archive",
      command: "session.archive",
      scope: "session:7",
      options: { method: "POST", body: {} },
    }),
  );
  const pending = command.getSnapshot();
  expect(pending.phase).toBe("uncertain");
  expect(pending.key).toBeTruthy();
  await act(() => router.navigate("/account"));
  await act(() => router.navigate("/home"));
  expect(runtime).toBe(original);
  expect(sockets).toHaveLength(1);
  expect(sockets[0].close).not.toHaveBeenCalled();
  expect(draft.getSnapshot().text).toBe("保留草稿");
  expect(draft.getSnapshot().files[0].name).toBe("draft.txt");
  expect(runtime!.commands.get("session:7:control").getSnapshot()).toBe(
    pending,
  );
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(draft.getSnapshot().text).toBe("");
  expect(sockets[0].close).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
