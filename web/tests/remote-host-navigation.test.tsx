import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Component } from "@/features/remote-hosts/Page";
import { NavigationGuard } from "@/components/platform/navigation-guard";
import { request } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
vi.mock("@/lib/date", () => ({ useDate: () => (value: string) => value }));
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue({
    data: { latest: null },
    etag: '"host-1"',
  });
});
afterEach(cleanup);

function openHost(search: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/remote-hosts/5",
        loader: () => ({
          admin: true,
          list: "/admin/remote-hosts",
          items: [],
          tag: '"host-1"',
          host: {
            id: "5",
            name: "构建机",
            code: "build",
            description: "",
            enabled: true,
            service_type: "ssh",
            config: {
              host: "build.example.invalid",
              port: 22,
              host_keys: [],
              custom_ca_pem: null,
            },
          },
        }),
        element: (
          <NavigationGuard>
            <Component />
          </NavigationGuard>
        ),
      },
    ],
    { initialEntries: ["/admin/remote-hosts/5" + search] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

it("opens a linked host subview and preserves it through browser navigation", async () => {
  const router = openHost("?tab=keys");
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "探测公钥" });
  await user.click(screen.getByRole("button", { name: "主机配置" }));
  await screen.findByRole("button", { name: "编辑配置" });
  expect(router.state.location.search).toBe("?tab=settings");
  await act(() => router.navigate(-1));
  await screen.findByRole("button", { name: "探测公钥" });
  expect(router.state.location.search).toBe("?tab=keys");
});

it("protects an edited host when switching URL subviews and clears discarded drafts", async () => {
  const router = openHost("");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "编辑配置" }));
  await user.type(screen.getByLabelText("主机名称", { exact: false }), "修改");
  await user.click(screen.getByRole("button", { name: "主机公钥" }));
  await screen.findByRole("heading", { name: "放弃未保存的修改？" });
  expect(router.state.location.search).toBe("");
  await user.click(screen.getByRole("button", { name: "放弃并离开" }));
  await screen.findByRole("button", { name: "探测公钥" });
  await user.click(screen.getByRole("button", { name: "主机配置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "编辑配置" })).toBeTruthy(),
  );
  expect(screen.queryByRole("heading", { name: "编辑主机配置" })).toBeNull();
  expect(
    vi.mocked(request).mock.calls.every(([, options]) => !options?.method),
  ).toBe(true);
});
