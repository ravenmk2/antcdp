import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";
import { expect, it, vi } from "vitest";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceEditor } from "@/features/workspace/resource-editor";

vi.mock("@/app/auth", () => ({
  useSession: () => ({
    user: { id: "1", username: "founder", display_name: "创始人" },
  }),
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
          <ResourceEditor
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
