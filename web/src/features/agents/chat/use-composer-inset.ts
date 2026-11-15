import { useCallback } from "react";

/** Keep the transcript's trailing space in sync with the floating dock. */
export function useComposerInset() {
  return useCallback((footer: HTMLElement | null) => {
    const primary = footer?.parentElement;
    if (!footer || !primary) return;
    const measure = () => {
      primary.style.setProperty(
        "--chat-dock-height",
        `${footer.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      primary.style.removeProperty("--chat-dock-height");
    };
  }, []);
}
