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
  const [wrapped, setWrapped] = useState(false),
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
        {source || <span className="agent-empty-output">内容为空</span>}
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
  args,
  value,
}: {
  name: string;
  args: JsonObject;
  value: JsonObject;
}) {
  if (typeof value.path !== "string") return null;
  if (name === "read_file" && typeof value.text === "string")
    return (
      <div className="space-y-3">
        <p className="break-all font-mono text-xs text-muted">{value.path}</p>
        <ToolCode source={value.text} title="读取内容" />
        <p className="text-xs text-muted">
          {typeof value.offset === "number" &&
          typeof value.next_offset === "number"
            ? `字节范围 ${value.offset}–${value.next_offset}`
            : ""}
          {typeof value.size_bytes === "string" &&
            ` · 文件共 ${value.size_bytes} 字节`}
          {value.has_more === true && " · 尚有未读取内容"}
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="break-all text-xs text-muted">
        <span className="font-mono">{value.path}</span>
        {typeof value.size_bytes === "string" && ` · ${value.size_bytes} 字节`}
      </p>
      {name === "write_file" && typeof args.content === "string" && (
        <ToolCode source={args.content} title="写入内容" />
      )}
      {name === "edit_file" &&
        typeof args.old_text === "string" &&
        typeof args.new_text === "string" && (
          <div className="space-y-3">
            <div className="border-l-2 border-destructive/40 pl-3">
              <ToolCode source={args.old_text} title="替换前片段" />
            </div>
            <div className="border-l-2 border-success/40 pl-3">
              <ToolCode source={args.new_text} title="替换后片段" />
            </div>
          </div>
        )}
    </div>
  );
}

export function fileResultSupported(
  name: string,
  args: JsonObject,
  value: JsonObject,
): boolean {
  if (typeof value.path !== "string") return false;
  if (name === "read_file") return typeof value.text === "string";
  if (name === "write_file") return typeof args.content === "string";
  return (
    name === "edit_file" &&
    typeof args.old_text === "string" &&
    typeof args.new_text === "string"
  );
}

export function ToolTextResult({ blocks }: { blocks: ContentBlock[] }) {
  return blocks.map((block, index) => {
    if (block.type !== "text") return null;
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
  if (
    name === "grep" &&
    Array.isArray(value.matches) &&
    value.matches.every(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        "path" in item &&
        typeof item.path === "string" &&
        "line" in item &&
        typeof item.line === "number" &&
        "text" in item &&
        typeof item.text === "string",
    )
  ) {
    const matches = value.matches as {
      path: string;
      line: number;
      text: string;
    }[];
    return {
      text: matches
        .map((item) => `${item.path}:${item.line}: ${item.text}`)
        .join("\n"),
      count: matches.length,
      truncated: value.truncated === true,
    };
  }
  return null;
}
