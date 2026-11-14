import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionHint } from "@/features/agents/chat/run-activity";

afterEach(() => vi.useRealTimers());

it("keeps brief connecting states quiet, delays reconnect hints and shows terminal failures immediately", () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <ConnectionHint connection="connecting" phase="subscribing" />,
  );
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ConnectionHint connection="open" phase="live" />);
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ConnectionHint connection="backoff" phase="subscribing" />);
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole("button", { name: "会话连接状态" })).toBeVisible();
  rerender(<ConnectionHint connection="open" phase="live" />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ConnectionHint connection="closed" phase="closed" />);
  expect(screen.getByRole("button", { name: "会话连接状态" })).toBeVisible();
});
