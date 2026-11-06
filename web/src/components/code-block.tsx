import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { useTheme } from "@/app/theme";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

export function CodeBlock({
  source,
  language,
  className,
  contentClassName,
}: {
  source: string;
  language: string;
  className?: string;
  contentClassName?: string;
}) {
  const { resolved } = useTheme();
  const [highlight, setHighlight] = useState<{
    source: string;
    language: string;
    theme: string;
    html: string;
  }>();
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
        if (active)
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
  }, [source, language, resolved]);
  const html =
    highlight?.source === source &&
    highlight.language === language &&
    highlight.theme === resolved
      ? highlight.html
      : "";
  return (
    <figure className={cn("my-4 overflow-hidden rounded-lg border", className)}>
      <figcaption className="flex items-center justify-between border-b bg-surface-subtle px-3 py-1 text-xs text-muted">
        <span>{language || "text"}</span>
        <CopyButton value={source} label="复制代码" />
      </figcaption>
      <div
        className={cn(
          "overflow-auto bg-surface-subtle text-xs [&_pre]:p-4",
          contentClassName,
        )}
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>
            <code>{source}</code>
          </pre>
        )}
      </div>
    </figure>
  );
}
