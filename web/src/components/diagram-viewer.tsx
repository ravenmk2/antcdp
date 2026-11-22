import { Dialog } from "@base-ui/react/dialog";
import {
  ChevronDown,
  Download,
  LoaderCircle,
  Maximize,
  Ruler,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePortalContainer } from "@/components/platform/surface-context";
import type { MermaidDiagram } from "@/hooks/use-mermaid-diagram";
import { Button, IconButton } from "./button";
import { ErrorNotice } from "./feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DiagramViewer({
  diagram,
  onClose,
  returnFocus,
}: {
  diagram: MermaidDiagram;
  onClose: () => void;
  returnFocus: HTMLElement;
}) {
  const portalContainer = usePortalContainer();
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const fit = Math.min(
    1,
    Math.max(0.001, (size.width - 48) / diagram.width),
    Math.max(0.001, (size.height - 48) / diagram.height),
  );
  const scale = zoom ?? fit;
  const min = Math.min(fit / 4, 0.1);
  function changeZoom(next: number) {
    setZoom(Math.min(8, Math.max(min, next)));
  }
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) =>
        Math.min(
          8,
          Math.max(min, (value ?? fit) * Math.exp(-event.deltaY * 0.001)),
        ),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [viewport, fit, min]);
  function downloadSVG() {
    setError(null);
    try {
      downloadBlob(
        new Blob([diagram.svg], { type: "image/svg+xml" }),
        "diagram.svg",
      );
    } catch (caught) {
      setError(caught);
    }
  }
  async function downloadPNG() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const img = new Image();
      img.src = diagram.image;
      await img.decode();
      const ratio = Math.min(2, 4096 / Math.max(diagram.width, diagram.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(diagram.width * ratio));
      canvas.height = Math.max(1, Math.round(diagram.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器无法导出 PNG，请下载 SVG");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("PNG 导出失败，请重试或下载 SVG");
      downloadBlob(blob, "diagram.png");
    } catch (caught) {
      setError(caught);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Popup
          className="diagram-viewer"
          aria-describedby={undefined}
          finalFocus={() => (returnFocus.isConnected ? returnFocus : true)}
        >
          <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-b-border-subtle px-3 py-2 sm:px-5 sm:py-3">
            <Dialog.Title className="mr-auto font-medium">
              图表查看
            </Dialog.Title>
            <div className="order-last flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:order-none sm:w-auto">
              <div className="flex items-center gap-0.5">
                <IconButton
                  label="缩小"
                  size="iconSm"
                  onClick={() => changeZoom(scale / 1.2)}
                >
                  <ZoomOut />
                </IconButton>
                <span
                  className="w-12 text-center text-xs tabular-nums"
                  aria-live="polite"
                >
                  {Math.round(scale * 100)}%
                </span>
                <IconButton
                  label="放大"
                  size="iconSm"
                  onClick={() => changeZoom(scale * 1.2)}
                >
                  <ZoomIn />
                </IconButton>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() => {
                    setZoom(null);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <Maximize />
                  适应窗口
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <Ruler />
                  实际大小
                </Button>
              </div>
              <div className="inline-flex items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-e-none focus-visible:z-10"
                  aria-label="下载 SVG"
                  onClick={downloadSVG}
                >
                  <Download />
                  SVG
                </Button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger
                    render={
                      <IconButton
                        label="选择下载格式"
                        size="iconSm"
                        variant="outline"
                        className="rounded-s-none border-s-0 focus-visible:z-10"
                        aria-busy={downloading || undefined}
                      >
                        {downloading ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <ChevronDown />
                        )}
                      </IconButton>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={downloadSVG}>
                      SVG
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={downloading}
                      onClick={() => void downloadPNG()}
                    >
                      PNG
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <Dialog.Close
              render={
                <IconButton label="关闭图表" size="iconSm">
                  <X />
                </IconButton>
              }
            />
          </header>
          {error != null && (
            <div className="px-5 pt-3">
              <ErrorNotice error={error} />
            </div>
          )}
          <div
            ref={setViewport}
            className="diagram-viewport"
            tabIndex={0}
            aria-label="图表画布，方向键移动，加减键缩放，Home 适应窗口"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                px: pan.x,
                py: pan.y,
              };
            }}
            onPointerMove={(event) => {
              if (drag.current)
                setPan({
                  x: drag.current.px + event.clientX - drag.current.x,
                  y: drag.current.py + event.clientY - drag.current.y,
                });
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
            onKeyDown={(event) => {
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [30, 0],
                ArrowRight: [-30, 0],
                ArrowUp: [0, 30],
                ArrowDown: [0, -30],
              };
              const move = moves[event.key];
              if (move) {
                event.preventDefault();
                setPan((p) => ({ x: p.x + move[0], y: p.y + move[1] }));
              } else if (["+", "=", "-", "Home"].includes(event.key)) {
                event.preventDefault();
                if (event.key === "Home") {
                  setZoom(null);
                  setPan({ x: 0, y: 0 });
                } else changeZoom(scale * (event.key === "-" ? 1 / 1.2 : 1.2));
              }
            }}
          >
            <img
              src={diagram.image}
              alt="完整 Mermaid 图表"
              draggable={false}
              style={{
                width: diagram.width,
                height: diagram.height,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              }}
            />
          </div>
          <p className="border-t border-t-border-subtle px-5 py-2 text-xs text-muted">
            滚轮缩放 · 拖动平移 · Escape 关闭
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
