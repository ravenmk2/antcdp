import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  RecentResourceTracker,
  readRecentResources,
} from "@/app/recent-resources";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

it("records only resource identities from visited workspace routes and separates accounts", async () => {
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:id",
        loader: () => ({
          resource: { name: "客户平台", description: "private body" },
        }),
        element: <RecentResourceTracker user="alice" />,
      },
      {
        path: "/teams/:id",
        loader: () => ({ resource: { name: "交付团队" } }),
        element: <RecentResourceTracker user="alice" />,
      },
      {
        path: "/admin/projects/:id",
        loader: () => ({ resource: { name: "管理项目" } }),
        element: <RecentResourceTracker user="alice" />,
      },
    ],
    { initialEntries: ["/projects/7"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(readRecentResources("alice")).toHaveLength(1));
  await act(() => router.navigate("/teams/2"));
  await act(() => router.navigate("/projects/7"));
  await act(() => router.navigate("/admin/projects/3"));
  expect(readRecentResources("alice")).toEqual([
    { to: "/projects/7", name: "客户平台", kind: "projects" },
    { to: "/teams/2", name: "交付团队", kind: "teams" },
  ]);
  expect(readRecentResources("bob")).toEqual([]);
  expect(sessionStorage.getItem("antcdp.recent-resources.alice")).not.toContain(
    "private body",
  );
});

it("ignores corrupt storage and keeps recent links within project and team routes", () => {
  sessionStorage.setItem("antcdp.recent-resources.alice", "corrupt");
  expect(readRecentResources("alice")).toEqual([]);
  sessionStorage.setItem(
    "antcdp.recent-resources.alice",
    JSON.stringify([
      { to: "https://example.invalid", name: "External", kind: "projects" },
      { to: "/account/integrations/7", name: "Credential", kind: "projects" },
      {
        to: "/projects/7",
        name: "Project",
        kind: "projects",
        description: "ignored",
      },
    ]),
  );
  expect(readRecentResources("alice")).toEqual([
    { to: "/projects/7", name: "Project", kind: "projects" },
  ]);
});
