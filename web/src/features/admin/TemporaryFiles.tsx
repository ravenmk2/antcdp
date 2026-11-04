import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { request, errorMessage } from "@/lib/api";
import { ErrorBox } from "@/components/platform/feedback";
type Entry = {
  id: string;
  token: string;
  reason: string;
  size_bytes: number;
  changed_at: string;
};
type Preview = { items: Entry[]; total: number; size_bytes: number };
export function TemporaryFiles() {
  const [preview, setPreview] = useState<Preview>(),
    [selected, select] = useState<string[]>([]),
    [offset, setOffset] = useState(0),
    [confirm, setConfirm] = useState(false),
    [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function act(clean: boolean, next = 0) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (clean && preview) {
        const rows = preview.items.filter((v) => selected.includes(v.id));
        const { data } = await request<{ counts: Record<string, number> }>(
          "/admin/maintenance/temp-files/clean",
          {
            method: "POST",
            body: {
              source: "releases",
              items: rows.map(({ id, token }) => ({ id, token })),
            },
          },
        );
        setResult(
          "已清理 " +
            (data.counts.removed || 0) +
            " 项，已不存在 " +
            (data.counts.missing || 0) +
            " 项，跳过 " +
            (data.counts.skipped || 0) +
            " 项，失败 " +
            (data.counts.failed || 0) +
            " 项。",
        );
      }
      const { data } = await request<Preview>(
        "/admin/maintenance/temp-files/preview",
        { method: "POST", body: { source: "releases", offset: next } },
      );
      setPreview(data);
      select([]);
      setConfirm(false);
      setOffset(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">临时文件维护</h2>
      <p className="text-sm text-muted-foreground">
        当前来源为发布材料上传。预览只列出中断上传和未绑定的原件，已保存的材料修订长期保留。
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
        预览可清理文件
      </Button>
      {error && <ErrorBox>{error}</ErrorBox>}
      {result && <p role="status">{result}</p>}
      {preview && (
        <>
          <p>
            {preview.total} 项候选 · 合计 {preview.size_bytes.toLocaleString()}{" "}
            B
          </p>
          {preview.items.map((v) => (
            <label
              key={v.id}
              className="flex items-start gap-3 border-t py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(v.id)}
                disabled={busy || confirm}
                onChange={(e) =>
                  select(
                    e.target.checked
                      ? [...selected, v.id]
                      : selected.filter((id) => id !== v.id),
                  )
                }
              />
              <span className="min-w-0">
                {v.reason} · {v.size_bytes} B{" "}
                <code className="block break-all text-xs text-muted-foreground">
                  {v.id}
                </code>
              </span>
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            {offset > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || confirm}
                onClick={() => void act(false, Math.max(0, offset - 100))}
              >
                上一页
              </Button>
            )}
            {offset + preview.items.length < preview.total && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || confirm}
                onClick={() => void act(false, offset + 100)}
              >
                下一页
              </Button>
            )}
            {preview.items.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || confirm}
                  onClick={() => select(preview.items.map((v) => v.id))}
                >
                  选择本页
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!selected.length || busy || confirm}
                  onClick={() => setConfirm(true)}
                >
                  清理所选 {selected.length} 项
                </Button>
              </>
            )}
          </div>
          {confirm && (
            <div className="rounded-lg border p-3">
              <p>
                确认清理 {selected.length} 项？系统会在删除前重新核实文件状态。
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void act(true)}
                >
                  确认清理
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
