import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { useTheme } from "@/app/theme";
import { IconButton } from "./button";
import { Download, FileCode2, WrapText } from "lucide-react";
import { ErrorNotice } from "./feedback";
import {
  CodeBlock as Frame,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockLine,
} from "./ui/code-block";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

const languageExtensions: Record<string, string> = {
  text: "txt",
  plaintext: "txt",
  javascript: "js",
  typescript: "ts",
  python: "py",
  ruby: "rb",
  rust: "rs",
  bash: "sh",
  shell: "sh",
  shellscript: "sh",
  powershell: "ps1",
  csharp: "cs",
  "c#": "cs",
  "c++": "cpp",
  markdown: "md",
  yaml: "yml",
  mermaid: "mmd",
};

export function CodeBlock({
  source,
  language,
  title,
  highlightedLines = [],
  lineNumbers = true,
  defaultWrap = false,
  copyLabel = "复制代码",
  contentLabel,
  className,
  contentClassName,
  toolbarContainer,
  streaming = false,
}: {
  source: string;
  language: string;
  title?: string;
  highlightedLines?: number[];
  lineNumbers?: boolean;
  defaultWrap?: boolean;
  copyLabel?: string;
  contentLabel?: string;
  className?: string;
  contentClassName?: string;
  toolbarContainer?: HTMLElement | null;
  streaming?: boolean;
}) {
  const { resolved } = useTheme();
  const [wrap, setWrap] = useState(defaultWrap);
  const [error, setError] = useState<unknown>(null);
  const [highlight, setHighlight] = useState<{
    source: string;
    language: string;
    theme: string;
    html: string;
  }>();
  // Use identical line endings for the plain and highlighted representations.
  const displaySource = source.replace(/\n$/, "");
  useEffect(() => {
    // Token updates must not alternate plain text and asynchronous highlights.
    if (streaming) return;
    let active = true;
    void import("shiki")
      .then(({ codeToHtml }) =>
        active
          ? codeToHtml(displaySource, {
              lang: language || "text",
              theme: resolved === "dark" ? "github-dark" : "github-light",
            })
          : undefined,
      )
      .then((value) => {
        if (active && value !== undefined)
          setHighlight({
            source,
            language,
            theme: resolved,
            html: DOMPurify.sanitize(value),
          });
      })
      .catch(() => {
        if (active) setHighlight(undefined);
      });
    return () => {
      active = false;
    };
  }, [source, displaySource, language, resolved, streaming]);
  const html =
    !streaming &&
    highlight?.source === source &&
    highlight.language === language &&
    highlight.theme === resolved
      ? highlight.html
      : "";
  const lines = useMemo(() => {
    if (!html) return null;
    const code = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("code");
    if (!code) return null;
    const rows = [...code.querySelectorAll(".line")];
    return rows.length ? rows.map((row) => row.innerHTML) : [code.innerHTML];
  }, [html]);
  const plain = displaySource.split("\n");
  const normalizedLanguage = language.trim().toLowerCase();
  const extension =
    languageExtensions[normalizedLanguage] ||
    (/^[a-z0-9]+$/.test(normalizedLanguage) ? normalizedLanguage : "txt");
  const downloadName = `code.${extension}`;
  const toolbar = (
    <CodeBlockHeader className={toolbarContainer ? "p-0" : "px-5 pt-4"}>
      {!toolbarContainer && (
        <CodeBlockTitle title={title || language || "text"}>
          <FileCode2 className="mr-2 size-4" />
          {title || language || "text"}
        </CodeBlockTitle>
      )}
      <CodeBlockActions>
        <IconButton
          label="自动换行"
          size="iconSm"
          aria-pressed={wrap}
          variant={wrap ? "secondary" : "ghost"}
          className={wrap ? "bg-accent-soft text-primary" : undefined}
          onClick={() => setWrap(!wrap)}
        >
          <WrapText />
        </IconButton>
        <IconButton
          label="下载代码"
          size="iconSm"
          onClick={() => {
            try {
              setError(null);
              const url = URL.createObjectURL(
                new Blob([source], { type: "text/plain;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = downloadName;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (caught) {
              setError(caught);
            }
          }}
        >
          <Download />
        </IconButton>
        <CopyButton value={source} label={copyLabel} />
      </CodeBlockActions>
    </CodeBlockHeader>
  );
  return (
    <Frame
      className={cn("markdown-code-block my-4 border-0 rounded-lg", className)}
    >
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
      {error != null && (
        <div className="px-5 pt-2">
          <ErrorNotice error={error} />
        </div>
      )}
      <CodeBlockContent
        lineNumbers={lineNumbers}
        aria-label={contentLabel}
        wrap={wrap}
        className={cn(
          "max-h-[560px] px-5 pb-4 text-sm leading-6",
          contentClassName,
        )}
      >
        {(lines || plain).map((line, index) => (
          <CodeBlockLine
            key={index}
            className="-mx-5 px-5 before:text-faint"
            variant={
              highlightedLines.includes(index + 1) ? "highlighted" : "default"
            }
          >
            {lines && line ? (
              <span dangerouslySetInnerHTML={{ __html: line }} />
            ) : (
              line || undefined
            )}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </Frame>
  );
}
