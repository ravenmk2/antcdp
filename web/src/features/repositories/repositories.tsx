import { TableToolbar } from "@/components/table-toolbar";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { request, isUncertain } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Field,
  Select,
  StandaloneInput,
  StandaloneSelect,
} from "@/components/fields";
import { DescriptionList } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { CopyButton } from "@/components/copy-button";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { formatDate } from "@/lib/utils";
import type {
  CursorPage,
  Diagnostic,
  ProjectRepository,
  RemoteRepository,
  RepositoryGroup,
  ServiceConnection,
} from "@/types/integrations";
import type { Page, Resource } from "@/types/collaboration";

export function ProjectRepositories({
  project,
  admin,
}: {
  project: Resource;
  admin: boolean;
}) {
  const [params, setParams] = useState({
    q: "",
    connection: "",
    page: 1,
    size: 20,
  });
  const [picker, setPicker] = useState(false);
  const [detail, setDetail] = useState<ProjectRepository | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [unlink, setUnlink] = useState<ProjectRepository[]>([]);
  const [sync, setSync] = useState<ProjectRepository[]>([]);
  const queryClient = useQueryClient();
  const path = `/projects/${project.id}/repositories?${new URLSearchParams({ q: params.q, connection_id: params.connection, page: String(params.page), page_size: String(params.size) })}`;
  const list = useApiQuery<Page<ProjectRepository>>(
    ["repositories", project.id, params],
    path,
  );
  const connections = useApiQuery<
    ServiceConnection[] | { items: ServiceConnection[] }
  >(
    ["repository-connections", project.id],
    `/admin/projects/${project.id}/repository-connections`,
    { enabled: admin },
  );
  const connectionItems = useMemo(() => {
    const data = connections.data?.data;
    return Array.isArray(data) ? data : (data?.items ?? []);
  }, [connections.data]);
  const rows = list.data?.data.items ?? [];
  const selectedRows = rows.filter((row) => selected.includes(row.id));
  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["repositories", project.id],
    });
  }
  function filter(next: Partial<typeof params>) {
    setParams((current) => ({ ...current, page: 1, ...next }));
    setSelected([]);
  }
  return (
    <section className="panel">
      <TableToolbar
        onReset={() => filter({ q: "", connection: "" })}
        onRefresh={() => void list.refetch()}
        refreshing={list.isFetching}
        actions={
          admin && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}
              >
                {selecting ? "退出批量操作" : "批量操作"}
              </Button>
              <Button
                disabled={project.status !== "active"}
                onClick={() => setPicker(true)}
              >
                <Plus />
                关联仓库
              </Button>
            </div>
          )
        }
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            filter({ q: String(data.get("q") ?? "") });
          }}
        >
          <StandaloneInput
            className="w-70"
            key={params.q}
            name="q"
            aria-label="搜索仓库"
            defaultValue={params.q}
            placeholder="搜索名称或完整路径"
          />
          <Button aria-label="搜索" type="submit" variant="outline">
            <Search />
          </Button>
        </form>
        <StandaloneSelect
          className="w-50"
          aria-label="连接筛选"
          value={params.connection}
          onValueChange={(value) => filter({ connection: value })}
        >
          <option value="">全部连接</option>
          {connectionItems.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </StandaloneSelect>
      </TableToolbar>
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-surface-subtle px-4 py-2 text-xs">
          <span>已选择 {selected.length} 项</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected.length}
            onClick={() => setSync(selectedRows)}
          >
            <RefreshCw />
            同步信息
          </Button>
          <Button
            size="sm"
            variant="dangerSoft"
            disabled={!selected.length}
            onClick={() => setUnlink(selectedRows)}
          >
            <Trash2 />
            解除关联
          </Button>
        </div>
      )}
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!rows.length}
        emptyTitle={
          params.q || params.connection ? "没有匹配的仓库" : "尚未关联 Git 仓库"
        }
        emptyDescription={
          params.q || params.connection
            ? "请调整筛选条件。"
            : admin
              ? "通过关联仓库建立本地快照；不会修改远端内容。"
              : "请联系系统管理员关联项目仓库。"
        }
      >
        <SimpleTable
          label={`${project.name} Git 仓库`}
          headers={[
            ...(selecting ? [""] : []),
            "仓库",
            "连接",
            "默认分支",
            "最近同步",
            "状态",
            "操作",
          ]}
        >
          {rows.map((repo) => (
            <tr key={repo.id}>
              {selecting && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${repo.full_path}`}
                    checked={selected.includes(repo.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, repo.id]
                          : selected.filter((id) => id !== repo.id),
                      )
                    }
                  />
                </td>
              )}
              <td>
                <button className="text-left" onClick={() => setDetail(repo)}>
                  <strong className="text-foreground">{repo.name}</strong>
                  <small className="mono mt-1 block break-all text-muted">
                    {repo.full_path}
                  </small>
                </button>
              </td>
              <td>
                {repo.connection_name}
                <small className="block text-xs text-muted">
                  {repo.connection_enabled ? "已启用" : "已停用"}
                </small>
              </td>
              <td className="mono">{repo.default_branch ?? "空仓库"}</td>
              <td className="text-xs text-muted">
                {formatDate(repo.last_synced_at)}
              </td>
              <td>
                <StatusBadge
                  tone={repo.remote_archived ? "warning" : "success"}
                >
                  {repo.remote_archived
                    ? "远端已归档"
                    : repo.remote_archived === null
                      ? "归档状态未知"
                      : "快照已记录"}
                </StatusBadge>
              </td>
              <td>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDetail(repo)}
                  >
                    详情
                  </Button>
                  {admin && (
                    <>
                      <IconButton
                        size="iconSm"
                        label={`同步 ${repo.full_path}`}
                        disabled={project.status !== "active"}
                        onClick={() => setSync([repo])}
                      >
                        <RefreshCw />
                      </IconButton>
                      <IconButton
                        size="iconSm"
                        label={`解除 ${repo.full_path}`}
                        disabled={project.status !== "active"}
                        onClick={() => setUnlink([repo])}
                      >
                        <Trash2 />
                      </IconButton>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      {list.data && (
        <Pagination
          page={params.page}
          size={params.size}
          total={list.data.data.total}
          pending={list.isFetching}
          onChange={(page, size) => setParams({ ...params, page, size })}
        />
      )}
      {picker && (
        <RepositoryPicker
          project={project}
          etag={list.data?.collectionEtag ?? ""}
          onClose={() => setPicker(false)}
          onSaved={refresh}
        />
      )}
      {detail && (
        <RepositoryDetail
          project={project}
          repository={detail}
          onClose={() => setDetail(null)}
        />
      )}
      {unlink.length > 0 && (
        <UnlinkDialog
          project={project}
          rows={unlink}
          etag={list.data?.collectionEtag ?? ""}
          onClose={() => setUnlink([])}
          onSaved={async () => {
            setUnlink([]);
            setSelected([]);
            await refresh();
          }}
        />
      )}
      {sync.length > 0 && (
        <SyncDialog
          project={project}
          rows={sync}
          onClose={() => setSync([])}
          onSaved={refresh}
        />
      )}
    </section>
  );
}

function RepositoryDetail({
  project,
  repository,
  onClose,
}: {
  project: Resource;
  repository: ProjectRepository;
  onClose: () => void;
}) {
  const detail = useApiQuery<ProjectRepository>(
    ["repository", project.id, repository.id],
    `/projects/${project.id}/repositories/${repository.id}`,
  );
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["repository-diagnostics", project.id, repository.id],
    `/projects/${project.id}/repositories/${repository.id}/diagnostics`,
  );
  const repo = detail.data?.data ?? repository;
  return (
    <Drawer
      open
      wide
      title={repo.name}
      description={repo.full_path}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <DescriptionList
        items={[
          {
            label: "完整路径",
            value: <span className="mono">{repo.full_path}</span>,
            full: true,
          },
          { label: "服务连接", value: repo.connection_name },
          { label: "默认分支", value: repo.default_branch ?? "空仓库" },
          { label: "最近快照", value: formatDate(repo.last_synced_at) },
          {
            label: "远端归档",
            value:
              repo.remote_archived === null
                ? "未知"
                : repo.remote_archived
                  ? "是"
                  : "否",
          },
        ]}
      />
      <section className="mt-6 border-t pt-5">
        <h3 className="mb-3 text-sm font-medium">克隆地址</h3>
        {[
          ["HTTPS", repo.http_clone_url],
          ["SSH", repo.ssh_clone_url],
          ["网页", repo.web_url],
        ].map(([label, value]) => (
          <div
            key={label}
            className="mb-2 flex items-center gap-2 rounded-lg bg-surface-subtle p-3"
          >
            <span className="w-12 text-xs text-muted">{label}</span>
            <code className="min-w-0 flex-1 break-all text-xs">
              {value || "未提供"}
            </code>
            {value && <CopyButton value={value} label={`复制 ${label} 地址`} />}
          </div>
        ))}
      </section>
      <section className="mt-6 border-t pt-5">
        <h3 className="mb-3 text-sm font-medium">同步诊断</h3>
        {diagnostics.isPending ? (
          <p className="text-sm text-muted">正在读取诊断…</p>
        ) : diagnostics.error ? (
          <ErrorNotice error={diagnostics.error} />
        ) : diagnostics.data?.data.latest ? (
          <Notice
            tone={
              diagnostics.data.data.latest.outdated
                ? "warning"
                : diagnostics.data.data.latest.status === "succeeded"
                  ? "success"
                  : "danger"
            }
          >
            {diagnostics.data.data.latest.outdated ? "历史结果 · " : ""}
            {diagnostics.data.data.latest.summary.reason ??
              diagnostics.data.data.latest.status}{" "}
            · {formatDate(diagnostics.data.data.latest.finished_at)}
          </Notice>
        ) : (
          <p className="text-sm text-muted">尚无同步诊断。</p>
        )}
      </section>
    </Drawer>
  );
}

function UnlinkDialog({
  project,
  rows,
  etag,
  onClose,
  onSaved,
}: {
  project: Resource;
  rows: ProjectRepository[];
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const submission = useSubmission();
  return (
    <ConfirmDialog
      open
      danger
      title={`解除 ${rows.length} 个仓库关联`}
      description={project.name}
      confirmLabel="确认解除关联"
      pending={submission.pending}
      onClose={onClose}
      onConfirm={() =>
        void submission.run(async () => {
          await request(`/projects/${project.id}/repositories/batch-unlink`, {
            method: "POST",
            etag,
            body: { ids: rows.map((row) => row.id) },
          });
          await onSaved();
        })
      }
    >
      <ErrorNotice error={submission.error} />
      <p className="text-sm text-muted">
        只删除本地关联，不删除远端仓库。请核对完整路径：
      </p>
      <ul className="mt-3 max-h-56 overflow-y-auto rounded-lg border p-3">
        {rows.map((row) => (
          <li key={row.id} className="mono break-all py-1 text-xs">
            {row.full_path}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

type SyncResult = {
  id: string;
  path: string;
  status: "pending" | "running" | "success" | "failed" | "unknown";
  message?: string;
};
function SyncDialog({
  project,
  rows,
  onClose,
  onSaved,
}: {
  project: Resource;
  rows: ProjectRepository[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [results, setResults] = useState<SyncResult[]>(
    rows.map((row) => ({ id: row.id, path: row.full_path, status: "pending" })),
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  async function execute(targets: ProjectRepository[]) {
    if (running) return;
    setRunning(true);
    setFinished(false);
    setResults(
      targets.map((row) => ({
        id: row.id,
        path: row.full_path,
        status: "pending",
      })),
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor++;
        const row = targets[index];
        if (!row) continue;
        setResults((current) =>
          current.map((item) =>
            item.id === row.id ? { ...item, status: "running" } : item,
          ),
        );
        try {
          const latest = await request<ProjectRepository>(
            `/projects/${project.id}/repositories/${row.id}`,
          );
          await request(
            `/projects/${project.id}/repositories/${row.id}/refresh`,
            { method: "POST", etag: latest.etag, body: {} },
          );
          setResults((current) =>
            current.map((item) =>
              item.id === row.id ? { ...item, status: "success" } : item,
            ),
          );
        } catch (error) {
          setResults((current) =>
            current.map((item) =>
              item.id === row.id
                ? {
                    ...item,
                    status: isUncertain(error) ? "unknown" : "failed",
                    message:
                      error instanceof Error ? error.message : "操作失败",
                  }
                : item,
            ),
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, targets.length) }, worker),
    );
    setRunning(false);
    setFinished(true);
    await onSaved();
  }
  return (
    <Modal
      open
      wide
      title="同步仓库信息"
      description="逐仓读取当前对象版本并刷新快照；关闭页面不会继续未开始项。"
      pending={running}
      onClose={onClose}
      footer={
        <>
          {!running &&
            finished &&
            results.some((item) => item.status === "failed") && (
              <Button
                variant="outline"
                onClick={() =>
                  void execute(
                    rows.filter(
                      (row) =>
                        results.find((item) => item.id === row.id)?.status ===
                        "failed",
                    ),
                  )
                }
              >
                重试已确认失败项
              </Button>
            )}
          <Button disabled={running} onClick={onClose}>
            {finished ? "完成" : "取消"}
          </Button>
          {!finished && (
            <Button pending={running} onClick={() => void execute(rows)}>
              开始同步
            </Button>
          )}
        </>
      }
    >
      <Notice>
        同步使用连接当前的系统首选凭证。成功、失败与结果未知逐仓记录，不提供跨仓原子回滚。
      </Notice>
      <ul className="mt-4 max-h-80 divide-y overflow-y-auto rounded-lg border">
        {results.map((result) => (
          <li key={result.id} className="flex items-start gap-3 p-3">
            <StatusBadge
              tone={
                result.status === "success"
                  ? "success"
                  : result.status === "failed"
                    ? "danger"
                    : result.status === "unknown"
                      ? "warning"
                      : result.status === "running"
                        ? "info"
                        : "neutral"
              }
            >
              {result.status === "success"
                ? "成功"
                : result.status === "failed"
                  ? "失败"
                  : result.status === "unknown"
                    ? "待核实"
                    : result.status === "running"
                      ? "同步中"
                      : "未开始"}
            </StatusBadge>
            <div className="min-w-0">
              <strong className="mono break-all text-xs">{result.path}</strong>
              {result.message && (
                <p className="mt-1 text-xs text-muted">{result.message}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function RepositoryPicker({
  project,
  etag,
  onClose,
  onSaved,
}: {
  project: Resource;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const connections = useApiQuery<
    ServiceConnection[] | { items: ServiceConnection[] }
  >(
    ["repository-connections", project.id],
    `/admin/projects/${project.id}/repository-connections`,
  );
  const connectionItems = Array.isArray(connections.data?.data)
    ? connections.data.data
    : (connections.data?.data.items ?? []);
  const [connection, setConnection] = useState("");
  const [group, setGroup] = useState<RepositoryGroup | null>(null);
  const [history, setHistory] = useState<RepositoryGroup[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [size, setSize] = useState(20);
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([""]);
  const [selected, setSelected] = useState<Map<string, RemoteRepository>>(
    new Map(),
  );
  const [viewSelected, setViewSelected] = useState(false);
  const [pendingConnection, setPendingConnection] = useState("");
  const submission = useSubmission();
  const errors = useFormErrors();
  const base = `/admin/projects/${project.id}/repository-connections/${connection}`;
  const repoParams = new URLSearchParams({
    q: search,
    page_size: String(size),
  });
  if (group) repoParams.set("container_id", group.id);
  if (recursive && group) repoParams.set("recursive", "true");
  if (cursor) repoParams.set("cursor", cursor);
  const repos = useApiQuery<CursorPage<RemoteRepository>>(
    [
      "remote-repos",
      project.id,
      connection,
      group?.id,
      search,
      recursive,
      size,
      cursor,
    ],
    `${base}/repos?${repoParams}`,
    { enabled: Boolean(connection) },
  );
  const groupParams = new URLSearchParams();
  if (group && !groupSearch) groupParams.set("parent_id", group.id);
  if (groupSearch) groupParams.set("q", groupSearch);
  const groups = useApiQuery<CursorPage<RepositoryGroup>>(
    ["remote-groups", project.id, connection, group?.id, groupSearch],
    `${base}/containers?${groupParams}`,
    { enabled: Boolean(connection) },
  );
  function resetBrowsing() {
    setGroup(null);
    setHistory([]);
    setSearch("");
    setQuery("");
    setGroupSearch("");
    setRecursive(false);
    setCursor("");
    setCursorHistory([""]);
  }
  function selectConnection(value: string) {
    if (selected.size && value !== connection) {
      setPendingConnection(value);
      return;
    }
    setConnection(value);
    resetBrowsing();
  }
  function changePage(page: number, nextSize: number) {
    if (nextSize !== size) {
      setSize(nextSize);
      setCursor("");
      setCursorHistory([""]);
    } else if (page <= cursorHistory.length) {
      const history = cursorHistory.slice(0, page);
      setCursorHistory(history);
      setCursor(history.at(-1) ?? "");
    } else if (repos.data?.data.next_cursor) {
      setCursorHistory((current) => [...current, repos.data.data.next_cursor!]);
      setCursor(repos.data.data.next_cursor);
    }
  }
  async function save() {
    if (!selected.size) {
      errors.setError("请至少选择一个仓库。");
      return;
    }
    const ok = await submission.run(
      async () => {
        await request(`/projects/${project.id}/repositories`, {
          method: "POST",
          etag,
          body: { connection_id: connection, repo_ids: [...selected.keys()] },
        });
        await onSaved();
        onClose();
      },
      (error) => errors.show(error, ["connection_id", "repo_ids"]),
    );
    if (!ok) return;
  }
  const visibleSelected = [...selected.values()];
  return (
    <Drawer
      open
      wide
      title="关联 GitLab 仓库"
      description={`${project.name} · 每批最多 100 项，跨页选择会保留`}
      dirty={selected.size > 0}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            已选 {selected.size} 项
          </span>
          <Button
            variant="ghost"
            onClick={() => setViewSelected(!viewSelected)}
          >
            {viewSelected ? "返回结果" : "查看已选"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            pending={submission.pending}
            disabled={!selected.size || !etag}
            onClick={() => void save()}
          >
            确认关联
          </Button>
        </>
      }
    >
      <ErrorNotice error={errors.error} />
      <ErrorNotice error={submission.error} />
      <Field
        label="服务连接"
        required
        hint="远端操作只使用该连接当前的系统首选凭证"
      >
        <Select
          value={connection}
          onValueChange={(value) => selectConnection(value)}
        >
          <option value="">请选择连接</option>
          {connectionItems.map((item) => (
            <option key={item.id} value={item.id} disabled={!item.enabled}>
              {item.name}
              {item.enabled ? "" : "（已停用）"}
            </option>
          ))}
        </Select>
      </Field>
      {connection && (
        <div className="mt-5 grid min-h-96 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-lg border bg-surface-subtle p-2">
            <div className="mb-2 flex items-center gap-1">
              {history.length > 0 && (
                <IconButton
                  size="iconSm"
                  label="上一级分组"
                  onClick={() => {
                    const next = [...history];
                    const previous = next.pop();
                    setHistory(next);
                    setGroup(previous ?? null);
                    setCursor("");
                    setCursorHistory([""]);
                  }}
                >
                  <ArrowLeft />
                </IconButton>
              )}
              <strong className="truncate text-xs">
                {group?.full_path ?? "全部分组"}
              </strong>
            </div>
            <StandaloneInput
              aria-label="搜索远端分组"
              className="mb-2 min-h-8 text-xs"
              placeholder="搜索分组"
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
            <button
              className="mb-1 w-full rounded-md px-2 py-2 text-left text-xs hover:bg-surface-hover"
              onClick={() => {
                setGroup(null);
                setHistory([]);
                setCursor("");
                setCursorHistory([""]);
              }}
            >
              全部仓库
            </button>
            <ul>
              {groups.data?.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="flex w-full items-center gap-1 rounded-md px-2 py-2 text-left text-xs hover:bg-surface-hover"
                    onClick={() => {
                      setHistory([...history, ...(group ? [group] : [])]);
                      setGroup(item);
                      setGroupSearch("");
                      setCursor("");
                      setCursorHistory([""]);
                    }}
                  >
                    <ChevronRight className="size-3" />
                    <span className="min-w-0 break-all">{item.full_path}</span>
                  </button>
                </li>
              ))}
            </ul>
            {groups.isPending && (
              <p className="p-3 text-xs text-muted">加载分组…</p>
            )}
            {groups.error && <ErrorNotice error={groups.error} />}
          </aside>
          <section className="flex min-w-0 flex-col rounded-lg border">
            <div className="border-b p-3">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(query.trim());
                  setCursor("");
                  setCursorHistory([""]);
                }}
              >
                <StandaloneInput
                  aria-label="搜索远端仓库"
                  placeholder={group ? "搜索当前组" : "搜索整个连接"}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button type="submit" variant="outline">
                  搜索
                </Button>
              </form>
              {group && (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={recursive}
                    onChange={(event) => {
                      setRecursive(event.target.checked);
                      setCursor("");
                      setCursorHistory([""]);
                    }}
                  />
                  包含子组
                </label>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {viewSelected ? (
                <RepositoryChoices
                  rows={visibleSelected}
                  selected={selected}
                  onChange={setSelected}
                />
              ) : repos.isPending ? (
                <p className="p-5 text-sm text-muted">正在读取远端仓库…</p>
              ) : repos.error ? (
                <ErrorNotice error={repos.error} />
              ) : (
                <RepositoryChoices
                  rows={repos.data?.data.items ?? []}
                  selected={selected}
                  onChange={setSelected}
                />
              )}
            </div>
            {!viewSelected && repos.data && !repos.error && (
              <Pagination
                page={cursorHistory.length}
                size={size}
                hasNext={Boolean(repos.data.data.next_cursor)}
                pending={repos.isFetching || submission.pending}
                onChange={changePage}
              />
            )}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingConnection)}
        title="切换连接并清空选择？"
        description="不同连接的远端仓库 ID 不能混合提交。"
        confirmLabel="切换并清空"
        onClose={() => setPendingConnection("")}
        onConfirm={() => {
          setConnection(pendingConnection);
          setSelected(new Map());
          setPendingConnection("");
          resetBrowsing();
        }}
      />
    </Drawer>
  );
}

function RepositoryChoices({
  rows,
  selected,
  onChange,
}: {
  rows: RemoteRepository[];
  selected: Map<string, RemoteRepository>;
  onChange: (value: Map<string, RemoteRepository>) => void;
}) {
  if (!rows.length)
    return (
      <p className="p-8 text-center text-sm text-muted">
        当前范围没有可展示的仓库。
      </p>
    );
  return (
    <ul className="divide-y">
      {rows.map((repo) => (
        <li key={repo.repo_id}>
          <label className="flex items-start gap-3 p-3 hover:bg-surface-hover">
            <input
              type="checkbox"
              className="mt-1"
              disabled={repo.already_linked}
              checked={selected.has(repo.repo_id)}
              onChange={(event) => {
                const next = new Map(selected);
                if (event.target.checked) next.set(repo.repo_id, repo);
                else next.delete(repo.repo_id);
                onChange(next);
              }}
            />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm">{repo.name}</strong>
              <small className="mono block break-all text-muted">
                {repo.full_path}
              </small>
              {repo.remote_archived && (
                <StatusBadge tone="warning">远端已归档</StatusBadge>
              )}
            </div>
            {repo.already_linked ? (
              <StatusBadge>已关联</StatusBadge>
            ) : selected.has(repo.repo_id) ? (
              <Check className="size-4 text-success" />
            ) : null}
          </label>
        </li>
      ))}
    </ul>
  );
}
