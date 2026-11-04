import { useEffect, useId, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { copyText } from "@/components/platform/copy-button";
import "./markdown.css";

const renderer = new MarkdownIt({ html: false, linkify: false, breaks: true });
renderer.disable("image");
const validateLink = renderer.validateLink.bind(renderer);
renderer.validateLink = (url) =>
  validateLink(url) && !/^(?:javascript|vbscript|file|data):/i.test(url.trim());

const codeBlock = (content: string, language: string) =>
  `<div class="markdown-code-block"><div class="markdown-code-toolbar"><span>${renderer.utils.escapeHtml(language)}</span><button type="button" data-code-copy aria-label="复制代码">复制代码</button></div><pre tabindex="0" aria-label="代码内容"><code>${renderer.utils.escapeHtml(content)}</code></pre></div>`;
renderer.renderer.rules.fence = (tokens, index) =>
  codeBlock(
    tokens[index]!.content,
    tokens[index]!.info.trim().split(/\s+/)[0] || "代码",
  );
renderer.renderer.rules.code_block = (tokens, index) =>
  codeBlock(tokens[index]!.content, "代码");
renderer.renderer.rules.table_open = (tokens, index, options, _env, self) => {
  tokens[index]!.attrSet("tabindex", "0");
  tokens[index]!.attrSet("aria-label", "Markdown 表格");
  return self.renderToken(tokens, index, options);
};

export interface DescriptionHeading {
  id: string;
  level: number;
  text: string;
}
export interface RenderedDescription {
  html: string;
  headings: DescriptionHeading[];
}

export function parseDescription(
  text: string,
  anchorPrefix = "description",
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
  return {
    html: renderer.renderer.render(tokens, renderer.options, {}),
    headings,
  };
}

export const renderDescription = (text: string) => parseDescription(text).html;

export function Markdown({
  text,
  anchorPrefix,
  rendered,
}: {
  text: string;
  anchorPrefix?: string;
  rendered?: RenderedDescription;
}) {
  const instance = useId();
  const prefix = anchorPrefix || `description-${instance}`;
  const parsed = useMemo(
    () => rendered || parseDescription(text, prefix),
    [text, prefix, rendered],
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
      {copyStatus && (
        <span role="status" className="sr-only">
          {copyStatus}
        </span>
      )}
    </>
  );
}
