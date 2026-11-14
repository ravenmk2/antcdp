/** Copy from a user gesture, including on HTTP installations without Clipboard API. */
export async function copyText(value: string, trigger?: HTMLElement) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Browser permissions can deny the async API while gesture-based copy works.
    }
  }

  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const inputSelection =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection,
        }
      : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  // Stay inside the originating dialog/drawer so its focus trap permits selection.
  const host =
    trigger?.parentElement ??
    active?.closest('[role="dialog"], dialog') ??
    document.body;
  try {
    host.append(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
  } finally {
    textarea.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (
      inputSelection?.start != null &&
      inputSelection.end != null &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement)
    ) {
      active.setSelectionRange(
        inputSelection.start,
        inputSelection.end,
        inputSelection.direction ?? undefined,
      );
    }
  }
}
