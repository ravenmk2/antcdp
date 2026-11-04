import { StatusText } from "@/components/platform/status-text";
import { useEffect, useRef, useState } from "react";
import type { ProjectRepository } from "@/shared/repositories";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import {
  writeOutcomeUnknown,
  writeRequiresReview,
  writeReviewMessage,
} from "@/lib/write-error";
import { FormDialog } from "@/components/platform/form-dialog";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/platform/feedback";
type Shared = {
  base: string;
  rows: ProjectRepository[];
  onClose: () => void;
  allowed: boolean;
};
export function Unlink({
  base,
  rows,
  etag,
  onClose,
  onSaved,
  allowed,
}: Shared & { etag: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false),
    locked = useRef(false);
  async function save() {
    if (!allowed || locked.current || blocked || !etag) return;
    locked.current = true;
    setBusy(true);
    try {
      await request(base + "/batch-unlink", {
        method: "POST",
        etag,
        body: { ids: rows.map((r) => r.id) },
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBlocked(writeRequiresReview(e));
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <FormDialog
      open
      title="解除仓库关联"
      description={
        "将从本项目移除 " + rows.length + " 个仓库关联，远端仓库继续保留。"
      }
      pending={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={!allowed || busy || blocked || !etag}
            onClick={() => void save()}
          >
            {busy ? "正在解除…" : "确认解除"}
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      {blocked && (
        <p role="alert">{writeReviewMessage}关闭并刷新关联列表后再选择。</p>
      )}
      <ul className="divide-y rounded-lg border px-4">
        {rows.map((r) => (
          <li key={r.id} className="break-all py-3 text-sm">
            {r.full_path}
            <span className="ml-2 text-xs text-muted-foreground">
              {r.connection_name}
            </span>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
function SnapshotReview({ path }: { path: string }) {
  const [opened, setOpened] = useState(false);
  const query = useQuery<ProjectRepository>(opened ? path : null);
  const date = useDate();
  return (
    <div className="mt-2 space-y-1">
      <Button
        variant="outline"
        size="sm"
        disabled={query.loading}
        onClick={() => (opened ? query.refresh() : setOpened(true))}
      >
        {query.loading ? "正在读取…" : "读取最新快照"}
      </Button>
      <ErrorBox>{query.error}</ErrorBox>
      {query.data && (
        <p role="status" className="text-sm">
          快照更新时间：{date(query.data.last_synced_at)} · 默认分支：
          {query.data.default_branch || "未提供"}
        </p>
      )}
    </div>
  );
}
type Result = {
  repo: ProjectRepository;
  status: "等待" | "同步中" | "成功" | "失败" | "待核对";
  message?: string;
};
export function Sync({
  base,
  rows,
  onClose,
  allowed,
  onDone,
}: Shared & { onDone: (ids: string[]) => void }) {
  const [results, setResults] = useState<Result[]>(() =>
      rows.map((repo) => ({ repo, status: "等待" })),
    ),
    [busy, setBusy] = useState(false),
    [started, setStarted] = useState(false),
    [follow, setFollow] = useState(true);
  const locked = useRef(false),
    list = useRef<HTMLUListElement>(null),
    lastTop = useRef(0),
    permission = useRef(allowed);
  permission.current = allowed;
  useEffect(() => {
    const box = list.current,
      item = box?.querySelector<HTMLElement>("[data-unfinished=true]");
    if (!busy || !follow || !box || !item) return;
    box.scrollTop += Math.max(
      0,
      item.getBoundingClientRect().top - box.getBoundingClientRect().top - 8,
    );
    lastTop.current = box.scrollTop;
  }, [results, follow, busy]);
  async function start() {
    if (locked.current || started || !allowed) return;
    locked.current = true;
    setStarted(true);
    setBusy(true);
    let pos = 0;
    const succeeded: string[] = [];
    function update(i: number, status: Result["status"], message?: string) {
      setResults((v) =>
        v.map((r, n) => (i === n ? { ...r, status, message } : r)),
      );
    }
    async function worker() {
      while (pos < rows.length) {
        const i = pos++,
          repo = rows[i]!;
        update(i, "同步中");
        let refreshing = false;
        try {
          if (!permission.current) {
            update(i, "失败", "当前不可管理此项目。");
            continue;
          }
          const current = await request<ProjectRepository>(
            base + "/" + repo.id,
          );
          if (!current.data.etag || !permission.current) {
            update(i, "失败", "当前不可同步，请刷新列表后核对状态与权限。");
            continue;
          }
          refreshing = true;
          await request(base + "/" + repo.id + "/refresh", {
            method: "POST",
            etag: current.data.etag,
            body: {},
          });
          update(i, "成功");
          succeeded.push(repo.id);
        } catch (e) {
          if (refreshing && writeOutcomeUnknown(e))
            update(i, "待核对", "未收到明确的同步结果，请核对最新快照。");
          else update(i, "失败", errorMessage(e));
        }
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, rows.length) }, worker),
      );
      onDone(succeeded);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const completed = results.filter(
    (r) => r.status !== "等待" && r.status !== "同步中",
  ).length;
  return (
    <FormDialog
      open
      title="同步仓库信息"
      description="从代码平台读取最新仓库资料，按仓库分别更新快照。"
      pending={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} variant="outline" onClick={onClose}>
            {started ? "关闭" : "取消"}
          </Button>
          {!started && (
            <Button disabled={!allowed} onClick={() => void start()}>
              开始同步
            </Button>
          )}
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p role="status" className="text-sm">
          已完成 {completed} / {rows.length} · 成功{" "}
          {results.filter((r) => r.status === "成功").length}
        </p>
        {busy && !follow && (
          <Button size="sm" variant="ghost" onClick={() => setFollow(true)}>
            跟随进度
          </Button>
        )}
      </div>
      <ul
        ref={list}
        className="max-h-[48dvh] divide-y overflow-y-auto"
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          if (top < lastTop.current - 1) setFollow(false);
          lastTop.current = top;
        }}
      >
        {results.map((r) => (
          <li
            key={r.repo.id}
            data-unfinished={r.status === "等待" || r.status === "同步中"}
            className="py-3"
          >
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="break-all">{r.repo.full_path}</span>
              <StatusText
                tone={
                  r.status === "待核对"
                    ? "warning"
                    : r.status === "失败"
                      ? "danger"
                      : r.status === "成功"
                        ? "success"
                        : r.status === "同步中"
                          ? "info"
                          : "neutral"
                }
              >
                {r.status}
              </StatusText>
            </div>
            {r.message && (
              <p
                className={
                  r.status === "待核对"
                    ? "mt-1 text-sm text-[var(--warning)]"
                    : "mt-1 text-sm text-destructive"
                }
              >
                {r.message}
              </p>
            )}
            {r.status === "待核对" && (
              <SnapshotReview path={base + "/" + r.repo.id} />
            )}
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
