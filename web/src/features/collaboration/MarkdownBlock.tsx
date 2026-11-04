import { useEffect, useRef, useState } from "react";
import { Check, Copy, AlertCircle } from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import { copyText } from "@/components/platform/copy-button";

export type RichBlock = {
  kind: "code" | "table";
  source: string;
  language?: string;
};
function CopyIcon({ source, label }: { source: string; label: string }) {
  const [status, setStatus] = useState<
    "idle" | "pending" | "copied" | "failed"
  >("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="markdown-copy-icon"
        data-copy-state={status}
        title={status === "copied" ? "已复制" : label}
        aria-label={label}
        aria-busy={status === "pending"}
        onClick={async (event) => {
          if (locked.current) return;
          locked.current = true;
          clearTimeout(timer.current);
          setStatus("pending");
          try {
            await copyText(source, event.currentTarget, event.detail === 0);
            if (alive.current) {
              setStatus("copied");
              timer.current = setTimeout(() => setStatus("idle"), 2000);
            }
          } catch {
            if (alive.current) setStatus("failed");
          } finally {
            locked.current = false;
          }
        }}
      >
        {status === "copied" ? (
          <Check aria-hidden="true" />
        ) : status === "failed" ? (
          <AlertCircle aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </button>
      <span
        role="status"
        className={status === "failed" ? "markdown-copy-error" : "sr-only"}
      >
        {status === "failed"
          ? "复制失败，请手动复制。"
          : status === "copied"
            ? "已复制。"
            : ""}
      </span>
    </>
  );
}
export function MarkdownBlock({ block }: { block: RichBlock }) {
  const [highlighted, setHighlighted] = useState("");
  const [diagram, setDiagram] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("diagram");
  const isDiagram =
    block.kind === "code" && block.language?.toLowerCase() === "mermaid";
  useEffect(() => {
    let current = true;
    if (block.kind === "code") {
      void import("./markdown-highlight")
        .then((m) => m.highlight(block.source, block.language || ""))
        .then((html) => {
          if (current) setHighlighted(html);
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, [block]);
  useEffect(() => {
    if (!isDiagram) return;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    const render = () => {
      const ticket = ++generation;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void import("./markdown-mermaid")
          .then((m) =>
            m.renderDiagram(
              block.source,
              document.documentElement.classList.contains("dark"),
            ),
          )
          .then((svg) => {
            if (ticket === generation) {
              setDiagram(svg);
              setError("");
            }
          })
          .catch(() => {
            if (ticket === generation) {
              setDiagram("");
              setError(
                "图表无法渲染，请检查 Mermaid 语法；源码和其他正文仍可使用。",
              );
            }
          });
      }, 300);
    };
    render();
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      ++generation;
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [block, isDiagram]);
  if (block.kind === "table")
    return <CopyIcon source={block.source} label="复制表格 Markdown" />;
  const code = highlighted ? (
    <div
      className="markdown-highlighted"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  ) : (
    <pre tabIndex={0} aria-label="代码内容">
      <code>{block.source}</code>
    </pre>
  );
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{block.language}</span>
        {isDiagram && (
          <div
            role="group"
            aria-label="Mermaid 显示模式"
            className="markdown-diagram-modes"
          >
            <button
              type="button"
              aria-pressed={mode === "diagram"}
              onClick={() => setMode("diagram")}
            >
              图形
            </button>
            <button
              type="button"
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              源码
            </button>
          </div>
        )}
        <CopyIcon
          source={block.source}
          label={isDiagram ? "复制 Mermaid 源码" : "复制代码"}
        />
      </div>
      {isDiagram && mode === "diagram" ? (
        <>
          {error ? (
            <p role="alert" className="markdown-diagram-error">
              {error}
            </p>
          ) : diagram ? (
            <MermaidDiagram svg={diagram} />
          ) : (
            <p role="status" className="markdown-diagram-error">
              正在渲染图表…
            </p>
          )}
          {error && code}
        </>
      ) : (
        code
      )}
    </div>
  );
}
