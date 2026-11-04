import { useEffect, useRef, useState } from "react";
import { Expand, Minus, Plus, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fitDiagramViewport } from "./diagram-viewport";

function DiagramSurface({ svg }: { svg: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let frame = 0;
    const fit = () => {
      if (!alive) return;
      frame = requestAnimationFrame(() => {
        const element = host.current?.querySelector("svg");
        if (element && typeof element.getBBox === "function")
          fitDiagramViewport(element);
      });
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [svg]);
  return (
    <div
      ref={host}
      className="mermaid-surface"
      role="img"
      aria-label="Mermaid 图表"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
const clamp = (value: number) => Math.max(0.25, Math.min(6, value));
function DiagramStage({ svg }: { svg: string }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const reset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale((old) => clamp(old * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return (
    <>
      <div className="mermaid-viewer-toolbar">
        <div>
          <DialogTitle>Mermaid 图表</DialogTitle>
          <DialogDescription>
            拖动移动 · 滚轮缩放 · 方向键平移 · Esc 关闭
          </DialogDescription>
        </div>
        <div className="mermaid-viewer-controls">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="缩小图形"
            title="缩小"
            disabled={scale <= 0.25}
            onClick={() => setScale((old) => clamp(old / 1.25))}
          >
            <Minus />
          </Button>
          <output aria-label="图形缩放比例">{Math.round(scale * 100)}%</output>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="放大图形"
            title="放大"
            disabled={scale >= 6}
            onClick={() => setScale((old) => clamp(old * 1.25))}
          >
            <Plus />
          </Button>
          <Button type="button" variant="outline" onClick={reset}>
            <RotateCcw />
            复位
          </Button>
        </div>
      </div>
      <div
        ref={stage}
        className="mermaid-viewer-stage"
        tabIndex={0}
        role="region"
        aria-label="图形缩放与移动区域"
        onKeyDown={(event) => {
          const steps: Record<string, { x: number; y: number }> = {
            ArrowLeft: { x: -40, y: 0 },
            ArrowRight: { x: 40, y: 0 },
            ArrowUp: { x: 0, y: -40 },
            ArrowDown: { x: 0, y: 40 },
          };
          if (steps[event.key]) {
            event.preventDefault();
            const step = steps[event.key]!;
            setPosition((old) => ({ x: old.x + step.x, y: old.y + step.y }));
          } else if (["+", "=", "-", "0"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "0") reset();
            else
              setScale((old) =>
                clamp(old * (event.key === "-" ? 1 / 1.25 : 1.25)),
              );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous || previous.id !== event.pointerId) return;
          setPosition((old) => ({
            x: old.x + event.clientX - previous.x,
            y: old.y + event.clientY - previous.y,
          }));
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div
          className="mermaid-viewer-transform"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
        >
          <DiagramSurface svg={svg} />
        </div>
      </div>
    </>
  );
}
export function MermaidDiagram({ svg }: { svg: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mermaid-preview"
          aria-label="放大查看 Mermaid 图表"
          title="点击放大查看"
        >
          {/* Only mount one SVG at a time, so generated marker IDs stay unique. */}
          {!open && <DiagramSurface svg={svg} />}
          <span className="mermaid-preview-hint">
            <Expand aria-hidden="true" />
            点击放大
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="mermaid-viewer">
        <DiagramStage svg={svg} />
      </DialogContent>
    </Dialog>
  );
}
