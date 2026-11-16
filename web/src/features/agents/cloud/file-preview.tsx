import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  CircleAlert,
  Code2,
  Download,
  Eye,
  FileSearch,
  FileWarning,
  RefreshCw,
} from "lucide-react";
import { IconButton } from "@/components/button";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { MarkdownView } from "@/components/markdown";
import { CodeBlock } from "@/components/code-block";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CloudFileEntry } from "@/types/cloud-computer";
import { agentRoot } from "../data/agent-api";
import { sandboxKeys } from "../sandbox/shared";

const textExtensions = new Set(
  "txt log csv tsv json jsonl yaml yml toml ini conf config env xml css scss less js jsx ts tsx mjs cjs go py sh bash zsh ps1 sql rs java c h cpp hpp cs rb php vue svelte dockerfile makefile gitignore gitattributes editorconfig lock r swift kt diff patch".split(
    " ",
  ),
);
const mediaTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
export function fileFormat(name: string) {
  const extension = name.toLowerCase().split(".").pop() || "";
  if (["md", "markdown", "mdown"].includes(extension))
    return { kind: "markdown", type: "text/plain" };
  if (["html", "htm"].includes(extension))
    return { kind: "html", type: "text/html" };
  if (extension === "svg") return { kind: "svg", type: "image/svg+xml" };
  if (mediaTypes[extension])
    return {
      kind:
        mediaTypes[extension].split("/")[0] === "application"
          ? "pdf"
          : mediaTypes[extension].split("/")[0],
      type: mediaTypes[extension],
    };
  if (
    textExtensions.has(extension) ||
    ["readme", "license", "makefile", "dockerfile"].includes(name.toLowerCase())
  )
    return { kind: "text", type: "text/plain" };
  return { kind: "unsupported", type: "application/octet-stream" };
}
export function fileSize(value: string | null) {
  if (value === null) return "大小未知";
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function sourceLanguage(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "text";
  const aliases: Record<string, string> = {
    md: "markdown",
    mdown: "markdown",
    htm: "html",
    svg: "xml",
    jsonl: "json",
    mjs: "javascript",
    cjs: "javascript",
    h: "c",
    hpp: "cpp",
    env: "dotenv",
    conf: "ini",
    config: "ini",
    txt: "text",
    log: "text",
    lock: "text",
    gitignore: "text",
    gitattributes: "text",
    editorconfig: "ini",
  };
  return aliases[ext] || ext;
}
export function fileURL(computerId: string, path: string) {
  return `/api/v1${agentRoot}/cloud-computers/${computerId}/file-content?${new URLSearchParams({ path, disposition: "attachment" })}`;
}

// Read incrementally: directory sizes can be unknown or change between reads.
async function readPreview(url: string, limit: number, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message || `文件读取失败（${response.status}）`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("浏览器无法读取文件，请下载后查看。");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit)
        throw new Error("文件超过在线预览大小限制，请下载后查看。");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new Blob(chunks);
}

export function FilePreview({
  computerId,
  entry,
}: {
  computerId: string;
  entry: CloudFileEntry | null;
}) {
  return (
    <section className="cloud-preview" aria-label="文件预览">
      {entry ? (
        <SelectedPreview
          key={`${computerId}:${entry.path}:${entry.entry_token}`}
          computerId={computerId}
          entry={entry}
        />
      ) : (
        <>
          <header className="cloud-pane-heading">
            <Eye />
            <h2>文件预览</h2>
          </header>
          <div className="cloud-preview-empty">
            <div className="cloud-preview-illustration">
              <FileSearch strokeWidth={1.2} />
            </div>
            <h2>让工作成果，一目了然</h2>
            <p>从左侧目录选择文件，即可在这里查看内容。</p>
            <div className="cloud-format-chips">
              <span>Markdown</span>
              <span>HTML</span>
              <span>图片 / PDF</span>
              <span>代码 / 音视频</span>
            </div>
            <span className="text-xs text-muted">
              文档与网页支持预览、源码切换
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function SelectedPreview({
  computerId,
  entry,
}: {
  computerId: string;
  entry: CloudFileEntry;
}) {
  const [mode, setMode] = useState("preview");
  const [sourceToolbar, setSourceToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const cache = useQueryClient();
  const format = fileFormat(entry.name);
  const textual = ["text", "markdown", "html", "svg"].includes(format.kind);
  const switchable = ["markdown", "html", "svg"].includes(format.kind);
  const limit = (textual ? 2 : 32) * 1024 * 1024;
  const tooLarge =
    entry.size_bytes !== null && Number(entry.size_bytes) > limit;
  const supported = format.kind !== "unsupported" && !tooLarge;
  const query = useQuery({
    queryKey: [
      ...sandboxKeys,
      "preview",
      computerId,
      entry.path,
      entry.entry_token,
    ],
    queryFn: async ({ signal }) => {
      try {
        const blob = await readPreview(
          fileURL(computerId, entry.path),
          limit,
          signal,
        );
        return { blob, source: textual ? await blob.text() : "" };
      } finally {
        void cache.invalidateQueries({
          queryKey: [...sandboxKeys, "workspace", computerId],
        });
      }
    },
    enabled: supported,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [objectURL, setObjectURL] = useState("");
  useEffect(() => {
    if (!query.data || textual) return;
    const url = URL.createObjectURL(
      new Blob([query.data.blob], { type: format.type }),
    );
    setObjectURL(url);
    return () => URL.revokeObjectURL(url);
  }, [query.data, textual, format.type]);
  const source = query.data?.source || "";
  return (
    <>
      <header className="cloud-preview-heading">
        <div className="min-w-0">
          <h2 className="truncate" title={entry.name}>
            {entry.name}
          </h2>
        </div>
        <div className="cloud-preview-mode-slot">
          {switchable && (
            <div
              className="cloud-preview-modes"
              role="group"
              aria-label="文件显示方式"
            >
              <button
                type="button"
                aria-pressed={mode === "preview"}
                onClick={() => setMode("preview")}
              >
                <Eye />
                预览
              </button>
              <button
                type="button"
                aria-pressed={mode === "source"}
                onClick={() => setMode("source")}
              >
                <Code2 />
                源码
              </button>
            </div>
          )}
        </div>
        <div className="cloud-preview-actions">
          <Popover>
            <PopoverTrigger
              render={
                <IconButton label="文件信息" size="iconSm">
                  <CircleAlert />
                </IconButton>
              }
            />
            <PopoverContent
              align="end"
              className="w-80 max-w-[calc(100vw-24px)]"
              aria-label="文件信息"
            >
              <h3 className="mb-4 text-sm font-semibold">文件信息</h3>
              <dl className="cloud-facts cloud-facts-stacked">
                <div>
                  <dt>文件路径</dt>
                  <dd className="font-mono">/data/{entry.path}</dd>
                </div>
                <div>
                  <dt>文件大小</dt>
                  <dd>{fileSize(entry.size_bytes)}</dd>
                </div>
                <div>
                  <dt>修改时间</dt>
                  <dd>
                    {entry.modified_at
                      ? new Date(entry.modified_at).toLocaleString()
                      : "未提供"}
                  </dd>
                </div>
                <div>
                  <dt>预览方式</dt>
                  <dd>
                    {format.kind === "html" || format.kind === "svg"
                      ? "静态预览 · 脚本及外部资源已禁用"
                      : "只读预览"}
                  </dd>
                </div>
              </dl>
            </PopoverContent>
          </Popover>
          <div className="cloud-source-actions" ref={setSourceToolbar} />
          {supported && (
            <IconButton
              label="刷新文件"
              size="iconSm"
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw />
            </IconButton>
          )}
          <IconButton
            label="下载"
            size="iconSm"
            render={<a href={fileURL(computerId, entry.path)} download />}
            nativeButton={false}
            role="link"
          >
            <Download />
          </IconButton>
        </div>
      </header>
      <div className="cloud-preview-content">
        {!supported ? (
          <div className="cloud-preview-empty">
            <FileWarning className="size-10 text-muted" />
            <EmptyState
              title={
                tooLarge ? "文件较大，请下载查看" : "此格式暂不支持在线预览"
              }
              description={
                tooLarge
                  ? `文本预览上限为 2 MB，图片、PDF 和音视频为 32 MB。`
                  : "可通过右上角下载文件，使用本机应用打开。"
              }
            />
          </div>
        ) : (
          <AsyncBoundary
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
          >
            {query.data &&
              (textual && (mode === "source" || format.kind === "text") ? (
                <CodeBlock
                  source={source}
                  language={sourceLanguage(entry.name)}
                  contentLabel="文件源码"
                  className="cloud-source"
                  contentClassName="cloud-source-content"
                  toolbarContainer={sourceToolbar}
                />
              ) : format.kind === "markdown" ? (
                <div className="cloud-markdown">
                  <MarkdownView source={source} navigation={false} />
                </div>
              ) : format.kind === "html" || format.kind === "svg" ? (
                <iframe
                  className="cloud-document-frame"
                  title={`${entry.name} 预览`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'"><style>body{margin:24px;color:#262626;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img,svg{max-width:100%;height:auto}</style></head><body>${DOMPurify.sanitize(source, { FORCE_BODY: true, FORBID_TAGS: ["base", "meta", "iframe", "object", "embed", "form"], ADD_TAGS: ["style"] })}</body></html>`}
                />
              ) : (
                objectURL && (
                  <MediaPreview
                    kind={format.kind}
                    url={objectURL}
                    name={entry.name}
                  />
                )
              ))}
          </AsyncBoundary>
        )}
      </div>
    </>
  );
}
function MediaPreview({
  kind,
  url,
  name,
}: {
  kind: string;
  url: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <EmptyState
        title="浏览器无法预览此文件"
        description="文件可能损坏或编码不受支持，请下载后查看。"
      />
    );
  if (kind === "pdf")
    return (
      <iframe
        className="cloud-document-frame"
        title={`${name} 预览`}
        src={url}
      />
    );
  return (
    <div className="cloud-media">
      {kind === "image" ? (
        <img src={url} alt={name} onError={() => setFailed(true)} />
      ) : kind === "audio" ? (
        <audio
          controls
          src={url}
          onError={() => setFailed(true)}
          aria-label={name}
        />
      ) : (
        <video
          controls
          src={url}
          onError={() => setFailed(true)}
          aria-label={name}
        />
      )}
    </div>
  );
}
