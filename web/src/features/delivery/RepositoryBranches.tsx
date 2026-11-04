import { useOperationToast } from "@/components/platform/operation-toast";
import { OperationStatus } from "@/components/platform/operation-status";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  type Variant,
  type Environment,
  type Repository,
  type Page,
  labels,
  reason,
  matchSources,
} from "@/shared/delivery";
import { useQuery } from "@/lib/use-query";
import { request, errorMessage } from "@/lib/api";
import { writeRequiresReview } from "@/lib/write-error";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import {
  AsyncState,
  ErrorBox,
  RefreshButton,
  EmptyState,
} from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/platform/pagination";
import {
  Table,
  TableRow,
  TableHead,
  TableHeader,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { CreationDrawer } from "./CreationDrawer";
export function RepositoryBranches({
  projectId,
  variant,
  environment,
  allowed,
  creationMode = false,
  historyAction,
  onConfigureScope,
  projectRepositoryHref,
}: {
  projectId: string;
  variant: Variant;
  environment?: Environment;
  allowed: boolean;
  creationMode?: boolean;
  historyAction?: ReactNode;
  onConfigureScope?: () => void;
  projectRepositoryHref?: string;
}) {
  const path =
      "/projects/" +
      projectId +
      "/variants/" +
      variant.id +
      (environment ? "/environments/" + environment.id : ""),
    subject = environment || variant,
    branch = environment?.branch_name || variant.main_branch;
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20),
    [pick, setPick] = useState<{
      token: string;
      rows: Map<string, Repository>;
    }>({ token: "", rows: new Map() }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [draft, setDraft] = useState<{ items: Repository[]; scope: string }>();
  const query = useQuery<Page<Repository>>(
      path + "/repositories?page=" + page + "&page_size=" + size,
      subject.etag,
    ),
    data = query.data,
    token = data?.scope_token || "",
    rows = data?.items || [],
    selected = pick.token === token ? pick.rows : new Map<string, Repository>(),
    locked = useRef(false),
    count = rows.filter((r) => selected.has(r.id)).length;
  const writable =
    allowed &&
    variant.can_manage &&
    !variant.archived_at &&
    subject.binding_validity === "valid" &&
    !!data?.can_manage;
  useNavigationProtection(busy ? "pending" : undefined);
  useEffect(() => {
    if (token && pick.token && pick.token !== token && pick.rows.size) {
      setNotice("仓库范围已变化，请重新选择。");
      setPick({ token, rows: new Map() });
    }
  }, [token, pick]);
  function change(items: Repository[], on: boolean) {
    if (!token || !writable || busy) return;
    const next = new Map(selected);
    for (const r of items) {
      if (on) next.set(r.id, r);
      else next.delete(r.id);
    }
    if (next.size > 100) {
      setError("每批最多选择 100 个仓库。");
      return;
    }
    setError("");
    setPick({ token, rows: next });
  }
  const notify = useOperationToast();
  async function check() {
    if (locked.current || !writable || !selected.size || !token || review)
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      notify("已开始校验所选分支。", "info");
      const { data: result } = await request<{
        counts: Record<string, number>;
      }>(path + "/check-branches", {
        method: "POST",
        etag: subject.etag,
        body: { repository_ids: [...selected.keys()], scope_token: token },
      });
      if (result.counts.exists === selected.size) {
        setNotice("");
        notify("所选仓库的目标分支均已确认存在。");
      } else {
        const message =
          result.counts.missing === selected.size
            ? "所选仓库均未找到目标分支。"
            : `已确认 ${result.counts.exists ?? 0} / ${selected.size} 个仓库存在目标分支，请查看校验结果。`;
        setNotice(message);
        notify(message, "warning");
      }
      query.refresh();
    } catch (e) {
      setError(errorMessage(e));
      const uncertain = writeRequiresReview(e);
      setReview(uncertain);
      notify(
        uncertain
          ? "未能确认校验结果，请刷新核对。"
          : "分支校验失败，请查看原因。",
        uncertain ? "warning" : "danger",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function refresh() {
    setError("");
    setReview(false);
    query.refresh();
  }
  return (
    <section className="space-y-4" aria-label="仓库分支">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">
          {creationMode ? "选择创建目标" : "仓库与分支"}
        </h3>
        {historyAction}
        <RefreshButton loading={query.loading || busy} onClick={refresh} />
        {writable && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected.size || busy || review || !token}
              onClick={() => void check()}
            >
              校验所选分支
            </Button>
            {!environment && (
              <Button
                size="sm"
                disabled={!selected.size || busy || !token}
                onClick={() =>
                  setDraft({ items: [...selected.values()], scope: token })
                }
              >
                {creationMode ? "下一步：设置来源" : "创建主干分支"}
              </Button>
            )}
          </>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        固定分支 <code>{branch}</code>
        {writable && " · 已选 " + selected.size + " / 100"}
        {selected.size > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setPick({ token, rows: new Map() })}
          >
            清空选择
          </Button>
        )}
      </p>
      {writable && rows.length > 0 && !selected.size && (
        <p className="text-sm text-muted-foreground">
          先选择仓库，再校验远端分支{!environment && "或创建主干"}
          。刷新仅加载已保存的校验结果。
        </p>
      )}
      <ErrorBox tone={review ? "warning" : "danger"}>{error}</ErrorBox>
      {notice && (
        <p
          role="status"
          data-feedback-tone="warning"
          className="rounded-lg border p-3 text-sm"
        >
          {notice}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={refresh}
          empty={!rows.length}
          emptyContent={
            <EmptyState
              title="当前范围内没有仓库"
              description={
                allowed && variant.can_manage
                  ? "先确认项目已关联代码仓库，再检查此范围是否包含所需仓库。关联仓库由系统管理员管理。"
                  : "此范围尚未包含仓库，项目管理员可检查范围设置，系统管理员可关联项目仓库。"
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {onConfigureScope && (
                    <Button variant="outline" onClick={onConfigureScope}>
                      检查仓库范围
                    </Button>
                  )}
                  {projectRepositoryHref && (
                    <Button variant="ghost" asChild>
                      <Link to={projectRepositoryHref}>查看项目仓库</Link>
                    </Button>
                  )}
                </div>
              }
            />
          }
        >
          <Table aria-label="仓库与分支">
            <TableHeader>
              <TableRow>
                {writable && (
                  <TableHead>
                    <Checkbox
                      aria-label="选择当前页仓库"
                      disabled={busy}
                      checked={
                        count > 0 && count < rows.length
                          ? "indeterminate"
                          : count > 0
                      }
                      onCheckedChange={(v) => change(rows, v === true)}
                    />
                  </TableHead>
                )}
                <TableHead>仓库</TableHead>
                <TableHead>范围来源</TableHead>
                <TableHead>分支状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const check = r.check;
                return (
                  <TableRow key={r.id}>
                    {writable && (
                      <TableCell>
                        <Checkbox
                          disabled={busy}
                          aria-label={"选择 " + r.full_path}
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => change([r], v === true)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      {r.full_path}
                      <small className="block text-muted-foreground">
                        {r.connection_name}
                      </small>
                    </TableCell>
                    <TableCell>{matchSources(r.match_sources)}</TableCell>
                    <TableCell>
                      <OperationStatus
                        value={
                          check &&
                          (check.outdated || check.branch_name !== branch)
                            ? "outdated"
                            : check?.status || "unchecked"
                        }
                      >
                        {check
                          ? check.outdated || check.branch_name !== branch
                            ? "需重新校验"
                            : labels[check.status] || check.status
                          : "未校验"}
                      </OperationStatus>
                      {check && (
                        <details className="mt-1 text-xs">
                          <summary>历史详情</summary>
                          <p className="whitespace-normal break-all">
                            {check.branch_name} · {reason(check.reason)} ·{" "}
                            {check.commit_id || "无提交记录"} ·{" "}
                            {check.finished_at}
                          </p>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AsyncState>
        {data && (
          <Pagination
            page={page}
            size={size}
            total={data.total}
            pending={busy || query.loading}
            onChange={(p, s) => {
              setPage(p);
              setSize(s);
            }}
          />
        )}
      </div>
      {draft && (
        <CreationDrawer
          projectId={projectId}
          variant={variant}
          selection={draft}
          allowed={allowed}
          onClose={() => setDraft(undefined)}
          onChanged={query.refresh}
        />
      )}
    </section>
  );
}
