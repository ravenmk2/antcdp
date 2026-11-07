import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import DOMPurify from "dompurify";
import { Download, Expand, Maximize, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "@/app/theme";
import { Button, IconButton } from "./button";
import { CodeBlock } from "./code-block";
import { CopyButton } from "./copy-button";
import { ErrorNotice } from "./feedback";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

// Mermaid has global configuration: serialize rendering across documents/themes.
let renderQueue: Promise<unknown> = Promise.resolve();
let diagramSequence = 0;
export function normalizeDiagram(source: string) {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "image", "a"],
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.tagName !== "svg") throw new Error("无法读取图形尺寸");
  const box = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = box?.[2] ?? parseFloat(svg.getAttribute("width") || "");
  const height = box?.[3] ?? parseFloat(svg.getAttribute("height") || "");
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 100000))
    throw new Error("图形尺寸无效或过大");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("style");
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.endsWith("href") && !attribute.value.startsWith("#"))
        element.removeAttribute(attribute.name);
    }
  }
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}
type Diagram = ReturnType<typeof normalizeDiagram>;

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MermaidBlock({ source }: { source: string }) {
  const { resolved } = useTheme();
  const [graph, setGraph] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<{
    source: string;
    theme: string;
    diagram?: Diagram;
    error?: string;
  }>();
  const current =
    result?.source === source && result.theme === resolved ? result : undefined;
  useEffect(() => {
    if (!graph) return;
    let active = true;
    renderQueue = renderQueue
      .catch(() => {})
      .then(async () => {
        if (!active) return;
        try {
          const { default: mermaid } = await import("mermaid");
          if (!active) return;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: resolved === "dark" ? "dark" : "default",
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            fontFamily: "Microsoft YaHei UI, Segoe UI, sans-serif",
          });
          const rendered = await mermaid.render(
            `diagram-${++diagramSequence}`,
            source,
          );
          const diagram = normalizeDiagram(rendered.svg);
          if (active) setResult({ source, theme: resolved, diagram });
        } catch (error) {
          if (active)
            setResult({
              source,
              theme: resolved,
              error:
                error instanceof Error ? error.message : "图表语法无法解析",
            });
        }
      });
    return () => {
      active = false;
    };
  }, [graph, source, resolved]);
  const diagram = current?.diagram;
  const image = diagram
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`
    : "";
  return (
    <figure className="mermaid-block">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="mr-auto text-xs text-muted">Mermaid</span>
        <ToggleGroup
          type="single"
          value={graph ? "graph" : "code"}
          onValueChange={(value) => {
            if (value === "graph" || value === "code")
              setGraph(value === "graph");
          }}
          className="markdown-mode-switch"
          variant="default"
          spacing={1}
          aria-label="Mermaid 显示模式"
        >
          <ToggleGroupItem value="code">代码</ToggleGroupItem>
          <ToggleGroupItem value="graph">图形</ToggleGroupItem>
        </ToggleGroup>
        {graph && <CopyButton label="复制 Mermaid 源码" value={source} />}
        {graph && diagram && (
          <IconButton
            label="放大查看图表"
            size="iconSm"
            onClick={() => setExpanded(true)}
          >
            <Expand />
          </IconButton>
        )}
      </div>
      {!graph ? (
        <CodeBlock
          source={source}
          language="mermaid"
          className="m-0 border-0 rounded-none"
        />
      ) : current?.error ? (
        <div className="p-4">
          <ErrorNotice error={current.error} />
          <CodeBlock source={source} language="mermaid" />
        </div>
      ) : diagram ? (
        <button
          type="button"
          className="diagram-preview"
          aria-label="查看完整图表"
          onClick={() => setExpanded(true)}
        >
          <img src={image} alt="Mermaid 图表" draggable={false} />
        </button>
      ) : (
        <p className="p-5 text-sm text-muted" role="status">
          正在渲染图表…
        </p>
      )}
      {expanded && diagram && (
        <DiagramViewer
          diagram={diagram}
          image={image}
          onClose={() => setExpanded(false)}
        />
      )}
    </figure>
  );
}

function DiagramViewer({
  diagram,
  image,
  onClose,
}: {
  diagram: Diagram;
  image: string;
  onClose: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [returnFocus] = useState(() => document.activeElement);
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
    const element = viewport.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
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
  }, [fit, min]);
  async function downloadPNG() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const img = new Image();
      img.src = image;
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
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="diagram-viewer"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
              returnFocus.focus();
          }}
        >
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3">
            <Dialog.Title className="mr-auto font-medium">
              图表查看
            </Dialog.Title>
            <IconButton label="缩小" onClick={() => changeZoom(scale / 1.2)}>
              <ZoomOut />
            </IconButton>
            <span
              className="w-16 text-center text-xs tabular-nums"
              aria-live="polite"
            >
              {Math.round(scale * 100)}%
            </span>
            <IconButton label="放大" onClick={() => changeZoom(scale * 1.2)}>
              <ZoomIn />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
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
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              实际大小
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try {
                  downloadBlob(
                    new Blob([diagram.svg], { type: "image/svg+xml" }),
                    "diagram.svg",
                  );
                } catch (caught) {
                  setError(caught);
                }
              }}
            >
              <Download />
              SVG
            </Button>
            <Button
              variant="outline"
              size="sm"
              pending={downloading}
              onClick={() => void downloadPNG()}
            >
              PNG
            </Button>
            <Dialog.Close asChild>
              <IconButton label="关闭图表">
                <X />
              </IconButton>
            </Dialog.Close>
          </header>
          {error != null && (
            <div className="px-5 pt-3">
              <ErrorNotice error={error} />
            </div>
          )}
          <div
            ref={viewport}
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
              src={image}
              alt="完整 Mermaid 图表"
              draggable={false}
              style={{
                width: diagram.width,
                height: diagram.height,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              }}
            />
          </div>
          <p className="border-t px-5 py-2 text-xs text-muted">
            滚轮缩放 · 拖动平移 · Escape 关闭
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
