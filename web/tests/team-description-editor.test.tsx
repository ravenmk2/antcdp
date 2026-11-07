import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { ApiError, request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { TeamDescriptionEditor } from "@/features/workspace/team-description-editor";

const team = {
  id: "7",
  code: "platform",
  name: "平台团队",
  description: "原始内容",
  etag: '"v1"',
  can_manage: true,
  status: "active",
};
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({
  useApiQuery: () => ({ data: { data: team }, isPending: false }),
}));
vi.mock("@/components/markdown", () => ({
  MarkdownEditor: ({
    initial,
    onChange,
    disabled,
    toolbarStart,
    toolbarEnd,
    notices,
  }: {
    initial: string;
    onChange: (value: string) => void;
    disabled: boolean;
    toolbarStart?: React.ReactNode;
    toolbarEnd?: React.ReactNode;
    notices?: React.ReactNode;
  }) => {
    const [value, setValue] = useState(initial);
    return (
      <>
        {toolbarStart}
        {toolbarEnd}
        {notices}
        <textarea
          aria-label="Markdown 源码"
          disabled={disabled}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onChange(event.target.value);
          }}
        />
      </>
    );
  },
}));

function mount() {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/teams/7/description/edit",
        element: (
          <NavigationGuardProvider>
            <TeamDescriptionEditor />
          </NavigationGuardProvider>
        ),
      },
      { path: "/admin/teams/7", element: <p>团队详情</p> },
    ],
    { initialEntries: ["/admin/teams/7/description/edit"] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("saves only the description with its version and prevents duplicate pending saves", async () => {
  let complete!: (value: Awaited<ReturnType<typeof request>>) => void;
  vi.mocked(request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }) as ReturnType<typeof request>,
  );
  const user = mount();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "新描述" },
  });
  await user.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/teams/7", {
    method: "PATCH",
    etag: '"v1"',
    body: { description: "新描述" },
  });
  complete({
    data: { ...team, description: "新描述", etag: '"v2"' },
    etag: '"v2"',
    status: 200,
  });
  expect(await screen.findByText("团队描述已保存")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "第二次修改" },
  });
  await user.click(screen.getByRole("link", { name: "返回团队信息" }));
  expect(
    screen.getByRole("button", { name: "放弃修改并离开" }),
  ).toBeInTheDocument();
});

it.each([false, true])(
  "preserves the draft while reconciling a conflict or unknown result (%s)",
  async (uncertain) => {
    vi.mocked(request)
      .mockRejectedValueOnce(
        new ApiError(
          uncertain ? "NETWORK_ERROR" : "VERSION_CONFLICT",
          "保存失败",
          409,
          [],
          undefined,
          undefined,
          uncertain,
        ),
      )
      .mockResolvedValueOnce({
        data: { ...team, description: "其他人更新", etag: '"v2"' },
        etag: '"v2"',
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { ...team, description: "我的草稿", etag: '"v3"' },
        etag: '"v3"',
        status: 200,
      });
    const user = mount();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "我的草稿" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "加载最新内容" });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "加载最新内容" }));
    await screen.findByText("其他人更新");
    expect(screen.getByRole("textbox")).toHaveValue("我的草稿");
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "采用最新版本，保留草稿" }),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith("/teams/7", {
        method: "PATCH",
        etag: '"v2"',
        body: { description: "我的草稿" },
      }),
    );
  },
);
