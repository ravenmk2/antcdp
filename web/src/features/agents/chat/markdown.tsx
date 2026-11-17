import {
  createElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { Download, WrapText } from "lucide-react";
import { useTheme } from "@/app/theme";
import { ChatCopyButton, ChatIconButton } from "./controls";

// Conversation rendering owns its DOM, spacing and streaming lifecycle. Parsing
// the token stream remains necessary for references and loose lists; unchanged
// top-level blocks never rebuild their DOM or reset their local controls.
const parser = new MarkdownIt({ html: false, linkify: true });
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
    const result: { key: number; html: string }[] = [];
    for (let start = 0; start < tokens.length;) {
      let end = start + 1;
      if (tokens[start].nesting === 1) {
        let depth = 1;
        while (end < tokens.length && depth) depth += tokens[end++].nesting;
      }
      result.push({
        key: tokens[start].map?.[0] ?? start,
        html: parser.renderer.render(
          tokens.slice(start, end),
          parser.options,
          env,
        ),
      });
      start = end;
    }
    return result;
  }, [source]);
  if (!source.trim()) return null;
  return (
    <div className="agent-markdown" aria-label="Markdown 正文">
      {blocks.map((block) => (
        <MarkdownBlock
          key={block.key}
          html={block.html}
          streaming={streaming}
        />
      ))}
    </div>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({
  html,
  streaming,
}: {
  html: string;
  streaming: boolean;
}) {
  const content = useMemo(() => {
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
      const attributes: Record<string, unknown> = { key };
      for (const attr of node.attributes) {
        if (!attr.name.startsWith("on"))
          attributes[
            (
              {
                class: "className",
                colspan: "colSpan",
                rowspan: "rowSpan",
              } as Record<string, string>
            )[attr.name] ?? attr.name
          ] = attr.value;
      }
      const children = [...node.childNodes]
        .filter(
          (child) =>
            !(
              ["table", "thead", "tbody", "tr"].includes(tag) &&
              child.nodeType === 3 &&
              !child.textContent?.trim()
            ),
        )
        .map(render);
      const element = createElement(tag, attributes, ...children);
      return tag === "table" ? (
        <div
          key={key}
          className="agent-markdown-table"
          role="region"
          aria-label="Markdown 表格"
          tabIndex={0}
        >
          {element}
        </div>
      ) : (
        element
      );
    }
    return [...dom.body.childNodes].map(render);
  }, [html, streaming]);
  return <div className="agent-markdown-block">{content}</div>;
});

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
  const { resolved } = useTheme();
  const [highlight, setHighlight] = useState<{
    source: string;
    language: string;
    theme: string;
    lines: string[];
  }>();
  const [graph, setGraph] = useState(false);
  const [diagram, setDiagram] = useState<{
    source: string;
    theme: string;
    svg?: string;
    error?: string;
  }>();
  const display = source.replace(/\n$/, "");
  useEffect(() => {
    if (streaming) return;
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
  }, [source, display, language, streaming, resolved]);
  useEffect(() => {
    if (!graph || streaming) return;
    let active = true;
    diagramQueue = diagramQueue
      .catch(() => {})
      .then(async () => {
        if (!active) return;
        try {
          const { default: mermaid } = await import("mermaid");
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: resolved === "dark" ? "dark" : "default",
            htmlLabels: false,
          });
          const result = await mermaid.render(
            `chat-diagram-${++diagramID}`,
            source,
          );
          const svg = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "image", "a"],
            FORBID_ATTR: ["href", "xlink:href"],
          });
          if (active) setDiagram({ source, theme: resolved, svg });
        } catch {
          if (active)
            setDiagram({
              source,
              theme: resolved,
              error: "图表语法无法解析，请查看源代码。",
            });
        }
      });
    return () => {
      active = false;
    };
  }, [source, streaming, graph, resolved]);
  const lines =
    !streaming &&
    highlight?.source === source &&
    highlight.language === language &&
    highlight.theme === resolved
      ? highlight.lines
      : undefined;
  const current =
    diagram?.source === source && diagram.theme === resolved
      ? diagram
      : undefined;
  return (
    <section className="agent-markdown-code">
      <div className="agent-markdown-code-heading">
        <span>{language}</span>
        <div>
          {language === "mermaid" && (
            <button
              type="button"
              disabled={streaming}
              onClick={() => setGraph(!graph)}
            >
              {graph ? "代码" : "图形"}
            </button>
          )}
          <ChatIconButton
            label="自动换行"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText />
          </ChatIconButton>
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
      {graph && !streaming ? (
        <div className="agent-markdown-diagram">
          {current?.svg ? (
            <img
              alt="Mermaid 图表"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(current.svg)}`}
            />
          ) : (
            <p role="status">{current?.error ?? "正在渲染图表…"}</p>
          )}
        </div>
      ) : (
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
      )}
    </section>
  );
}
let diagramQueue: Promise<unknown> = Promise.resolve();
let diagramID = 0;
