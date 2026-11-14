import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { MarkdownView } from "@/components/markdown";
import { useApiQuery } from "@/hooks/use-api";
import type {
  Artifact,
  Attachment,
  ContentBlock,
  FileMetadata,
  FileRef,
} from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import { ChatDisclosure, ThinkingDots } from "./disclosure";
import { ActivityIcon } from "./activity-icon";

export function MessageContent({
  blocks,
  sessionId,
  streaming = false,
}: {
  blocks: ContentBlock[];
  sessionId: string;
  streaming?: boolean;
}) {
  return (
    <div className="agent-message-content">
      {blocks.map((block, index) =>
        block.type === "text" ? (
          <MarkdownView
            navigation={false}
            key={index}
            source={block.text}
            compact
            preview
            streaming={streaming}
          />
        ) : block.type === "reasoning" && block.text.trim() ? (
          <ReasoningBlock
            key={index}
            text={block.text}
            streaming={streaming && block.duration_ms === undefined}
            durationMs={block.duration_ms}
          />
        ) : block.type === "file_reference" ? (
          <FileReference key={index} reference={block} sessionId={sessionId} />
        ) : block.type === "tool_reference" ? (
          <a
            className="block w-fit text-xs text-primary underline"
            key={index}
            href={`#tool-${block.tool_call_id}`}
          >
            查看工具调用
          </a>
        ) : null,
      )}
    </div>
  );
}
function ReasoningBlock({
  text,
  streaming,
  durationMs,
}: {
  text: string;
  streaming: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null),
    following = useRef(true);
  useEffect(() => {
    if (open && streaming && following.current && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [open, streaming, text]);
  return (
    <ChatDisclosure
      open={open}
      onToggle={() => setOpen(!open)}
      label={streaming ? "思考中" : "思考"}
      active={streaming}
      icon={<ActivityIcon name="reasoning" active={streaming} />}
      detail={
        streaming ? (
          <ThinkingDots />
        ) : durationMs !== undefined ? (
          `用时 ${durationMs < 1000 ? "不足 1 秒" : `${Math.floor(durationMs / 1000)} 秒`}`
        ) : undefined
      }
    >
      <div
        ref={body}
        className="agent-reasoning-body"
        onScroll={() => {
          const node = body.current;
          if (node)
            following.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {text}
      </div>
    </ChatDisclosure>
  );
}
export function FileReference({
  reference,
  sessionId,
}: {
  reference: FileRef;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useApiQuery<Artifact | Attachment>(
    ["agent-session", sessionId, "reference", reference.kind, reference.id],
    reference.kind === "artifact"
      ? `${agentRoot}/artifacts/${reference.id}`
      : `${agentRoot}/sessions/${sessionId}/attachments/${reference.id}`,
  );
  const file = query.data?.data;
  return (
    <>
      <Button
        className="max-w-full justify-start"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <span className="truncate" title={file?.filename}>
          {file?.filename ?? (query.isError ? "文件暂不可用" : "正在读取文件…")}
        </span>
      </Button>
      {open && (
        <Drawer
          open
          wide
          title={file?.filename ?? "文件"}
          onClose={() => setOpen(false)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <AsyncBoundary
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
          >
            {file && <FileView id={file.file_id} sessionId={sessionId} />}
          </AsyncBoundary>
        </Drawer>
      )}
    </>
  );
}
export function FileView({ id, sessionId }: { id: string; sessionId: string }) {
  const query = useApiQuery<FileMetadata>(
    ["agent-session", sessionId, "file", id],
    `${agentRoot}/files/${id}`,
  );
  const file = query.data?.data;
  const url = `/api/v1${agentRoot}/files/${encodeURIComponent(id)}/content`;
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {file && (
        <div className="space-y-4">
          <div>
            <h3 className="break-all font-medium">{file.filename}</h3>
            <p className="mt-1 text-xs text-muted">
              {file.media_type} · {Number(file.size_bytes).toLocaleString()}{" "}
              字节
            </p>
          </div>
          {file.download_url ? (
            <Button
              render={
                <a href={url} download>
                  下载文件
                </a>
              }
              nativeButton={false}
              role="link"
              variant="outline"
            />
          ) : (
            <Notice tone="warning">
              文件字节当前不可下载，历史记录仍保留。
            </Notice>
          )}
          {file.preview_available &&
            file.download_url &&
            (["image/png", "image/jpeg", "image/webp"].includes(
              file.media_type,
            ) ? (
              <img
                src={`${url}?disposition=inline`}
                alt={file.filename}
                className="max-h-[65vh] max-w-full rounded-lg object-contain"
              />
            ) : (
              <TextFile
                url={`${url}?disposition=inline`}
                sessionId={sessionId}
                markdown={/\.(md|markdown)$/i.test(file.filename)}
              />
            ))}
        </div>
      )}
    </AsyncBoundary>
  );
}
function TextFile({
  url,
  sessionId,
  markdown = false,
}: {
  url: string;
  sessionId: string;
  markdown?: boolean;
}) {
  const query = useQuery({
    queryKey: ["agent-session", sessionId, "file-preview", url],
    queryFn: async ({ signal }) => {
      const response = await fetch(url, {
        signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok || !response.body)
        throw new Error("当前文件无法预览，请重新读取或下载。");
      if (
        !/^(text\/plain|text\/markdown|application\/json)/i.test(
          response.headers.get("Content-Type") ?? "",
        )
      )
        throw new Error("此文件类型仅支持下载。");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 262144) {
            await reader.cancel();
            throw new Error("文本超过预览上限，请下载查看完整文件。");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const result = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        result.set(chunk, at);
        at += chunk.length;
      }
      return new TextDecoder().decode(result);
    },
    retry: false,
  });
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {markdown && query.data !== undefined ? (
        <div className="agent-file-markdown">
          <MarkdownView
            source={query.data}
            compact
            preview
            navigation={false}
          />
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words rounded-lg border bg-surface-subtle p-4 text-sm leading-7">
          {query.data}
        </pre>
      )}
    </AsyncBoundary>
  );
}
