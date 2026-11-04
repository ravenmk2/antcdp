import { OperationStatus } from "@/components/platform/operation-status";
import { useState } from "react";
import {
  type Variant,
  type Environment,
  type Creation,
  type Page,
  labels,
} from "@/shared/delivery";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { useSubmission } from "@/components/platform/use-submission";
import {
  AsyncState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
import { Pagination } from "@/components/platform/pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CreationDrawer } from "./CreationDrawer";
export type Lifecycle = {
  action: "archive" | "restore" | "delete";
  item: Variant | Environment;
  environment?: boolean;
  collection?: string;
};
export function LifecycleDialog({
  project,
  variant,
  target,
  onClose,
  onSaved,
}: {
  project: string;
  variant?: Variant;
  target: Lifecycle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = target,
    remove = t.action === "delete",
    verb = remove ? "删除" : t.action === "archive" ? "归档" : "恢复",
    base =
      "/projects/" +
      project +
      "/variants" +
      (t.environment ? "/" + variant!.id + "/environments" : ""),
    save = useSubmission(),
    [error, setError] = useState("");
  async function submit() {
    setError("");
    await save.submit(
      async () => {
        const tag = remove
          ? t.collection ||
            (await request<Page<Variant>>(base)).data.mutation_version
          : undefined;
        if (remove && !tag) {
          setError("缺少集合版本，请重新读取。");
          return;
        }
        await request(base + "/" + t.item.id + (remove ? "" : "/" + t.action), {
          method: remove ? "DELETE" : "POST",
          etag: t.item.etag,
          headers: tag ? { "X-Collection-If-Match": tag } : undefined,
          body: remove ? undefined : {},
        });
        onSaved();
      },
      (e) => setError(errorMessage(e)),
    );
  }
  return (
    <FormDialog
      compact
      open
      title={verb + (t.environment ? "环境" : "变体")}
      description={t.item.name}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={save.pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={remove ? "destructive" : "default"}
            disabled={save.pending || save.blocked}
            onClick={() => void submit()}
          >
            确认{verb}
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      <p>
        {t.action === "archive"
          ? "归档后配置与环境只读。"
          : remove
            ? "删除本地配置后无法恢复。"
            : "恢复后可继续管理配置。"}
        远端分支保留。
      </p>
    </FormDialog>
  );
}
export function History({
  projectId,
  variant,
}: {
  projectId: string;
  variant: Variant;
}) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20),
    [id, setId] = useState(""),
    date = useDate();
  const query = useQuery<Page<Creation>>(
    "/projects/" +
      projectId +
      "/branch-creations?variant_id=" +
      variant.id +
      "&page=" +
      page +
      "&page_size=" +
      size,
  );
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">主干创建记录</h2>
        <RefreshButton loading={query.loading} onClick={query.refresh} />
      </header>
      <div className="overflow-hidden rounded-xl border bg-card">
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.refresh}
          empty={!query.data?.items.length}
        >
          <ul className="divide-y">
            {query.data?.items.map((c) => (
              <li key={c.id}>
                <button
                  className="flex w-full flex-wrap justify-between gap-2 px-4 py-3 text-left hover:bg-muted"
                  onClick={() => setId(c.id)}
                >
                  <span>
                    {c.target_branch}
                    <small className="block text-muted-foreground">
                      记录 {c.id} · {date(c.created_at)}
                    </small>
                  </span>
                  <span>
                    <OperationStatus value={c.expired ? "outdated" : c.status}>
                      {labels[c.status] || c.status}
                      {c.expired && " · 已过期"}
                    </OperationStatus>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </AsyncState>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={query.data.total}
            onChange={(n, s) => {
              setPage(n);
              setSize(s);
            }}
          />
        )}
      </div>
      {id && (
        <CreationDrawer
          projectId={projectId}
          variant={variant}
          initialId={id}
          onClose={() => setId("")}
          onChanged={query.refresh}
        />
      )}
    </section>
  );
}
export function SwitchVariant({
  projectId,
  onSelect,
  onClose,
}: {
  projectId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(""),
    [pages, setPages] = useState(1);
  return (
    <FormDialog
      open
      title="切换产品变体"
      description="搜索全部状态的变体，按需加载更多结果。"
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <Input
        type="search"
        aria-label="搜索可切换变体"
        value={q}
        placeholder="名称或编码"
        onChange={(e) => {
          setQ(e.target.value);
          setPages(1);
        }}
      />
      <div className="max-h-[48dvh] overflow-y-auto">
        {Array.from({ length: pages }, (_, i) => (
          <SwitchPage
            key={q + "-" + i}
            path={
              "/projects/" +
              projectId +
              "/variants?archived=all&page=" +
              (i + 1) +
              "&page_size=20&q=" +
              encodeURIComponent(q)
            }
            page={i + 1}
            last={i === pages - 1}
            onMore={() => setPages((n) => n + 1)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </FormDialog>
  );
}
function SwitchPage({
  path,
  page,
  last,
  onMore,
  onSelect,
}: {
  path: string;
  page: number;
  last: boolean;
  onMore: () => void;
  onSelect: (id: string) => void;
}) {
  const q = useQuery<Page<Variant>>(path);
  return (
    <AsyncState
      loading={q.loading}
      error={q.error}
      onRetry={q.refresh}
      empty={!q.data?.items.length}
    >
      {q.data?.items.map((v) => (
        <button
          key={v.id}
          className="flex w-full items-center justify-between gap-2 border-b p-3 text-left hover:bg-muted"
          onClick={() => onSelect(v.id)}
        >
          <span>
            {v.name}
            <small className="block text-muted-foreground">{v.code}</small>
          </span>
          {v.archived_at && <small>已归档</small>}
        </button>
      ))}
      {last && q.data && page * 20 < q.data.total && (
        <Button variant="ghost" onClick={onMore}>
          加载更多变体
        </Button>
      )}
    </AsyncState>
  );
}
