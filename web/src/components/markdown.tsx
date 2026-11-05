import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { Check, Code2, Copy, Download, ZoomIn, ZoomOut } from "lucide-react";
import { Button, IconButton } from "./button";
import { ErrorNotice } from "./feedback";
import { Modal } from "./overlays";
import { CopyButton } from "./copy-button";
import { useTheme } from "@/app/theme";

const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});
renderer.renderer.rules.image = (tokens, index) =>
  renderer.utils.escapeHtml(tokens[index]?.content ?? "图片");

export function MarkdownView({ source }: { source: string }) {
  const parts = useMemo(() => splitBlocks(source), [source]);
  if (!source.trim())
    return <p className="text-sm text-muted">暂无介绍内容。</p>;
  return (
    <div className="markdown">
      {parts.map((part, index) =>
        part.kind === "mermaid" ? (
          <MermaidBlock key={index} source={part.value} />
        ) : part.kind === "code" ? (
          <CodeBlock
            key={index}
            source={part.value}
            language={part.language ?? "text"}
          />
        ) : (
          <div
            key={index}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(renderer.render(part.value), {
                USE_PROFILES: { html: true },
                FORBID_TAGS: ["img", "iframe", "object", "embed"],
                FORBID_ATTR: ["style"],
              }),
            }}
          />
        ),
      )}
    </div>
  );
}

type Block = {
  kind: "markdown" | "mermaid" | "code";
  value: string;
  language?: string;
};
function splitBlocks(source: string): Block[] {
  const parts: Block[] = [];
  const pattern = /```([^\n]*)\s*\n([\s\S]*?)```/g;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index;
    if (index > offset)
      parts.push({ kind: "markdown", value: source.slice(offset, index) });
    const language = (match[1] ?? "").trim().toLowerCase();
    parts.push({
      kind: language === "mermaid" ? "mermaid" : "code",
      value: match[2] ?? "",
      language,
    });
    offset = index + match[0].length;
  }
  if (offset < source.length)
    parts.push({ kind: "markdown", value: source.slice(offset) });
  return parts;
}

function CodeBlock({ source, language }: { source: string; language: string }) {
  const { resolved } = useTheme();
  const [html, setHtml] = useState("");
  useEffect(() => {
    let active = true;
    void import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(source, {
          lang: language || "text",
          theme: resolved === "dark" ? "github-dark" : "github-light",
        }),
      )
      .then((value) => {
        if (active) setHtml(DOMPurify.sanitize(value));
      })
      .catch(() => {
        if (active) setHtml("");
      });
    return () => {
      active = false;
    };
  }, [source, language, resolved]);
  return (
    <figure className="my-4 overflow-hidden rounded-lg border">
      <figcaption className="flex items-center justify-between border-b bg-surface-subtle px-3 py-1 text-xs text-muted">
        <span>{language || "text"}</span>
        <CopyButton value={source} label="复制代码" />
      </figcaption>
      {html ? (
        <div
          className="overflow-auto text-xs [&_pre]:p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-auto p-4 text-xs">
          <code>{source}</code>
        </pre>
      )}
    </figure>
  );
}

function MermaidBlock({ source }: { source: string }) {
  const { resolved } = useTheme();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [code, setCode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    setError("");
    setSvg("");
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          darkMode: resolved === "dark",
          themeVariables: {
            fontFamily:
              "Microsoft YaHei UI, Microsoft YaHei, Segoe UI, sans-serif",
            primaryColor: resolved === "dark" ? "#1d334f" : "#eaf1ff",
            primaryTextColor: resolved === "dark" ? "#e7edf5" : "#17202c",
            primaryBorderColor: resolved === "dark" ? "#93c5fd" : "#2563eb",
            lineColor: resolved === "dark" ? "#94a5b9" : "#637286",
          },
        });
        const result = await mermaid.render(
          `diagram-${crypto.randomUUID().replaceAll("-", "")}`,
          source,
        );
        if (active)
          setSvg(
            DOMPurify.sanitize(result.svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
            }),
          );
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "图表语法无法解析",
          );
      });
    return () => {
      active = false;
    };
  }, [source, resolved]);
  return (
    <figure className="my-4 overflow-hidden rounded-lg border bg-surface-subtle">
      <div className="flex items-center justify-end gap-1 border-b px-2 py-1">
        <Button size="sm" variant="ghost" onClick={() => setCode(!code)}>
          <Code2 />
          {code ? "查看图表" : "查看源码"}
        </Button>
        <IconButton
          size="iconSm"
          label="复制 Mermaid 源码"
          onClick={() => void navigator.clipboard.writeText(source)}
        >
          <Copy />
        </IconButton>
        {!code && (
          <IconButton
            size="iconSm"
            label="放大查看图表"
            onClick={() => setExpanded(true)}
          >
            <ZoomIn />
          </IconButton>
        )}
      </div>
      {code ? (
        <pre className="overflow-auto p-4 text-xs">
          <code>{source}</code>
        </pre>
      ) : error ? (
        <div className="p-4">
          <ErrorNotice error={error} />
          <pre className="mt-2 text-xs">
            <code>{source}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          className="grid max-h-[480px] place-items-center overflow-auto p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="p-5 text-sm text-muted">正在渲染图表…</p>
      )}
      <Modal
        open={expanded}
        wide
        title="图表查看"
        onClose={() => {
          setExpanded(false);
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
        footer={
          <>
            <IconButton
              label="缩小"
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
            >
              <ZoomOut />
            </IconButton>
            <IconButton
              label="放大"
              onClick={() => setZoom((value) => Math.min(3, value + 0.1))}
            >
              <ZoomIn />
            </IconButton>
            <Button
              variant="outline"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              复位
            </Button>
          </>
        }
      >
        <div className="overflow-auto">
          <div
            tabIndex={0}
            aria-label="图表平移区域，可拖动、滚轮缩放或使用方向键"
            className="cursor-move touch-none focus:outline-offset-4"
            onPointerDown={(event) => {
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
            onWheel={(event) => {
              event.preventDefault();
              setZoom((value) =>
                Math.min(3, Math.max(0.5, value - event.deltaY * 0.001)),
              );
            }}
            onKeyDown={(event) => {
              const delta =
                event.key === "ArrowLeft"
                  ? { x: 20, y: 0 }
                  : event.key === "ArrowRight"
                    ? { x: -20, y: 0 }
                    : event.key === "ArrowUp"
                      ? { x: 0, y: 20 }
                      : event.key === "ArrowDown"
                        ? { x: 0, y: -20 }
                        : null;
              if (delta) {
                event.preventDefault();
                setPan((current) => ({
                  x: current.x + delta.x,
                  y: current.y + delta.y,
                }));
              }
            }}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </Modal>
    </figure>
  );
}

export function MarkdownEditor({
  initial,
  onChange,
  onDirty,
}: {
  initial: string;
  onChange: (value: string) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const dirty = useRef(false);
  const [mode, setMode] = useState<"edit" | "preview" | "split">("edit");
  const [source, setSource] = useState(initial);
  const initialRef = useRef(initial);
  const callbacks = useRef({ onChange, onDirty });
  callbacks.current = { onChange, onDirty };
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const value = update.state.doc.toString();
            dirty.current = value !== initialRef.current;
            setSource(value);
            callbacks.current.onChange(value);
            callbacks.current.onDirty?.(dirty.current);
          }),
          EditorView.theme({
            "&": {
              minHeight: "320px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              background: "var(--surface)",
              color: "var(--text)",
            },
            ".cm-content": {
              padding: "14px",
              fontFamily: "Cascadia Code, Consolas, monospace",
              fontSize: "13px",
            },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border bg-surface-subtle p-1">
        {(["edit", "preview", "split"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {value === "edit" ? "编辑" : value === "preview" ? "预览" : "分栏"}
          </Button>
        ))}
        <span className="ml-auto px-2 text-xs text-muted">
          {new TextEncoder().encode(source).length.toLocaleString()} / 102400
          字节
        </span>
      </div>
      <div className={mode === "split" ? "grid gap-4 xl:grid-cols-2" : "grid"}>
        <div ref={host} className={mode === "preview" ? "hidden" : "min-w-0"} />
        {mode !== "edit" && (
          <div className="min-w-0 rounded-lg border p-5">
            <MarkdownView source={source} />
          </div>
        )}
      </div>
    </div>
  );
}

export function MarkdownActions({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(source);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}复制 Markdown
    </Button>
  );
}

export function DownloadLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      className="button inline-flex items-center gap-2 text-link"
      href={href}
      download
    >
      <Download className="size-4" />
      {children}
    </a>
  );
}
