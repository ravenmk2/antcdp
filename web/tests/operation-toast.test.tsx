import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  OperationToastProvider,
  useOperationToast,
} from "@/components/platform/operation-toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("restarts the timeout for repeated successes and drops feedback from a previous page", async () => {
  vi.useFakeTimers();
  let tone: "success" | "info" | "warning" | "danger" = "success";
  let finishLater: (() => void) | undefined;
  function Controls() {
    const notify = useOperationToast();
    return (
      <button
        onClick={() => {
          notify("提示", tone);
          finishLater = () => notify("旧请求已完成");
        }}
      >
        保存
      </button>
    );
  }
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <OperationToastProvider>
          <Controls />
        </OperationToastProvider>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  const save = screen.getByRole("button");
  save.focus();
  for (const next of ["info", "warning", "danger", "success"] as const) {
    tone = next;
    fireEvent.click(save);
    expect(
      screen
        .getByRole("status")
        .firstElementChild?.getAttribute("data-feedback-tone"),
    ).toBe(next);
  }
  fireEvent.click(save);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  fireEvent.click(save);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByRole("status").textContent).toBe("提示");
  expect(document.activeElement).toBe(save);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("status").textContent).toBe("");
  fireEvent.click(save);
  await act(async () => {
    await router.navigate("/?tab=members");
  });
  expect(screen.getByRole("status").textContent).toBe("");
  act(() => finishLater?.());
  await act(async () => {
    await router.navigate(-1);
  });
  expect(screen.getByRole("status").textContent).toBe("");
});
