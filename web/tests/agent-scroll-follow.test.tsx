import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollFollow } from "@/features/agents/chat/use-scroll-follow";
import { ChatDisclosure } from "@/features/agents/chat/disclosure";

const observers: {
  callback: ResizeObserverCallback;
  elements: Set<Element>;
}[] = [];
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
beforeEach(() => {
  observers.length = 0;
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, elements: new Set() };
        observers.push(this.entry);
      }
      observe(element: Element) {
        this.entry.elements.add(element);
      }
      disconnect() {
        this.entry.elements.clear();
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ ready = true }: { ready?: boolean }) {
  const follow = useScrollFollow();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output aria-label="跟随状态">
        {follow.following ? "following" : "reading"}
      </output>
      <button onClick={follow.scrollToBottom}>回到底部</button>
      <button onClick={follow.prepareHistory}>加载历史</button>
      {ready && (
        <div
          ref={follow.scroll}
          data-testid="viewport"
          className="agent-chat-scroll"
          onClickCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(".agent-disclosure-trigger")
            )
              follow.pauseFollowing();
          }}
        >
          <div ref={follow.content} data-testid="content">
            <ChatDisclosure
              open={open}
              onToggle={() => setOpen(!open)}
              label="工具过程"
            >
              过程内容
            </ChatDisclosure>
          </div>
        </div>
      )}
    </>
  );
}
function setupGeometry() {
  const node = screen.getByTestId("viewport");
  const size = { height: 2000, viewport: 500, top: 0 };
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, get: () => size.height },
    clientHeight: { configurable: true, get: () => size.viewport },
    scrollTop: {
      configurable: true,
      get: () => size.top,
      set: (value: number) => {
        size.top = Math.max(0, Math.min(value, size.height - size.viewport));
      },
    },
  });
  return { node, size };
}
function frame() {
  act(() => {
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback(performance.now() + 300);
  });
}
function resize(element: Element) {
  act(() => {
    for (const entry of observers)
      if (entry.elements.has(element)) entry.callback([], {} as ResizeObserver);
  });
  frame();
}
function expectFollowing(value: boolean) {
  expect(screen.getByLabelText("跟随状态")).toHaveTextContent(
    value ? "following" : "reading",
  );
}

it("resumes after a scrollbar drag to the bottom and survives content growth before the resize notification", () => {
  render(<Harness />);
  const { node, size } = setupGeometry();
  resize(node);
  expect(size.top).toBe(1500);
  node.scrollTop = 800;
  fireEvent.scroll(node);
  expectFollowing(false);
  node.scrollTop = 1500;
  fireEvent.scroll(node);
  expectFollowing(true);
  size.height = 2600;
  fireEvent.scroll(node); // Browser scroll delivery races with streamed layout.
  expectFollowing(true);
  resize(screen.getByTestId("content"));
  expect(size.top).toBe(2100);
});

it("follows viewport resizing from a question or composer without needing a new message", () => {
  render(<Harness />);
  const { node, size } = setupGeometry();
  resize(node);
  size.viewport = 250;
  resize(node);
  expect(size.top).toBe(1750);
  expectFollowing(true);
  size.viewport = 700;
  resize(node);
  expect(size.top).toBe(1300);
});

it("cancels an active disclosure anchor when the user clicks back to bottom", () => {
  render(<Harness />);
  const { node, size } = setupGeometry();
  resize(node);
  fireEvent.click(screen.getByRole("button", { name: "工具过程" }));
  expect(node.dataset.disclosureMoving).toBe("true");
  expectFollowing(false);
  fireEvent.click(screen.getByRole("button", { name: "回到底部" }));
  expect(node.dataset.disclosureMoving).toBeUndefined();
  size.height += 600;
  resize(screen.getByTestId("content"));
  expect(size.top).toBe(2100);
  expectFollowing(true);
  fireEvent.scroll(node);
  expectFollowing(true);
});

it("keeps manual reading paused during growth and preserves position when history is prepended", () => {
  render(<Harness />);
  const { node, size } = setupGeometry();
  resize(node);
  fireEvent.wheel(node, { deltaY: -500 });
  // A queued scroll event can arrive before the wheel has moved the viewport.
  fireEvent.scroll(node);
  expectFollowing(false);
  node.scrollTop = 800;
  fireEvent.scroll(node);
  size.height = 2300;
  resize(screen.getByTestId("content"));
  expect(size.top).toBe(800);
  expectFollowing(false);
  fireEvent.click(screen.getByRole("button", { name: "加载历史" }));
  size.height += 700;
  resize(screen.getByTestId("content"));
  expect(size.top).toBe(1500);
  expectFollowing(false);
});

it("observes a transcript mounted after asynchronous page data becomes available", () => {
  const { rerender } = render(<Harness ready={false} />);
  rerender(<Harness />);
  const { node, size } = setupGeometry();
  resize(node);
  expect(size.top).toBe(1500);
  size.height = 2800;
  resize(screen.getByTestId("content"));
  expect(size.top).toBe(2300);
});
