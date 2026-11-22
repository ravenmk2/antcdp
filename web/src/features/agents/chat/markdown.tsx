import {
  createElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import DOMPurify from "dompurify";
import { CodeXml, Download, Workflow, WrapText } from "lucide-react";
import { useTheme } from "@/app/theme";
import { DiagramViewer } from "@/components/diagram-viewer";
import {
  type MermaidDiagram,
  useMermaidDiagram,
} from "@/hooks/use-mermaid-diagram";
import {
  collectMarkdownTables,
  createMarkdownParser,
  markdownSourceLines,
} from "@/lib/markdown-document";
import { ChatCopyButton, ChatIconButton } from "./controls";

// Conversation rendering owns its DOM, spacing and streaming lifecycle. Parsing
// the token stream remains necessary for references and loose lists; unchanged
// top-level blocks never rebuild their DOM or reset their local controls.
const parser = createMarkdownParser();
parser.renderer.rules.image = (tokens, index) =>
  parser.utils.escapeHtml(tokens[index].content || "图片");
parser.renderer.rules.fence = parser.renderer.rules.code_block = (
  tokens,
  index,
) => {
  const token = tokens[index];
  return `<pre data-chat-code="${parser.utils.escapeHtml(token.info.trim().split(/\s+/)[0] || "text")}"><code>${parser.utils.escapeHtml(token.content)}</code></pre>`;
};

export function ChatMarkdown({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) {
  const blocks = useMemo(() => {
    const env = {};
    const tokens = parser.parse(source, env);
    const sourceLines = markdownSourceLines(source);
    const result: { key: number; html: string; tables: string[] }[] = [];
    for (let start = 0; start < tokens.length;) {
      let end = start + 1;
      if (tokens[start].nesting === 1) {
        let depth = 1;
        while (end < tokens.length && depth) depth += tokens[end++].nesting;
      }
      const blockTokens = tokens.slice(start, end);
      const tables = collectMarkdownTables(blockTokens, sourceLines);
      result.push({
        key: tokens[start].map?.[0] ?? start,
        html: parser.renderer.render(blockTokens, parser.options, env),
        tables,
      });
      start = end;
    }
    return result;
  }, [source]);
  if (!source.trim()) return null;
  return (
    <div className="agent-markdown" aria-label="Markdown 正文">
      {blocks.map(({ key, ...block }) => (
        <MarkdownBlock key={key} {...block} streaming={streaming} />
      ))}
    </div>
  );
}

type MarkdownBlockProps = {
  html: string;
  tables: readonly string[];
  streaming: boolean;
};

const attributeNames: Record<string, string> = {
  class: "className",
  colspan: "colSpan",
  rowspan: "rowSpan",
};

const MarkdownBlock = memo(
  function MarkdownBlock({ html, tables, streaming }: MarkdownBlockProps) {
    const clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["img", "iframe", "object", "embed"],
      FORBID_ATTR: ["style"],
    });
    const dom = new DOMParser().parseFromString(clean, "text/html");

    function render(node: Node, key: number): ReactNode {
      if (node.nodeType === 3) return node.textContent;
      if (!(node instanceof Element)) return null;
      const language = node.getAttribute("data-chat-code");
      if (language !== null)
        return (
          <ChatCode
            key={key}
            source={node.textContent ?? ""}
            language={language}
            streaming={streaming}
          />
        );

      const tag = node.tagName.toLowerCase();
      const attributes: Record<string, unknown> = {};
      for (const attr of node.attributes) {
        if (!attr.name.startsWith("on")) {
          attributes[attributeNames[attr.name] ?? attr.name] = attr.value;
        }
      }
      const tableStructure = ["table", "thead", "tbody", "tr"].includes(tag);
      const children = [...node.childNodes]
        .filter(
          (child) =>
            !(
              tableStructure &&
              child.nodeType === 3 &&
              !child.textContent?.trim()
            ),
        )
        .map(render);

      if (tag === "th" && !node.nextElementSibling) {
        const index = node
          .closest("table")
          ?.getAttribute("data-markdown-table");
        const source = index != null ? tables[Number(index)] : undefined;
        if (source !== undefined) {
          return (
            <th {...attributes} key={key}>
              <div className="agent-markdown-table-heading">
                <span>{children}</span>
                <ChatCopyButton value={source} label="复制表格 Markdown" />
              </div>
            </th>
          );
        }
      }
      if (tag === "table") {
        return (
          <div key={key} className="agent-markdown-table-frame">
            <div
              className="agent-markdown-table"
              role="region"
              aria-label="Markdown 表格"
              tabIndex={0}
            >
              <table {...attributes}>{children}</table>
            </div>
          </div>
        );
      }
      return createElement(tag, { ...attributes, key }, ...children);
    }

    return (
      <div className="agent-markdown-block">
        {[...dom.body.childNodes].map(render)}
      </div>
    );
  },
  (previous, next) =>
    previous.html === next.html &&
    previous.streaming === next.streaming &&
    previous.tables.length === next.tables.length &&
    previous.tables.every((source, index) => source === next.tables[index]),
);

function ChatCode({
  source,
  language,
  streaming,
}: {
  source: string;
  language: string;
  streaming: boolean;
}) {
  const [wrap, setWrap] = useState(false);
  const [viewCode, setViewCode] = useState(false);
  const [preview, setPreview] = useState<{
    diagram: MermaidDiagram;
    trigger: HTMLButtonElement;
  }>();
  const { resolved } = useTheme();
  const mermaid = language.toLowerCase() === "mermaid";
  const wantsGraph = mermaid && !streaming && !viewCode;
  const { result, retry } = useMermaidDiagram(source, resolved, wantsGraph);
  const diagram = result?.diagram;
  const graphError = wantsGraph && result?.error !== undefined;
  const showGraph = wantsGraph && !graphError;
  const [highlight, setHighlight] = useState<{
    source: string;
    language: string;
    theme: string;
    lines: string[];
  }>();
  const display = source.replace(/\n$/, "");
  const lines =
    !streaming &&
    highlight?.source === source &&
    highlight.language === language &&
    highlight.theme === resolved
      ? highlight.lines
      : undefined;
  useEffect(() => {
    if (streaming || showGraph || lines) return;
    let active = true;
    void import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(display, {
          lang: language,
          theme: resolved === "dark" ? "github-dark" : "github-light",
        }),
      )
      .then((html) => {
        if (!active) return;
        const document = new DOMParser().parseFromString(
          DOMPurify.sanitize(html),
          "text/html",
        );
        setHighlight({
          source,
          language,
          theme: resolved,
          lines: [...document.querySelectorAll(".line")].map(
            (line) => line.innerHTML,
          ),
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [source, display, language, streaming, resolved, showGraph, lines]);
  return (
    <section className="agent-markdown-code">
      <div className="agent-markdown-code-heading">
        <span>{language}</span>
        <div>
          {mermaid && (
            <ChatIconButton
              label={
                showGraph ? "查看代码" : graphError ? "重试图形" : "查看图形"
              }
              disabled={streaming}
              onClick={() => {
                if (result?.error !== undefined) retry();
                setViewCode(showGraph);
              }}
            >
              {showGraph ? <CodeXml /> : <Workflow />}
            </ChatIconButton>
          )}
          {!showGraph && (
            <ChatIconButton
              label="自动换行"
              aria-pressed={wrap}
              onClick={() => setWrap(!wrap)}
            >
              <WrapText />
            </ChatIconButton>
          )}
          <ChatIconButton
            label="下载代码"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([source], { type: "text/plain;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `code.${/^[a-z0-9]+$/i.test(language) ? language : "txt"}`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download />
          </ChatIconButton>
          <ChatCopyButton value={source} label="复制代码" />
        </div>
      </div>
      {showGraph ? (
        diagram ? (
          <button
            type="button"
            className="agent-markdown-diagram"
            aria-label="查看完整图表"
            onClick={(event) =>
              setPreview({ diagram, trigger: event.currentTarget })
            }
          >
            <img src={diagram.image} alt="Mermaid 图表" draggable={false} />
          </button>
        ) : (
          <p className="agent-markdown-diagram-status" role="status">
            正在渲染图表…
          </p>
        )
      ) : (
        <>
          {graphError && (
            <p className="agent-markdown-diagram-status" role="status">
              无法渲染 Mermaid 图表，已显示源码。
            </p>
          )}
          <pre data-wrapped={wrap}>
            <code>
              {display.split("\n").map((line, index) => (
                <span className="agent-markdown-code-line" key={index}>
                  {lines?.[index] ? (
                    <span dangerouslySetInnerHTML={{ __html: lines[index] }} />
                  ) : (
                    line || "\n"
                  )}
                </span>
              ))}
            </code>
          </pre>
        </>
      )}
      {preview && (
        <DiagramViewer
          diagram={preview.diagram}
          returnFocus={preview.trigger}
          onClose={() => setPreview(undefined)}
        />
      )}
    </section>
  );
}
