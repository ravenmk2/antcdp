import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MarkdownBlock, type RichBlock } from "./MarkdownBlock";
import MarkdownIt, { type Env } from "markdown-it";
import { copyText } from "@/components/platform/copy-button";
import "./markdown.css";

const renderer = new MarkdownIt({ html: false, linkify: false, breaks: true });
renderer.disable("image");
const validateLink = renderer.validateLink.bind(renderer);
renderer.validateLink = (url) =>
  validateLink(url) && !/^(?:javascript|vbscript|file|data):/i.test(url.trim());

const codeBlock = (content: string, language: string) =>
  `<div class="markdown-code-block"><div class="markdown-code-toolbar"><span>${renderer.utils.escapeHtml(language)}</span><button type="button" data-code-copy aria-label="复制代码">复制代码</button></div><pre tabindex="0" aria-label="代码内容"><code>${renderer.utils.escapeHtml(content)}</code></pre></div>`;
type RenderEnvironment = Env & {
  enhanced?: boolean;
  blocks?: RichBlock[];
  source?: string;
};
function slot(env: RenderEnvironment, block: RichBlock) {
  const index = env.blocks!.push(block) - 1;
  const tag = block.kind === "code" ? "div" : "span";
  return `<${tag} data-md-slot="${index}"></${tag}>`;
}
renderer.renderer.rules.fence = (
  tokens,
  index,
  _options,
  env: RenderEnvironment = {},
) => {
  const token = tokens[index]!;
  const language = token.info.trim().split(/\s+/)[0] || "代码";
  return env.enhanced
    ? `<div class="markdown-rich-block">${slot(env, { kind: "code", source: token.content, language })}</div>`
    : codeBlock(token.content, language);
};
renderer.renderer.rules.code_block = (
  tokens,
  index,
  _options,
  env: RenderEnvironment = {},
) =>
  env.enhanced
    ? `<div class="markdown-rich-block">${slot(env, { kind: "code", source: tokens[index]!.content, language: "代码" })}</div>`
    : codeBlock(tokens[index]!.content, "代码");
renderer.renderer.rules.table_open = (
  tokens,
  index,
  options,
  env: RenderEnvironment = {},
  self,
) => {
  tokens[index]!.attrSet("tabindex", "0");
  tokens[index]!.attrSet("aria-label", "Markdown 表格");
  const table = self.renderToken(tokens, index, options);
  if (!env.enhanced) return table;
  const range = tokens[index]!.map!;
  const source = env.source!.split("\n").slice(range[0], range[1]).join("\n");
  return `<div class="markdown-table-block">${slot(env, { kind: "table", source })}<div class="markdown-table-scroll">${table}`;
};
renderer.renderer.rules.table_close = (
  _tokens,
  _index,
  _options,
  env: RenderEnvironment = {},
) => (env.enhanced ? "</table></div></div>" : "</table>");

export interface DescriptionHeading {
  id: string;
  level: number;
  text: string;
}
export interface RenderedDescription {
  html: string;
  blocks?: RichBlock[];
  headings: DescriptionHeading[];
}

export function parseDescription(
  text: string,
  anchorPrefix = "description",
  enhanced = false,
): RenderedDescription {
  const tokens = renderer.parse(text, {});
  const headings: DescriptionHeading[] = [];
  const counts = new Map<string, number>();
  const used = new Set<string>();
  const prefix = anchorPrefix.replace(/[^A-Za-z0-9_-]/g, "-") || "description";
  tokens.forEach((token, index) => {
    if (token.type !== "heading_open") return;
    const inline = tokens[index + 1];
    const title =
      inline?.children
        ?.filter((child) =>
          ["text", "code_inline", "softbreak", "hardbreak"].includes(
            child.type,
          ),
        )
        .map((child) => (child.type.endsWith("break") ? " " : child.content))
        .join("") ||
      inline?.content ||
      "章节";
    const slug =
      title
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
    let count = (counts.get(slug) || 0) + 1;
    let id = `${prefix}-${slug}${count > 1 ? `-${count}` : ""}`;
    while (used.has(id)) {
      count += 1;
      id = `${prefix}-${slug}-${count}`;
    }
    counts.set(slug, count);
    used.add(id);
    token.attrSet("id", id);
    token.attrSet("tabindex", "-1");
    headings.push({ id, level: Number(token.tag.slice(1)), text: title });
  });
  const blocks: RichBlock[] = [];
  return {
    blocks,
    html: renderer.renderer.render(tokens, renderer.options, {
      enhanced,
      blocks,
      source: text,
    }),
    headings,
  };
}

export const renderDescription = (text: string) => parseDescription(text).html;

export function Markdown({
  text,
  anchorPrefix,
  rendered,
  enhanced = false,
}: {
  text: string;
  anchorPrefix?: string;
  rendered?: RenderedDescription;
  enhanced?: boolean;
}) {
  const instance = useId();
  const prefix = anchorPrefix || `description-${instance}`;
  const parsed = useMemo(
    () => rendered || parseDescription(text, prefix, enhanced),
    [text, prefix, rendered, enhanced],
  );
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (node)
        setTargets(
          Array.from(
            node.querySelectorAll<HTMLElement>("[data-md-slot]"),
          ).slice(0, parsed.blocks?.length || 0),
        );
    },
    [parsed],
  );
  const [copyStatus, setCopyStatus] = useState("");
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    alive.current = true;
    const active = timers.current;
    return () => {
      alive.current = false;
      active.forEach(clearTimeout);
    };
  }, []);
  return (
    <>
      <div
        ref={attach}
        className="markdown-document"
        onClick={(event) => {
          const button = (event.target as Element).closest<HTMLButtonElement>(
            "[data-code-copy]",
          );
          if (!button || !event.currentTarget.contains(button)) return;
          const code = button
            .closest(".markdown-code-block")
            ?.querySelector("code");
          if (!code || button.dataset.copyPending) return;
          button.dataset.copyPending = "true";
          button.setAttribute("aria-busy", "true");
          void copyText(code.textContent || "", button, event.detail === 0)
            .then(() => {
              button.textContent = "已复制";
              if (alive.current) setCopyStatus("代码已复制。");
            })
            .catch(() => {
              button.textContent = "复制失败，请手动复制";
              if (alive.current)
                setCopyStatus("复制失败，请手动选择代码复制。");
            })
            .finally(() => {
              delete button.dataset.copyPending;
              button.removeAttribute("aria-busy");
              if (!alive.current) return;
              const timer = setTimeout(() => {
                if (button.isConnected) button.textContent = "复制代码";
                timers.current.delete(timer);
              }, 2500);
              timers.current.add(timer);
            });
        }}
        dangerouslySetInnerHTML={{ __html: parsed.html }}
      />
      {parsed.blocks?.map(
        (block, index) =>
          targets[index] &&
          createPortal(
            <MarkdownBlock key={`${index}:${block.source}`} block={block} />,
            targets[index]!,
          ),
      )}
      {copyStatus && (
        <span role="status" className="sr-only">
          {copyStatus}
        </span>
      )}
    </>
  );
}
