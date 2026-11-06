import { useState } from "react";
import { Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
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
  return (
    <div className="page">
      <PageHeader
        title="临时文件维护"
        description="预览候选、明确选择并复核清理；不接受任意文件路径。"
        actions={
          <Button
            variant="outline"
            pending={submission.pending}
            onClick={() => void load(offset)}
          >
            重新预览
          </Button>
        }
      />
      <Notice className="mb-5">
        已绑定、正在上传、已变化或归属未知的候选会跳过。清理使用同一预览中的候选令牌，逐项返回事实。
      </Notice>
      <ErrorNotice error={submission.error} />
      {result && (
        <Panel title="上次清理结果" className="mb-5">
          <div className="mb-3 text-sm">
            已清理 {result.counts.removed ?? 0} · 已不存在{" "}
            {result.counts.missing ?? 0} · 跳过 {result.counts.skipped ?? 0} ·
            失败 {result.counts.failed ?? 0}
          </div>
          <ul className="grid gap-2">
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
                  {item.status}
                </StatusBadge>
                <span className="mono break-all">{item.id}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel
        title="发布临时文件"
        action={
          preview && (
            <span className="text-xs text-muted">
              {preview.total} 项 · {formatBytes(preview.size_bytes)}
            </span>
          )
        }
      >
        {!preview ? (
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
              headers={["", "候选 ID", "形成原因", "大小", "最近变化"]}
            >
              {preview.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
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
                  <td className="mono break-all text-xs">{item.id}</td>
                  <td>{item.reason}</td>
                  <td>{formatBytes(item.size_bytes)}</td>
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
            <div className="flex flex-wrap items-center gap-2 border-t p-4">
              <Button
                size="sm"
                variant="ghost"
                disabled={submission.pending || !preview.items.length}
                onClick={() =>
                  setSelected(preview.items.map((item) => item.id))
                }
              >
                选择本页
              </Button>
              <Button
                className="ml-auto"
                variant="dangerSoft"
                disabled={submission.pending || !selected.length}
                onClick={() => setConfirm(true)}
              >
                <Trash2 />
                清理所选 {selected.length} 项
              </Button>
            </div>
          </>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm}
        danger
        title={`清理 ${selected.length} 项候选`}
        description="服务端会在删除前重新核实候选状态与令牌"
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
