import { useState } from "react";
import { Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, LoadingState, StatusBadge } from "@/components/feedback";
import { PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { CopyButton } from "@/components/copy-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TableToolbar } from "@/components/table-toolbar";
import { SimpleTable } from "@/components/table";
import { useSubmission } from "@/hooks/use-form";
import { formatBytes, formatDate } from "@/lib/utils";

interface Candidate {
  id: string;
  source: string;
  reason: string;
  size_bytes: number;
  changed_at: string;
  token: string;
}
interface Preview {
  offset: number;
  items: Candidate[];
  total: number;
  size_bytes: number;
}
interface CleanResult {
  counts: Record<string, number>;
  items: { id: string; status: string }[];
}

const cleanStatusLabels: Record<string, string> = {
  removed: "已清理",
  missing: "已不存在",
  skipped: "已跳过",
  failed: "失败",
};

export function MaintenancePage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offset, setOffset] = useState(0);
  const [size, setSize] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const submission = useSubmission();
  async function load(next = 0, nextSize = size) {
    await submission.run(async () => {
      const response = await request<Preview>(
        "/admin/maintenance/temp-files/preview",
        {
          method: "POST",
          body: { source: "releases", offset: next, page_size: nextSize },
        },
      );
      setPreview(response.data);
      setOffset(response.data.offset);
      setSize(nextSize);
      setSelected([]);
    });
  }
  async function clean() {
    if (!preview) return;
    const items = preview.items
      .filter((item) => selected.includes(item.id))
      .map(({ id, token }) => ({ id, token }));
    const ok = await submission.run(async () => {
      const response = await request<CleanResult>(
        "/admin/maintenance/temp-files/clean",
        { method: "POST", body: { source: "releases", offset, items } },
      );
      setResult(response.data);
      setConfirm(false);
    });
    if (ok) await load(offset);
  }
  const selectedItems =
    preview?.items.filter((item) => selected.includes(item.id)) ?? [];
  const selectedBytes = selectedItems.reduce(
    (sum, item) => sum + item.size_bytes,
    0,
  );
  return (
    <div className="page">
      <PageHeader
        title="临时文件维护"
        description="预览并清理发布过程中遗留的临时文件。"
      />
      {!confirm && <ErrorNotice error={submission.error} />}
      {result && (
        <details className="panel mb-5 px-4 py-3">
          <summary className="cursor-pointer text-sm">
            <span className="mr-4 font-medium">上次清理结果</span>
            <span className="text-muted">
              已清理 {result.counts.removed ?? 0} · 已不存在{" "}
              {result.counts.missing ?? 0} · 跳过 {result.counts.skipped ?? 0} ·
              失败 {result.counts.failed ?? 0}
            </span>
          </summary>
          <ul className="mt-3 grid max-h-60 gap-2 overflow-y-auto border-t pt-3">
            {result.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 text-xs">
                <StatusBadge
                  tone={
                    item.status === "removed"
                      ? "success"
                      : item.status === "failed"
                        ? "danger"
                        : "warning"
                  }
                >
                  {cleanStatusLabels[item.status] ?? item.status}
                </StatusBadge>
                <span className="mono break-all">{item.id}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Panel bodyClassName="p-0">
        <TableToolbar
          actions={
            <>
              {preview && (
                <Button
                  variant="outline"
                  pending={submission.pending}
                  onClick={() => void load(offset)}
                >
                  重新预览
                </Button>
              )}
              <Button
                variant="dangerSoft"
                disabled={submission.pending || !selected.length}
                onClick={() => {
                  submission.setError(null);
                  setConfirm(true);
                }}
              >
                <Trash2 />
                清理所选（{selected.length}）
              </Button>
            </>
          }
        >
          <span className="text-sm font-medium">发布临时文件</span>
          {preview && (
            <span className="text-xs text-muted">
              总容量 {formatBytes(preview.size_bytes)}
            </span>
          )}
          {selected.length > 0 && (
            <span className="text-xs text-muted">
              已选 {selected.length} 项 · {formatBytes(selectedBytes)}
            </span>
          )}
        </TableToolbar>
        {!preview && submission.pending ? (
          <LoadingState label="正在预览可清理文件…" />
        ) : !preview ? (
          <div className="p-8 text-center">
            <p className="mb-4 text-sm text-muted">
              尚未读取候选；预览不会删除文件。
            </p>
            <Button onClick={() => void load(0)}>预览可清理文件</Button>
          </div>
        ) : (
          <>
            <SimpleTable
              label="临时文件候选"
              className="min-w-[900px] table-fixed [&_th:first-child]:w-12 [&_th:nth-child(3)]:w-48 [&_th:nth-child(4)]:w-32 [&_th:nth-child(4)]:text-right [&_th:last-child]:w-48"
              headers={[
                <input
                  key="select-all"
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label="选择本页全部候选"
                  disabled={submission.pending || !preview.items.length}
                  checked={
                    preview.items.length > 0 &&
                    selected.length === preview.items.length
                  }
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        selected.length > 0 &&
                        selected.length < preview.items.length;
                  }}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? preview.items.map((item) => item.id)
                        : [],
                    )
                  }
                />,
                "候选 ID",
                "形成原因",
                "大小",
                "最近变化",
              ]}
            >
              {preview.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      disabled={submission.pending}
                      aria-label={`选择 ${item.id}`}
                      checked={selected.includes(item.id)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="flex min-w-0 items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="mono min-w-0 truncate text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                            title={item.id}
                            aria-label={`查看候选 ${item.id}`}
                          >
                            {item.id}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96" align="start">
                          <p className="mb-2 text-sm font-medium">候选 ID</p>
                          <p className="mono break-all text-sm">{item.id}</p>
                        </PopoverContent>
                      </Popover>
                      <CopyButton value={item.id} label="复制候选 ID" />
                    </div>
                  </td>
                  <td>{item.reason}</td>
                  <td className="text-right tabular-nums">
                    {formatBytes(item.size_bytes)}
                  </td>
                  <td className="text-xs text-muted">
                    {formatDate(item.changed_at)}
                  </td>
                </tr>
              ))}
            </SimpleTable>
            {!preview.items.length && (
              <p className="p-8 text-center text-sm text-muted">
                当前没有可清理候选。
              </p>
            )}
            <Pagination
              page={Math.floor(offset / size) + 1}
              size={size}
              total={preview.total}
              pending={submission.pending}
              onChange={(page, nextSize) =>
                void load((page - 1) * nextSize, nextSize)
              }
            />
          </>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm}
        danger
        title={`清理 ${selected.length} 项候选`}
        description={`将清理所选 ${selected.length} 项，共 ${formatBytes(selectedBytes)}。已绑定、正在上传、状态变化或归属不明的文件会跳过。清理后无法恢复。`}
        confirmLabel="确认清理"
        pending={submission.pending}
        onClose={() => setConfirm(false)}
        onConfirm={() => void clean()}
      >
        <ErrorNotice error={submission.error} />
        <ul className="max-h-48 overflow-y-auto rounded-lg border p-3">
          {preview?.items
            .filter((item) => selected.includes(item.id))
            .map((item) => (
              <li key={item.id} className="mono break-all py-1 text-xs">
                {item.id}
              </li>
            ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
