import { useEffect, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { mapMarkdownScroll, type ScrollAnchor } from "@/lib/markdown-scroll";

export function useMarkdownScrollSync(
  editor: RefObject<EditorView | null>,
  preview: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  document: string,
) {
  useEffect(() => {
    const view = editor.current,
      right = preview.current;
    if (!enabled || !view || !right) return;
    const left = view.scrollDOM;
    let frame = 0;
    let owner: "source" | "preview" = "source";
    let anchors: ScrollAnchor[] | null = null;
    const expected: { source?: number; preview?: number } = {};
    function measure(): ScrollAnchor[] {
      const maxLeft = Math.max(0, left.scrollHeight - left.clientHeight);
      const maxRight = Math.max(0, right!.scrollHeight - right!.clientHeight);
      const result: ScrollAnchor[] = [{ source: 0, preview: 0 }];
      const rightTop = right!.getBoundingClientRect().top;
      const sourceTop =
        view!.documentTop - left.getBoundingClientRect().top + left.scrollTop;
      const elements = new Map<number, HTMLElement>();
      for (const element of right!.querySelectorAll<HTMLElement>(
        "[data-source-line]",
      )) {
        const line = Number(element.dataset.sourceLine);
        if (line >= 1 && line <= view!.state.doc.lines)
          elements.set(line, element);
      }
      for (const [line, element] of [...elements].sort(([a], [b]) => a - b)) {
        const source =
          sourceTop + view!.lineBlockAt(view!.state.doc.line(line).from).top;
        const preview =
          element.getBoundingClientRect().top - rightTop + right!.scrollTop;
        const last = result.at(-1)!;
        if (
          source > last.source &&
          preview > last.preview &&
          source < maxLeft &&
          preview < maxRight
        )
          result.push({ source, preview });
      }
      result.push({ source: maxLeft, preview: maxRight });
      return result;
    }
    function sync() {
      frame = 0;
      anchors ??= measure();
      const targetSide = owner === "source" ? "preview" : "source";
      const target = owner === "source" ? right! : left;
      const origin = owner === "source" ? left : right!;
      const next = mapMarkdownScroll(origin.scrollTop, anchors, owner);
      if (Math.abs(target.scrollTop - next) > 0.5) {
        target.scrollTop = next;
        expected[targetSide] = target.scrollTop;
      }
    }
    function schedule(side: typeof owner) {
      const actual = side === "source" ? left.scrollTop : right!.scrollTop;
      if (
        expected[side] !== undefined &&
        Math.abs(actual - expected[side]!) < 1
      ) {
        expected[side] = undefined;
        return;
      }
      expected[side] = undefined;
      owner = side;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    }
    const onLeft = () => schedule("source"),
      onRight = () => schedule("preview");
    left.addEventListener("scroll", onLeft, { passive: true });
    right.addEventListener("scroll", onRight, { passive: true });
    const resized = () => {
      anchors = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const observer = new ResizeObserver(resized);
    observer.observe(left);
    observer.observe(view.contentDOM);
    observer.observe(right);
    if (right.firstElementChild) observer.observe(right.firstElementChild);
    resized();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      left.removeEventListener("scroll", onLeft);
      right.removeEventListener("scroll", onRight);
    };
  }, [editor, preview, enabled, document]);
}
