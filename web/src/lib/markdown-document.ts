import MarkdownIt from "markdown-it";

export interface DocumentHeading {
  id: string;
  title: string;
  level: number;
  line: number;
}
export interface DocumentCode {
  title?: string;
  highlightedLines: number[];
  source: string;
  language: string;
}

export function parseMarkdown(source: string) {
  const renderer = new MarkdownIt({ html: false, linkify: true });
  const headings: DocumentHeading[] = [];
  const blocks: DocumentCode[] = [];
  const tables: string[] = [];
  const sourceLines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  const used = new Set<string>();
  const tokens = renderer.parse(source, {});
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "table_open" && token.map) {
      token.attrSet("data-markdown-table", String(tables.length));
      tables.push(sourceLines.slice(token.map[0], token.map[1]).join(""));
    }
    if (token.map && token.nesting !== -1)
      token.attrSet("data-source-line", String(token.map[0] + 1));
    if (token.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    const title =
      inline?.children
        ?.map((child) =>
          ["text", "code_inline", "image"].includes(child.type)
            ? child.content
            : child.type === "softbreak"
              ? " "
              : "",
        )
        .join("") ||
      inline?.content ||
      "章节";
    const slug =
      title
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
    const base = `md-${slug}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    token.attrSet("id", id);
    token.attrSet("tabindex", "-1");
    headings.push({
      id,
      title,
      level: Number(token.tag.slice(1)),
      line: (token.map?.[0] ?? 0) + 1,
    });
  }
  for (const token of tokens) {
    for (const child of token.children ?? []) {
      if (child.type !== "link_open") continue;
      const href = child.attrGet("href");
      if (typeof href === "string" && href.startsWith("#")) {
        try {
          const target = decodeURIComponent(href.slice(1));
          if (used.has(`md-${target}`)) child.attrSet("href", `#md-${target}`);
        } catch {
          /* Invalid fragments remain ordinary links. */
        }
      }
    }
  }
  const code: typeof renderer.renderer.rules.fence = (items, index) => {
    const token = items[index];
    const id = blocks.length;
    const title = token.info.match(/(?:title|filename)="([^"]+)"/)?.[1];
    const ranges = (token.info.match(/\{([\d, -]+)\}/)?.[1] || "")
      .split(",")
      .map((range) => range.trim().split("-").map(Number));
    const highlightedLines = token.content
      .replace(/\n$/, "")
      .split("\n")
      .flatMap((_, line) =>
        ranges.some(
          ([first, last = first]) => line + 1 >= first && line + 1 <= last,
        )
          ? [line + 1]
          : [],
      );
    blocks.push({
      title,
      highlightedLines,
      source: token.content,
      language: token.info.trim().split(/\s+/)[0]?.toLowerCase() || "text",
    });
    return `<div data-markdown-block="${id}" data-source-line="${(token.map?.[0] ?? 0) + 1}"></div>\n`;
  };
  renderer.renderer.rules.fence = code;
  renderer.renderer.rules.code_block = code;
  renderer.renderer.rules.image = (items, index) =>
    renderer.utils.escapeHtml(items[index].content || "图片");
  return {
    headings,
    blocks,
    tables,
    html: renderer.renderer.render(tokens, renderer.options, {}),
  };
}
