import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";
import { expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceCreateEditor } from "@/features/collaboration/resource-create-editor";
import { ResourceProfileEditor } from "@/features/collaboration/resource-profile-editor";
import type { Resource } from "@/types/collaboration";

vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: { id: "1", username: "founder", display_name: "创始人" },
  }),
}));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({
  useApiQuery: () => ({ data: { data: [] }, isPending: false }),
}));

function Page() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <button onClick={() => setParams({ create: "1" })}>创建项目</button>
      <OverlayPresence>
        {params.get("create") === "1" && (
          <ResourceCreateEditor
            kind="projects"
            onClose={() => setParams({})}
            onSaved={vi.fn()}
          />
        )}
      </OverlayPresence>
    </>
  );
}

it.each(["关闭", "取消"])(
  "confirms %s once before removing the create URL parameter",
  async (closeLabel) => {
    const user = userEvent.setup();
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <NavigationGuardProvider>
            <Page />
          </NavigationGuardProvider>
        ),
      },
    ]);
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: "创建项目" });
    await user.click(trigger);
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog", { name: "创建项目" })).getByRole(
          "button",
          { name: "关闭" },
        ),
      ).toHaveFocus(),
    );
    await user.type(
      screen.getByRole("textbox", { name: "项目名称" }),
      "临时草稿",
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "创建项目" })).getByRole(
        "button",
        { name: closeLabel },
      ),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "放弃未保存的修改？",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "取消" }),
    );
    expect(router.state.location.search).toBe("?create=1");
    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue(
      "临时草稿",
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "创建项目" })).getByRole(
        "button",
        { name: closeLabel },
      ),
    );
    await user.click(await screen.findByRole("button", { name: "放弃修改" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(router.state.location.search).toBe("");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
);

const team: Resource = {
  id: "7",
  code: "platform",
  name: "平台团队",
  summary: "团队摘要",
  description: "独立维护的团队描述",
  icon_key: null,
  icon_file_id: null,
  created_by_user_id: "1",
  version: "1",
  membership_version: "1",
  ended_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  direct_role: "admin",
  is_member: true,
  member_count: 1,
  status: "active",
  etag: '"team-v1"',
  membership_etag: '"members-v1"',
  can_manage: true,
};

it("saves profile fields with the resource version without submitting the separate description", async () => {
  const saved = vi.fn();
  vi.mocked(request).mockResolvedValue({
    data: { ...team, name: "平台协作团队" },
    etag: '"team-v2"',
    status: 200,
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <NavigationGuardProvider>
          <ResourceProfileEditor
            kind="teams"
            resource={team}
            separateDescription
            onClose={vi.fn()}
            onSaved={saved}
          />
        </NavigationGuardProvider>
      ),
    },
  ]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  // The popup schedules initial focus in an animation frame. Let it finish
  // before userEvent starts typing, otherwise focus can move mid-input.
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog", { name: "编辑团队" })).getByRole(
        "button",
        { name: "关闭" },
      ),
    ).toHaveFocus(),
  );
  const name = screen.getByRole("textbox", { name: "团队名称" });
  await user.clear(name);
  await user.type(name, "平台协作团队");
  expect(name).toHaveValue("平台协作团队");
  await user.click(screen.getByRole("button", { name: "保存更改" }));

  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith("/teams/7", {
    method: "PATCH",
    etag: '"team-v1"',
    body: {
      name: "平台协作团队",
      summary: "团队摘要",
      icon: { type: "default" },
    },
  });
});
