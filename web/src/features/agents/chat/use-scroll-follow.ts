import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  cancelDisclosureScrollAnchor,
  DISCLOSURE_SETTLED_EVENT,
} from "./disclosure-motion";

const BOTTOM_THRESHOLD = 80;
function geometry(node: HTMLElement) {
  return {
    top: node.scrollTop,
    height: node.scrollHeight,
    viewport: node.clientHeight,
  };
}
function nearBottom(value: ReturnType<typeof geometry>) {
  return value.height - value.top - value.viewport < BOTTOM_THRESHOLD;
}

/** Follow is user intent, not a measurement that content growth can turn off. */
export function useScrollFollow() {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const follow = useRef(true);
  const last = useRef<ReturnType<typeof geometry> | null>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const historyHeight = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const directScroll = useRef(false);
  const movingAway = useRef(false);

  const captureAnchor = useCallback(() => {
    if (!viewport || follow.current) {
      anchor.current = null;
      return;
    }
    const top = viewport.getBoundingClientRect().top;
    const element = [
      ...viewport.querySelectorAll<HTMLElement>("[data-message-anchor]"),
    ].find((item) => item.getBoundingClientRect().bottom > top);
    anchor.current = element
      ? {
          id: element.dataset.messageAnchor!,
          offset: element.getBoundingClientRect().top - top,
        }
      : null;
  }, [viewport]);

  const synchronize = useCallback(() => {
    if (!viewport || viewport.dataset.disclosureMoving) return;
    if (historyHeight.current !== null) {
      viewport.scrollTop += viewport.scrollHeight - historyHeight.current;
      historyHeight.current = null;
    } else if (follow.current) {
      viewport.scrollTop = viewport.scrollHeight;
    } else if (anchor.current) {
      const saved = anchor.current;
      const element = [
        ...viewport.querySelectorAll<HTMLElement>("[data-message-anchor]"),
      ].find((item) => item.dataset.messageAnchor === saved.id);
      if (element?.getClientRects().length)
        viewport.scrollTop +=
          element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          saved.offset;
    }
    last.current = geometry(viewport);
  }, [viewport]);

  const schedule = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      synchronize();
    });
  }, [synchronize]);

  const pauseFollowing = useCallback(() => {
    movingAway.current = true;
    follow.current = false;
    setFollowing(false);
    captureAnchor();
  }, [captureAnchor]);

  const scrollToBottom = useCallback(() => {
    movingAway.current = false;
    follow.current = true;
    setFollowing(true);
    anchor.current = null;
    historyHeight.current = null;
    if (viewport) cancelDisclosureScrollAnchor(viewport);
    synchronize();
    schedule();
  }, [viewport, synchronize, schedule]);

  const prepareHistory = useCallback(() => {
    historyHeight.current = viewport?.scrollHeight ?? null;
    pauseFollowing();
  }, [viewport, pauseFollowing]);

  useLayoutEffect(synchronize, [synchronize, body]);
  useEffect(() => {
    if (!viewport || !body) return;
    const onScroll = () => {
      if (viewport.dataset.disclosureMoving) return;
      const current = geometry(viewport);
      const previous = last.current;
      const resized =
        previous &&
        (previous.height !== current.height ||
          previous.viewport !== current.viewport);
      const movedUp = previous && current.top < previous.top - 1;
      if (movedUp && !resized) movingAway.current = true;
      else if (previous && current.top > previous.top + 1 && !resized)
        movingAway.current = false;
      if (nearBottom(current) && !movingAway.current) {
        follow.current = true;
        setFollowing(true);
        anchor.current = null;
      } else if ((movedUp && !resized) || directScroll.current) {
        pauseFollowing();
      }
      last.current = current;
      if (follow.current) schedule();
      else captureAnchor();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) movingAway.current = event.deltaY < 0;
      cancelDisclosureScrollAnchor(viewport);
      if (event.deltaY < 0) pauseFollowing();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, [contenteditable=true]")
      )
        return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        movingAway.current = true;
        cancelDisclosureScrollAnchor(viewport);
        pauseFollowing();
      }
      if (["ArrowDown", "PageDown", "End"].includes(event.key))
        movingAway.current = false;
    };
    const onPointer = (event: PointerEvent) => {
      cancelDisclosureScrollAnchor(viewport);
      directScroll.current =
        event.target === viewport || event.pointerType === "touch";
      if (directScroll.current) movingAway.current = false;
    };
    const endPointer = () => {
      if (directScroll.current) onScroll();
      directScroll.current = false;
    };
    const settled = () => {
      if (follow.current) synchronize();
      else {
        captureAnchor();
        last.current = geometry(viewport);
      }
    };
    // Both the transcript and its available viewport can change independently.
    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    observer.observe(viewport);
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKey);
    viewport.addEventListener("pointerdown", onPointer, { passive: true });
    viewport.addEventListener(DISCLOSURE_SETTLED_EVENT, settled);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKey);
      viewport.removeEventListener("pointerdown", onPointer);
      viewport.removeEventListener(DISCLOSURE_SETTLED_EVENT, settled);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    };
  }, [viewport, body, schedule, synchronize, captureAnchor, pauseFollowing]);

  return {
    scroll: setViewport,
    content: setBody,
    following,
    scrollToBottom,
    pauseFollowing,
    prepareHistory,
    synchronize,
  };
}
