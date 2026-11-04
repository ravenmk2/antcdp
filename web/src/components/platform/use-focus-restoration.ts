import { useEffect, useRef } from "react";

/** Restore the opener without carrying a text field's focus ring into pointer navigation. */
export function useFocusRestoration(active = true) {
  const opener = useRef<HTMLElement | null>(null);
  const keyboard = useRef(true);

  useEffect(() => {
    if (!active) return;
    const pointer = () => {
      keyboard.current = false;
    };
    const key = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey)
        keyboard.current = true;
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [active]);

  return {
    captureFocus() {
      opener.current = document.activeElement as HTMLElement | null;
      keyboard.current = opener.current?.matches(":focus-visible") ?? true;
    },
    restoreFocus() {
      if (opener.current?.isConnected) {
        opener.current.focus({
          preventScroll: true,
          focusVisible: keyboard.current,
        });
      }
    },
  };
}
