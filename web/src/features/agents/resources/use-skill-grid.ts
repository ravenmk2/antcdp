import { useEffect, useRef, useState } from "react";

export function useSkillGrid(requestedSize: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 4, rows: 4 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width) return;
      const style = getComputedStyle(element);
      const gap = parseFloat(style.getPropertyValue("--skill-gap")) || 16;
      const minWidth =
        parseFloat(style.getPropertyValue("--skill-column-min")) || 320;
      const height =
        parseFloat(style.getPropertyValue("--skill-card-height")) || 128;
      const columns = Math.min(
        100,
        Math.max(1, Math.floor((rect.width + gap) / (minWidth + gap))),
      );
      // Reserve space for the independent pagination and the page's bottom margin.
      const rows = Math.max(
        1,
        Math.min(
          Math.floor(100 / columns),
          Math.floor(
            (window.innerHeight - rect.top - 88 + gap) / (height + gap),
          ),
        ),
      );
      setLayout((old) =>
        old.columns === columns && old.rows === rows ? old : { columns, rows },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const base = layout.columns * layout.rows;
  const requested = Number(requestedSize);
  const size =
    Number.isInteger(requested) && requested > 0 && requested <= 100
      ? Math.max(
          layout.columns,
          Math.floor(requested / layout.columns) * layout.columns,
        )
      : base;
  const sizeOptions = [
    ...new Set(
      [base, base * 2, base * 3, base * 4, size].filter(
        (value) => value <= 100,
      ),
    ),
  ].sort((a, b) => a - b);
  return { ref, size, sizeOptions };
}
