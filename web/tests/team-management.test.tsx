import { useState } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { Field, NumberInput } from "@/components/fields";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { AdminTeamDetail } from "@/areas/console/pages/teams/team-detail";
import { TeamDissolveDialog } from "@/areas/console/pages/teams/team-dissolve-dialog";
import { ResourceCreateEditor } from "@/features/collaboration/resource-create-editor";
import { ApiError, request } from "@/api/client";
import type { Resource } from "@/types/collaboration";

const team: Resource = {
  id: "7",
  code: "platform",
  name: "平台团队",
  summary: "团队摘要",
  description: "团队介绍",
  icon_key: null,
  icon_file_id: null,
  created_by_user_id: "1",
  version: "1",
  membership_version: "1",
  ended_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  direct_role: "",
  is_member: false,
  member_count: 1,
  status: "active",
  etag: '"team-7-1"',
  membership_etag: '"members-7-1"',
  dissolve_etag: '"dissolve-7-1"',
  can_manage: true,
};
vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: {
      id: "1",
      username: "founder",
      display_name: "创始人",
      role: "admin",
    },
  }),
  useAuth: () => ({ settings: { timezone: "Asia/Shanghai" } }),
}));
vi.mock("@/components/markdown", () => ({
  MarkdownView: ({ source }: { source: string }) => <p>{source}</p>,
}));
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(async () => ({ data: team })),
}));
vi.mock("@/hooks/use-api", () => ({
  useApiQuery: (_key: unknown, path: string) => {
    const data =
      path === "/teams/7"
        ? team
        : path === "/teams/7/projects"
          ? [{ ...team, id: "12", name: "平台项目" }]
          : path.includes("/members?")
            ? {
                items: [
                  {
                    user_id: "1",
                    avatar_file_id: "42",
                    username: "founder",
                    display_name: "创始人",
                    account_status: "active",
                    direct_role: "admin",
                    effective_role: "admin",
                    sources: [{ type: "direct" }],
                  },
                ],
                total: 1,
                page: 1,
                page_size: 20,
                membership_etag: team.membership_etag,
              }
            : [];
    return {
      data: { data },
      isPending: false,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { data } })),
    };
  },
}));

function mount(element: React.ReactNode, entry = "/admin/teams/7") {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/teams/:teamId",
        element: <NavigationGuardProvider>{element}</NavigationGuardProvider>,
      },
    ],
    { initialEntries: [entry] },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

it.each(["", "?tab=unknown"])(
  "renders team information for a default or invalid team tab: %s",
  async (search) => {
    mount(<AdminTeamDetail />, `/admin/teams/7${search}`);
    expect(screen.getByRole("tab", { name: "团队介绍" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const user = userEvent.setup();
    expect(
      screen.getByText("团队介绍", { selector: ".resource-document p" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "编辑资料" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /成员管理/ }));
    const table = screen.getByRole("table", { name: "平台团队成员" });
    expect(
      within(table).getByRole("img", { name: "创始人的头像" }),
    ).toHaveAttribute("src", "/api/v1/avatars/42");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["成员", "团队角色", "账号状态", "操作"]);
    await user.click(screen.getByRole("tab", { name: "团队介绍" }));
    expect(
      screen.getByText("团队介绍", { selector: ".resource-document p" }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "关联项目" }));
    expect(screen.getByRole("link", { name: /平台项目/ })).toHaveAttribute(
      "href",
      "/admin/projects/12",
    );
  },
);

it("preserves the legacy team settings link as team information", () => {
  mount(<AdminTeamDetail />, "/admin/teams/7?tab=settings");
  expect(screen.getByRole("tab", { name: "团队介绍" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByText("团队介绍", { selector: ".resource-document p" }),
  ).toBeVisible();
});

it("creates teams in one form and submits the selected initial administrator", async () => {
  const saved = vi.fn();
  mount(
    <ResourceCreateEditor kind="teams" onClose={vi.fn()} onSaved={saved} />,
  );
  const user = userEvent.setup();
  expect(
    screen.queryByRole("button", { name: "下一步" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "团队名称" }), "新团队");
  await user.type(screen.getByRole("textbox", { name: "编码" }), "new-team");
  await user.click(screen.getByRole("button", { name: "创建团队" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith(
    "/teams",
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        name: "新团队",
        code: "new-team",
        admin_user_ids: ["1"],
      }),
    }),
  );
});

it("requires the exact team code and uses its dissolve version", async () => {
  mount(<TeamDissolveDialog team={team} onClose={vi.fn()} />);
  const user = userEvent.setup();
  const submit = screen.getByRole("button", { name: "确认解散" });
  expect(submit).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: /输入团队编码/ }),
    "PLATFORM",
  );
  await user.click(submit);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/teams/7/dissolve", {
      method: "POST",
      etag: team.dissolve_etag,
      body: {},
    }),
  );
});

it.each([false, true])(
  "reloads dissolve conflicts without replaying writes (unknown result: %s)",
  async (uncertain) => {
    vi.mocked(request).mockRejectedValueOnce(
      new ApiError(
        uncertain ? "NETWORK_ERROR" : "VERSION_CONFLICT",
        "请核实团队状态",
        uncertain ? 0 : 412,
        [],
        undefined,
        undefined,
        uncertain,
      ),
    );
    mount(<TeamDissolveDialog team={team} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /输入团队编码/ }),
      "platform",
    );
    const count = vi.mocked(request).mock.calls.length;
    const submit = screen.getByRole("button", { name: "确认解散" });
    await user.click(submit);
    await user.click(
      await screen.findByRole("button", { name: "重新加载团队状态" }),
    );
    expect(request).toHaveBeenCalledTimes(count + 1);
    if (uncertain) expect(submit).toBeDisabled();
    else await waitFor(() => expect(submit).toBeEnabled());
  },
);

it("keeps number drafts empty, supports keyboard stepping and disables both arrows", async () => {
  function NumberFixture() {
    const [value, setValue] = useState("22");
    const [disabled, setDisabled] = useState(false);
    return (
      <>
        <Field label="SSH 端口">
          <NumberInput
            name="port"
            label="SSH 端口"
            min={1}
            max={65535}
            value={value}
            onValueChange={setValue}
            disabled={disabled}
          />
        </Field>
        <output aria-label="草稿">{value}</output>
        <button onClick={() => setDisabled(true)}>禁用</button>
      </>
    );
  }
  render(<NumberFixture />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "SSH 端口" });
  await user.click(screen.getByRole("button", { name: "增加SSH 端口" }));
  expect(screen.getByLabelText("草稿")).toHaveTextContent("23");
  await user.clear(input);
  expect(screen.getByLabelText("草稿")).toBeEmptyDOMElement();
  await user.type(input, "65535");
  await user.keyboard("{ArrowUp}");
  expect(screen.getByLabelText("草稿")).toHaveTextContent("65535");
  await user.click(screen.getByRole("button", { name: "禁用" }));
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: "增加SSH 端口" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "减少SSH 端口" })).toBeDisabled();
});
