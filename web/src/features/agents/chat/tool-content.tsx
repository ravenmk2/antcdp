import { useLayoutEffect, useRef, useState } from "react";
import { WrapText } from "lucide-react";
import { ChatCopyButton, ChatIconButton } from "./controls";
import type { ContentBlock } from "@/types/agents";
import type { JsonObject } from "@/types/models";

export function ToolCode({
  source,
  title,
  language = "text",
}: {
  source: string;
  title: string;
  language?: string;
}) {
  const [wrapped, setWrapped] = useState(true),
    [expanded, setExpanded] = useState(false),
    [overflowing, setOverflowing] = useState(false);
  const body = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [source, wrapped, expanded]);
  return (
    <section className="agent-tool-code">
      <div className="agent-tool-code-heading">
        <span>{title}</span>
        <div>
          <ChatIconButton
            label={`${title}自动换行`}
            aria-pressed={wrapped}
            onClick={() => setWrapped(!wrapped)}
          >
            <WrapText />
          </ChatIconButton>
          <ChatCopyButton value={source} label={`复制${title}`} />
        </div>
      </div>
      <pre
        ref={body}
        aria-label={title}
        data-mono={language !== "text"}
        data-wrapped={wrapped}
        data-expanded={expanded}
      >
        {language === "diff" && source
          ? source
              .replace(/\n$/, "")
              .split("\n")
              .map((line, index) => {
                const marker =
                  source.startsWith("--- ") &&
                  (index === 0 || (index === 1 && line.startsWith("+++ ")))
                    ? "font-semibold text-muted"
                    : line.startsWith("@@")
                      ? "bg-primary/10 text-primary"
                      : line.startsWith("+")
                        ? "bg-success/15 text-success"
                        : line.startsWith("-")
                          ? "bg-destructive/15 text-destructive"
                          : "";
                return (
                  <span
                    key={index}
                    className={`block min-h-[1lh] px-1 ${marker}`}
                  >
                    {line}
                  </span>
                );
              })
          : source || <span className="agent-empty-output">内容为空</span>}
      </pre>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="agent-tool-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      )}
    </section>
  );
}

export function readToolObject(blocks: ContentBlock[]): JsonObject | null {
  if (blocks.length !== 1 || blocks[0].type !== "text") return null;
  try {
    const value: unknown = JSON.parse(blocks[0].text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
}

// Only built-in, complete, successful results reach this renderer. Unknown
// schemas keep their raw output so protocol changes cannot silently hide data.
export function FileToolResult({
  name,
  value,
}: {
  name: string;
  value: JsonObject;
}) {
  const read = name === "read";
  const source = String(read ? value.text : value.diff);
  return (
    <div className="space-y-3">
      <p className="break-all font-mono text-xs text-muted">
        {String(value.path)}
      </p>
      {read || source ? (
        <ToolCode
          source={source}
          title={read ? "读取内容" : "文件差异"}
          language={read ? "text" : "diff"}
        />
      ) : (
        <p className="text-xs text-muted">无文本差异</p>
      )}
      {read && value.has_more === true && (
        <p className="text-xs text-muted">尚有未读取内容</p>
      )}
    </div>
  );
}

export function fileResultSupported(name: string, value: JsonObject): boolean {
  return (
    typeof value.path === "string" &&
    ((name === "read" && typeof value.text === "string") ||
      (name === "edit" && typeof value.diff === "string"))
  );
}

export function writeDiffFromContent(content: unknown): string {
  if (typeof content !== "string" || content === "") return "";
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => `+${line}\n`)
    .join("");
}

export function ToolTextResult({
  blocks,
  preserveSource = false,
}: {
  blocks: ContentBlock[];
  preserveSource?: boolean;
}) {
  return blocks.map((block, index) => {
    if (block.type !== "text") return null;
    if (preserveSource) {
      return (
        <ToolCode
          key={index}
          source={block.text}
          title="返回内容"
          language="json"
        />
      );
    }
    let source = block.text;
    let language = "text";
    try {
      const value: unknown = JSON.parse(source);
      if (value !== null && typeof value === "object") {
        source = JSON.stringify(value, null, 2);
        language = "json";
      }
    } catch {
      /* Keep plain output literal, never interpret it as Markdown. */
    }
    return (
      <ToolCode
        key={index}
        source={source}
        title="返回内容"
        language={language}
      />
    );
  });
}

export function readSearchResult(
  name: string,
  value: JsonObject,
): { text: string; count: number; truncated: boolean } | null {
  if (
    name === "glob" &&
    Array.isArray(value.paths) &&
    value.paths.every((path: unknown) => typeof path === "string")
  )
    return {
      text: value.paths.join("\n"),
      count: value.paths.length,
      truncated: value.truncated === true,
    };
  if (name === "grep" && Array.isArray(value.groups)) {
    const sections: string[] = [];
    let count = 0;
    for (const group of value.groups) {
      if (
        !group ||
        typeof group !== "object" ||
        Array.isArray(group) ||
        typeof group.path !== "string" ||
        !Array.isArray(group.lines)
      )
        return null;
      const lines: string[] = [group.path];
      for (const hit of group.lines) {
        if (
          !hit ||
          typeof hit !== "object" ||
          Array.isArray(hit) ||
          typeof hit.line !== "number" ||
          typeof hit.text !== "string"
        )
          return null;
        lines.push(`  ${hit.line}: ${hit.text}`);
        count++;
      }
      sections.push(lines.join("\n"));
    }
    return {
      text: sections.join("\n\n"),
      count,
      truncated: value.truncated === true,
    };
  }
  return null;
}
