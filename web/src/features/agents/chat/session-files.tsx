import { useState } from "react";
import { Button } from "@/components/button";
import { AsyncBoundary, EmptyState, StatusBadge } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import type { Artifact, Attachment, FileRef } from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import { ResourceDelete } from "@/features/agents/resources/resource-actions";
import { FileView } from "./content";

export function SessionFiles({
  sessionId,
  readonly,
  canReference,
  onReference,
  onClose,
}: {
  sessionId: string;
  readonly: boolean;
  canReference: boolean;
  onReference: (ref: FileRef) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"artifacts" | "bound" | "staged">("artifacts"),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const path =
    tab === "artifacts"
      ? `/sessions/${sessionId}/artifacts`
      : `/sessions/${sessionId}/attachments?state=${tab}`;
  const query = useApiQuery<(Artifact | Attachment)[]>(
    ["agent-session", sessionId, "files", tab, page],
    `${agentRoot}${path}${path.includes("?") ? "&" : "?"}page=${page}&page_size=20`,
  );
  return (
    <Drawer
      open
      wide
      title="附件与成果"
      description="文件按当前会话的内容权限读取。正式成果已保存在平台，不依赖原工作目录持续存在。"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <div className="mb-5 flex gap-2">
        {(
          [
            ["artifacts", "正式成果"],
            ["bound", "历史附件"],
            ["staged", "我的暂存附件"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "ghost"}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="space-y-4">
          {query.data?.data.map((file) => {
            const artifact = "description" in file;
            return (
              <article key={file.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-all text-sm font-semibold">
                      {file.filename}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {Number(file.size_bytes).toLocaleString()} 字节 ·{" "}
                      {new Date(file.created_at).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge>
                    {artifact
                      ? "正式成果"
                      : file.state === "staged"
                        ? "尚未发送"
                        : "历史附件"}
                  </StatusBadge>
                </div>
                {artifact && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {file.description}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setPreview({ id: file.file_id, name: file.filename })
                    }
                  >
                    查看文件
                  </Button>
                  {canReference && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        onReference({
                          kind: artifact ? "artifact" : "attachment",
                          id: file.id,
                        });
                        onClose();
                      }}
                    >
                      引用到消息
                    </Button>
                  )}
                  {!readonly && (artifact || file.state === "staged") && (
                    <ResourceDelete
                      domain={agentRoot}
                      path={
                        artifact
                          ? `/artifacts/${file.id}`
                          : `/sessions/${sessionId}/attachments/${file.id}`
                      }
                      scope={
                        artifact
                          ? `artifact:${file.id}`
                          : `session:${sessionId}`
                      }
                      command={
                        artifact ? "artifact.delete" : "attachment.delete"
                      }
                      etag={`"${file.version}"`}
                      label={artifact ? "成果" : "暂存附件"}
                      onDeleted={() => {
                        void query.refetch();
                      }}
                    />
                  )}
                </div>
              </article>
            );
          })}
          {query.data?.data.length === 0 && <EmptyState title="暂无文件" />}
        </div>
        <Pagination
          page={page}
          size={20}
          total={query.data?.pagination?.total}
          pending={query.isFetching}
          onChange={setPage}
        />
      </AsyncBoundary>
      {preview && (
        <Drawer
          open
          wide
          title={preview.name}
          onClose={() => setPreview(null)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <FileView id={preview.id} sessionId={sessionId} />
        </Drawer>
      )}
    </Drawer>
  );
}
