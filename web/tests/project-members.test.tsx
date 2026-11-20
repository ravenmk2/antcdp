import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { ProjectMembers } from "@/areas/console/pages/projects/project-members";
import type { Member, Resource } from "@/types/collaboration";

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));

it("searches and adds a direct member in one dialog using the roster version", async () => {
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
    created_at: "2026-11-19T00:00:00Z",
    updated_at: "2026-11-19T00:00:00Z",
    direct_role: "",
    is_member: false,
    member_count: 0,
    status: "active",
    etag: '"project-v1"',
    membership_etag: '"members-v1"',
    can_manage: true,
  };
  const candidate = { id: "21", username: "lin", display_name: "林晓宇" };
  const roster: Member[] = [];
  const mocked = vi.mocked(request);
  mocked.mockImplementation(async (path, options) => {
    if (path.startsWith("/projects/7/member-options?")) {
      const query = new URLSearchParams(path.split("?")[1]).get("q");
      return {
        status: 200,
        etag: "",
        data: query === candidate.username ? [candidate] : [],
      };
    }
    if (path === "/projects/7/members" && options?.method === "POST") {
      roster.push({
        user_id: candidate.id,
        username: candidate.username,
        display_name: candidate.display_name,
        account_status: "active",
        direct_role: "member",
        effective_role: "member",
        sources: [{ type: "direct" }],
      });
      return { status: 204, etag: "", data: undefined };
    }
    if (path.startsWith("/projects/7/members?"))
      return {
        status: 200,
        etag: "",
        data: {
          items: [...roster],
          total: roster.length,
          membership_etag: '"members-v2"',
        },
      };
    throw new Error(`Unexpected request ${path}`);
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectMembers project={project} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText("暂无成员");
  const trigger = screen.getByRole("button", { name: "添加直接成员" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "添加直接成员" });
  const search = within(dialog).getByRole("textbox", { name: "选择用户" });
  await waitFor(() => expect(search).toHaveFocus());
  expect(search).not.toHaveAttribute("aria-invalid");

  const submit = within(dialog).getByRole("button", { name: "添加成员" });
  await user.click(submit);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "请选择用户",
  );
  await user.type(search, "lin{Enter}");
  const candidateRadio = await within(dialog).findByRole("radio", {
    name: /林晓宇/,
  });
  await user.click(candidateRadio);
  expect(candidateRadio).toBeChecked();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    mocked.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);

  await user.click(submit);
  expect(mocked).toHaveBeenCalledWith("/projects/7/members", {
    method: "POST",
    etag: '"members-v2"',
    body: { user_id: "21", role: "member" },
  });
  expect(
    await screen.findByRole("table", { name: "交付平台成员" }),
  ).toHaveTextContent("林晓宇");
  await waitFor(() => expect(trigger).toHaveFocus());
  client.clear();
});
