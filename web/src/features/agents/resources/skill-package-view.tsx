import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Eye,
  Code2,
} from "lucide-react";
import { Button } from "@/components/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CopyButton } from "@/components/copy-button";
import { CodeBlock } from "@/components/code-block";
import { MarkdownView } from "@/components/markdown";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import type { SkillManifest } from "@/types/agent-resources";

type Node = {
  name: string;
  path: string;
  children: Map<string, Node>;
  file?: SkillManifest["entries"][number];
};
function nodes(entries: SkillManifest["entries"]) {
  const root = new Map<string, Node>();
  for (const file of entries) {
    let parent = root;
    const parts = file.path.split("/");
    parts.forEach((name, i) => {
      let node = parent.get(name);
      if (!node) {
        node = {
          name,
          path: parts.slice(0, i + 1).join("/"),
          children: new Map(),
        };
        parent.set(name, node);
      }
      if (i === parts.length - 1) node.file = file;
      parent = node.children;
    });
  }
  return root;
}

export function SkillPackageView({
  skillId,
  versionId,
  manifest,
}: {
  skillId: string;
  versionId: string;
  manifest: SkillManifest;
}) {
  const [selected, setSelected] = useState("SKILL.md");
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [linkError, setLinkError] = useState<string>();
  const [focused, setFocused] = useState("SKILL.md");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useRef<HTMLUListElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const root = useMemo(() => nodes(manifest.entries), [manifest.entries]);
  const file = manifest.entries.find((entry) => entry.path === selected);
  const text =
    file &&
    (file.media_type.startsWith("text/") ||
      file.media_type === "application/json");
  const previewable = Boolean(text && Number(file?.size_bytes) <= 256 * 1024);
  const markdown =
    /\.(md|markdown)$/i.test(selected) || file?.media_type === "text/markdown";
  const choose = (path: string) => {
    if (pane.current && pane.current.getBoundingClientRect().top < 64)
      pane.current.scrollIntoView({ block: "start", behavior: "instant" });
    setSelected(path);
    setMode("preview");
    setLinkError(undefined);
  };
  const query = useApiQuery<{ path: string; text: string }>(
    ["agent-resources", "skills", skillId, versionId, "text", selected],
    `${agentAdminRoot}/skills/${skillId}/versions/${versionId}/content?path=${encodeURIComponent(selected)}`,
    { enabled: previewable },
  );
  const toggle = (path: string, open: boolean) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, node: Node) {
    const items = Array.from(
      tree.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="treeitem"]',
      ) ?? [],
    );
    const index = items.indexOf(event.currentTarget);
    let target: HTMLButtonElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        target = items[Math.min(index + 1, items.length - 1)];
        break;
      case "ArrowUp":
        target = items[Math.max(index - 1, 0)];
        break;
      case "Home":
        target = items[0];
        break;
      case "End":
        target = items.at(-1);
        break;
      case "ArrowRight":
        if (!node.file && !expanded.has(node.path)) toggle(node.path, true);
        else if (!node.file) target = items[index + 1];
        break;
      case "ArrowLeft":
        if (!node.file && expanded.has(node.path)) toggle(node.path, false);
        else
          target = items.find(
            (item) =>
              item.dataset.path === node.path.split("/").slice(0, -1).join("/"),
          );
        break;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }
  function branch(children: Map<string, Node>, level = 1) {
    return [...children.values()]
      .sort(
        (a, b) =>
          Number(Boolean(a.file)) - Number(Boolean(b.file)) ||
          a.name.localeCompare(b.name),
      )
      .map((node) => {
        const open = expanded.has(node.path);
        const Icon = node.file ? File : open ? FolderOpen : Folder;
        return (
          <li key={node.path} role="none">
            <button
              type="button"
              role="treeitem"
              data-path={node.path}
              aria-label={node.name}
              aria-level={level}
              aria-expanded={node.file ? undefined : open}
              aria-selected={node.path === selected}
              tabIndex={node.path === focused ? 0 : -1}
              onFocus={() => setFocused(node.path)}
              onKeyDown={(event) => keyboard(event, node)}
              onClick={() =>
                node.file ? choose(node.path) : toggle(node.path, !open)
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-md py-2 pr-3 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                node.path === selected && "bg-surface-hover font-medium",
              )}
              style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
            >
              {node.file ? (
                <span className="w-3 shrink-0" />
              ) : open ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <ChevronRight className="size-3 shrink-0" />
              )}
              <Icon className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 break-all">{node.name}</span>
            </button>
            {!node.file && open && (
              <ul role="group">{branch(node.children, level + 1)}</ul>
            )}
          </li>
        );
      });
  }
  const languages: Record<string, string> = {
    md: "markdown",
    py: "python",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    go: "go",
    sql: "sql",
  };
  return (
    <section aria-label="技能包内容" className="skill-package">
      <nav aria-label="技能文件" className="skill-package-tree">
        <h2 className="skill-file-heading">
          文件 <span className="text-muted">{manifest.file_count}</span>
        </h2>
        <ul ref={tree} role="tree" aria-label="技能文件目录" className="p-3">
          {branch(root)}
        </ul>
      </nav>
      <div ref={pane} className="skill-file-pane">
        <header className="skill-file-heading">
          <span className="flex min-w-0 items-center gap-2">
            <File className="size-4 shrink-0 text-muted" />
            <span className="truncate font-mono text-xs" title={selected}>
              {selected}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {markdown && previewable && (
              <ToggleGroup
                value={[mode]}
                onValueChange={([value]) => {
                  if (value === "preview" || value === "source") setMode(value);
                }}
                className="skill-mode-switch"
                size="sm"
                spacing={1}
                aria-label="文件显示方式"
              >
                <ToggleGroupItem value="preview">
                  <Eye aria-hidden />
                  预览
                </ToggleGroupItem>
                <ToggleGroupItem value="source">
                  <Code2 aria-hidden />
                  源码
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <div ref={setToolbar} className="flex items-center gap-1" />
            {markdown && mode === "preview" && query.data && (
              <CopyButton value={query.data.data.text} label="复制文件内容" />
            )}
          </div>
        </header>
        {linkError && (
          <div className="px-5 pt-3">
            <Notice tone="warning">{linkError}</Notice>
          </div>
        )}
        {!previewable ? (
          <div className="min-h-0 overflow-auto p-6 space-y-4">
            <Notice>
              {!file
                ? "文件不存在。"
                : !text
                  ? "此文件不支持文本预览。"
                  : "文件超过 256 KiB 预览上限。"}
              请下载技能包查看。
            </Notice>
            <Button
              render={
                <a
                  href={`/api/v1${agentAdminRoot}/skills/${skillId}/versions/${versionId}/archive`}
                  download
                >
                  下载 ZIP
                </a>
              }
              nativeButton={false}
              role="link"
              variant="outline"
            />
          </div>
        ) : (
          <AsyncBoundary
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
          >
            {query.data &&
              (markdown && mode === "preview" ? (
                <div
                  key={selected}
                  className="skill-markdown"
                  role="region"
                  aria-label="技能文件内容"
                  tabIndex={0}
                  onClickCapture={(event) => {
                    const href = (event.target as Element)
                      .closest("a")
                      ?.getAttribute("href");
                    if (
                      !href ||
                      href.startsWith("#") ||
                      /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
                    )
                      return;
                    event.preventDefault();
                    try {
                      const path = decodeURIComponent(
                        new URL(
                          href,
                          `https://skill.invalid/${selected}`,
                        ).pathname.slice(1),
                      );
                      if (
                        !manifest.entries.some((entry) => entry.path === path)
                      ) {
                        setLinkError("此链接指向的文件不在技能包中。");
                        return;
                      }
                      choose(path);
                      setFocused(path);
                      setExpanded((old) => {
                        const next = new Set(old);
                        const parts = path.split("/");
                        for (let i = 1; i < parts.length; i++)
                          next.add(parts.slice(0, i).join("/"));
                        return next;
                      });
                    } catch {
                      setLinkError("无法识别此文件链接。");
                    }
                  }}
                >
                  <MarkdownView
                    directoryContainer={toolbar}
                    source={query.data.data.text.replace(
                      /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
                      "",
                    )}
                    compact
                    preview
                  />
                </div>
              ) : (
                <CodeBlock
                  toolbarContainer={toolbar}
                  copyLabel="复制文件内容"
                  key={selected}
                  source={query.data.data.text}
                  title={markdown ? "Markdown 源码" : selected}
                  language={
                    languages[selected.split(".").at(-1) ?? ""] ?? "text"
                  }
                  defaultWrap
                  contentLabel="技能文件内容"
                  className="skill-file-source m-0 min-h-0 flex-1 rounded-none"
                  contentClassName="max-h-none overflow-x-auto overflow-y-hidden"
                />
              ))}
          </AsyncBoundary>
        )}
      </div>
    </section>
  );
}
