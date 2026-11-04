import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import {
  NavigationGuard,
  useNavigationProtection,
} from "@/components/platform/navigation-guard";
afterEach(cleanup);
function Editing() {
  useNavigationProtection("dirty");
  return <p>正在编辑</p>;
}
it("blocks navigation until the user explicitly discards the draft", async () => {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <NavigationGuard>
          <Outlet />
        </NavigationGuard>
      ),
      children: [
        { index: true, Component: Editing },
        { path: "other", element: <p>其他页面</p> },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
  await screen.findByText("正在编辑");
  await act(() => router.navigate("/other"));
  expect(router.state.location.pathname).toBe("/");
  await userEvent.click(screen.getByRole("button", { name: "继续停留" }));
  expect(router.state.location.pathname).toBe("/");
  await act(() => router.navigate("/other"));
  await userEvent.click(screen.getByRole("button", { name: "放弃并离开" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/other"));
});
