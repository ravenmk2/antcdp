import { useEffect, useState, type ReactNode } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  ListTree,
  LoaderCircle,
  MemoryStick,
  Monitor,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import type { CloudComputer, CloudFileEntry } from "@/types/cloud-computer";
import { agentRoot } from "../data/agent-api";
import { sandboxKeys, sandboxReason } from "../sandbox/shared";
import { DirectoryCreate, WorkspaceMutation } from "../sandbox/workspace-files";
import { CloudStatus } from "./computer-view";
import { FilePreview, fileFormat } from "./file-preview";
import "./computer-workbench.css";

export function ComputerWorkbench({
  computer,
  children,
}: {
  computer: CloudComputer | null;
  children?: (current: CloudComputer | null) => ReactNode;
}) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<CloudFileEntry | null>(null);
  const [directory, setDirectory] = useState("home");
  const [create, setCreate] = useState(false);
  const [remove, setRemove] = useState<CloudFileEntry | null>(null);
  const id = computer?.id || "";
  const workspace = useQuery({
    queryKey: [...sandboxKeys, "workspace", id],
    queryFn: ({ signal }) =>
      request<CloudComputer>(`${agentRoot}/cloud-computers/${id}`, { signal }),
    enabled: Boolean(id),
    retry: false,
    refetchInterval: (q) =>
      q.state.error ||
      q.state.data?.data.state === "provisioning" ||
      q.state.data?.data.active_leases ||
      q.state.data?.data.pending_transfers ||
      q.state.data?.data.unknown_executions
        ? 3000
        : 15000,
  });
  const current = workspace.data?.data || computer;
  const ready = current?.state === "ready";
  const [visitKey] = useState(() => crypto.randomUUID());
  const home = useQuery({
    queryKey: ["cloud-home", id, visitKey],
    queryFn: async () => {
      const result = await request<{ status: string; error_code?: string }>(
        `${agentRoot}/cloud-computers/${id}/home`,
        { method: "POST", body: {}, idempotencyKey: visitKey },
      );
      if (result.data.status !== "succeeded")
        throw new ApiError(
          result.data.error_code || "WORKSPACE_RECONCILING",
          "主目录准备尚未完成，请重试核实结果。",
        );
      return result;
    },
    enabled: Boolean(ready),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (homeBusy(q.state.error) ? 3000 : false),
  });
  const homeReady = home.isSuccess;
  const targetDirectory = useQuery({
    ...directoryQuery(id, directory, 1),
    enabled: Boolean(ready && homeReady),
  });
  const reading =
    useIsFetching({ queryKey: [...sandboxKeys, "tree", id] }) +
    useIsFetching({ queryKey: [...sandboxKeys, "preview", id] });
  const busy = Boolean(
    current?.active_leases ||
    current?.pending_transfers ||
    current?.unknown_executions,
  );
  const unavailable =
    !ready ||
    !homeReady ||
    busy ||
    Boolean(reading) ||
    workspace.isError ||
    !workspace.data;
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: sandboxKeys });
  };
  const completed = () => {
    if (remove) {
      if (
        selected &&
        (selected.path === remove.path ||
          selected.path.startsWith(`${remove.path}/`))
      )
        setSelected(null);
      if (directory === remove.path || directory.startsWith(`${remove.path}/`))
        setDirectory(remove.path.split("/").slice(0, -1).join("/"));
    }
    setCreate(false);
    setRemove(null);
    refresh();
  };
  return (
    <div className="cloud-workbench">
      <section className="cloud-explorer" aria-label="文件目录">
        <header className="cloud-pane-heading">
          <ListTree />
          <h2>文件目录</h2>
          <div className="ml-auto flex">
            <IconButton
              label="刷新目录"
              size="iconSm"
              disabled={!ready}
              pending={reading > 0}
              onClick={refresh}
            >
              <RefreshCw />
            </IconButton>
            <IconButton
              label="新建目录"
              size="iconSm"
              disabled={
                unavailable ||
                targetDirectory.isPending ||
                targetDirectory.isError
              }
              onClick={() => setCreate(true)}
            >
              <FolderPlus />
            </IconButton>
          </div>
        </header>
        <div className="cloud-explorer-location">
          <HardDrive className="size-4" />
          <span
            className="ml-auto truncate font-mono"
            title={`/data${directory && `/${directory}`}`}
          >
            /data{directory && `/${directory}`}
          </span>
        </div>
        <div className="cloud-tree-scroll">
          {ready ? (
            <>
              {home.isError && (
                <div className="p-3 text-xs">
                  {homeBusy(home.error) ? (
                    <Notice>电脑忙碌，空闲后自动准备主目录。</Notice>
                  ) : (
                    <>
                      <ErrorNotice error={home.error} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void home.refetch()}
                      >
                        重试准备主目录
                      </Button>
                    </>
                  )}
                </div>
              )}
              <Directory
                key={id}
                computerId={id}
                path=""
                name="data"
                depth={0}
                selected={selected}
                directory={directory}
                onDirectory={setDirectory}
                onSelect={setSelected}
                onRemove={setRemove}
                disabled={unavailable}
                prepared={homeReady}
                preparing={home.isFetching || homeBusy(home.error)}
              />
            </>
          ) : (
            <div className="p-5 text-sm leading-7 text-muted">
              电脑就绪后，可在这里浏览工作文件。
            </div>
          )}
        </div>
      </section>
      {ready ? (
        <FilePreview computerId={id} entry={selected} />
      ) : (
        <section className="cloud-preview" aria-label="文件预览">
          <header className="cloud-pane-heading">
            <Monitor />
            <h2>文件预览</h2>
          </header>
          <div className="cloud-preview-empty">
            <div className="cloud-preview-illustration">
              <Monitor strokeWidth={1.2} />
            </div>
            {children?.(current)}
          </div>
        </section>
      )}
      <aside className="cloud-inspector" aria-label="云电脑信息">
        <header className="cloud-pane-heading">
          <Monitor />
          <h2>云电脑信息</h2>
          <IconButton
            className="ml-auto"
            label="刷新状态"
            size="iconSm"
            pending={workspace.isFetching}
            onClick={() =>
              void cache.invalidateQueries({ queryKey: sandboxKeys })
            }
          >
            <RefreshCw />
          </IconButton>
        </header>
        <div className="cloud-inspector-scroll">
          {current ? (
            <ComputerInfo computer={current} />
          ) : (
            <div className="cloud-info-note">
              准备电脑后，在这里查看运行状态与资源配置。
            </div>
          )}
          <ErrorNotice error={workspace.error} />
          {busy && (
            <Notice>
              任务、传输或待核实执行结束后，可新建目录和删除文件。
            </Notice>
          )}
        </div>
      </aside>
      {create && (
        <DirectoryCreate
          computerId={id}
          parentPath={directory}
          onClose={() => setCreate(false)}
          onCompleted={completed}
        />
      )}
      {remove && (
        <WorkspaceMutation
          computerId={id}
          entry={remove}
          onClose={() => setRemove(null)}
          onCompleted={completed}
        />
      )}
    </div>
  );
}

function homeBusy(error: unknown) {
  return (
    error instanceof ApiError &&
    ["CLOUD_COMPUTER_BUSY", "WORKSPACE_BUSY"].includes(error.code)
  );
}

type DirectoryProps = {
  prepared: boolean;
  preparing?: boolean;
  computerId: string;
  path: string;
  name: string;
  depth: number;
  selected: CloudFileEntry | null;
  directory: string;
  disabled: boolean;
  onDirectory: (path: string) => void;
  onSelect: (entry: CloudFileEntry) => void;
  onRemove: (entry: CloudFileEntry) => void;
};
function directoryQuery(computerId: string, path: string, page: number) {
  return {
    queryKey: [...sandboxKeys, "tree", computerId, path, page],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      request<CloudFileEntry[]>(
        `${agentRoot}/cloud-computers/${computerId}/entries?${new URLSearchParams({ path, page: String(page), page_size: "100" })}`,
        { signal },
      ),
    retry: false,
    refetchOnWindowFocus: false,
  };
}
function Directory(props: DirectoryProps) {
  const {
    computerId,
    path,
    name,
    depth,
    selected,
    directory,
    disabled,
    onDirectory,
    onSelect,
    onRemove,
    prepared,
    preparing,
  } = props;
  const [expanded, setExpanded] = useState(depth === 0 || path === "home");
  const [page, setPage] = useState(1);
  const cache = useQueryClient();
  const query = useQuery({
    ...directoryQuery(computerId, path, page),
    enabled: expanded && prepared,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!query.isFetched || query.isFetching) return;
    void cache.invalidateQueries({
      queryKey: [...sandboxKeys, "workspace", computerId],
    });
  }, [
    cache,
    computerId,
    query.isFetched,
    query.isFetching,
    query.dataUpdatedAt,
    query.errorUpdatedAt,
  ]);
  const entries = [...(query.data?.data || [])].sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, "zh-CN", { numeric: true })
      : a.kind === "directory"
        ? -1
        : 1,
  );
  const total = query.data?.pagination?.total;
  const more =
    total !== undefined
      ? page * 100 < total
      : query.data?.pagination?.has_more || entries.length === 100;
  return (
    <div className="cloud-tree-directory">
      <button
        type="button"
        className="cloud-tree-item cloud-tree-folder"
        data-active={directory === path}
        style={{ paddingLeft: 12 + depth * 16 }}
        aria-expanded={expanded}
        aria-busy={query.isFetching || (depth === 0 && preparing)}
        title={`/data${path && `/${path}`}`}
        onClick={() => {
          setExpanded(!expanded);
          onDirectory(path);
        }}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
        {expanded ? (
          <FolderOpen className="cloud-folder-icon" />
        ) : (
          <Folder className="cloud-folder-icon" />
        )}
        <span>{name}</span>
        {(query.isFetching || (depth === 0 && preparing)) && (
          <LoaderCircle
            className="animate-spin"
            aria-label={`正在加载 ${name}`}
          />
        )}
      </button>
      {expanded && (
        <div role="group" aria-label={`${name} 目录内容`}>
          {query.isError && (
            <div className="px-3 py-1 text-xs">
              <ErrorNotice error={query.error} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void query.refetch()}
              >
                重试读取 {name}
              </Button>
            </div>
          )}
          {depth === 0 && prepared && (
            <Directory {...props} path="home" name="home" depth={1} />
          )}
          {entries
            .filter((entry) => depth !== 0 || entry.path !== "home")
            .map((entry) =>
              entry.kind === "directory" ? (
                <div className="cloud-tree-directory-row" key={entry.path}>
                  <Directory
                    {...props}
                    path={entry.path}
                    name={entry.name}
                    depth={depth + 1}
                  />
                  <IconButton
                    className="cloud-directory-delete"
                    label={`删除 ${entry.name}`}
                    size="iconSm"
                    disabled={disabled || query.isError}
                    onClick={() => onRemove(entry)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ) : (
                <div
                  key={entry.path}
                  className="cloud-tree-file-row"
                  data-selected={selected?.path === entry.path}
                >
                  <button
                    type="button"
                    className="cloud-tree-item"
                    style={{ paddingLeft: 28 + (depth + 1) * 16 }}
                    aria-pressed={selected?.path === entry.path}
                    title={entry.name}
                    onClick={() => {
                      onSelect(entry);
                      onDirectory(path);
                    }}
                  >
                    <FileIcon name={entry.name} />
                    <span>{entry.name}</span>
                  </button>
                  <IconButton
                    className="cloud-file-delete"
                    label={`删除 ${entry.name}`}
                    size="iconSm"
                    disabled={disabled || query.isError}
                    onClick={() => onRemove(entry)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ),
            )}
          {query.isSuccess && !entries.length && depth !== 0 && (
            <p
              className="cloud-tree-empty"
              style={{ paddingLeft: 30 + depth * 16 }}
            >
              空目录
            </p>
          )}
          {(page > 1 || more) && (
            <div className="cloud-tree-pages">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1 || query.isFetching}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span>{page}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!more || query.isFetching}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function FileIcon({ name }: { name: string }) {
  const kind = fileFormat(name).kind;
  if (["image", "svg"].includes(kind)) return <FileImage />;
  if (["html", "text"].includes(kind)) return <FileCode2 />;
  if (["markdown", "pdf"].includes(kind)) return <FileText />;
  return <File className="text-muted" />;
}
function ComputerInfo({ computer }: { computer: CloudComputer }) {
  const env = computer.effective_environment;
  const volumeState: Record<string, string> = {
    uninitialized: "尚未创建",
    ready: "可用",
    absent: computer.volume_id ? "已缺失" : "尚未创建",
    creating: "正在创建",
    deleted: "已删除",
    unknown: "待核实",
    pending: "等待创建",
  };
  return (
    <>
      <div className="cloud-machine-card">
        <div className="cloud-machine-icon">
          <Monitor />
        </div>
        <h3>我的专属云电脑</h3>
        <CloudStatus state={computer.state} />
        <p>交互会话共享 · 会话目录独立</p>
      </div>
      <section className="cloud-info-section">
        <h3>资源配置</h3>
        <div className="cloud-resource-grid">
          <div>
            <Cpu />
            <strong>
              {env ? env.cpu_millicores / 1000 : "—"}
              <small>核</small>
            </strong>
            <span>CPU</span>
          </div>
          <div>
            <MemoryStick />
            <strong>
              {env ? Number((env.memory_mib / 1024).toFixed(2)) : "—"}
              <small>GiB</small>
            </strong>
            <span>内存</span>
          </div>
        </div>
      </section>
      <section className="cloud-info-section">
        <h3>当前活动</h3>
        <dl className="cloud-facts">
          <div>
            <dt>活动轮次</dt>
            <dd>{computer.active_leases}</dd>
          </div>
          <div>
            <dt>文件传输</dt>
            <dd>{computer.pending_transfers}</dd>
          </div>
          <div>
            <dt>待核实执行</dt>
            <dd className={computer.unknown_executions ? "text-warning" : ""}>
              {computer.unknown_executions}
            </dd>
          </div>
        </dl>
      </section>
      <details className="cloud-info-section cloud-environment">
        <summary>
          环境与存储
          <ChevronRight />
        </summary>
        <dl className="cloud-facts cloud-facts-stacked">
          <div>
            <dt>运行镜像</dt>
            <dd>{env?.image || "尚未创建运行环境"}</dd>
          </div>
          <div>
            <dt>
              专属数据卷{" "}
              <span className="ml-2">
                {volumeState[computer.volume_state] || computer.volume_state}
              </span>
            </dt>
            <dd>{computer.volume_name || "按需创建"}</dd>
          </div>
          <div>
            <dt>最后活动</dt>
            <dd>{new Date(computer.last_activity_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt>云电脑 ID</dt>
            <dd className="font-mono">{computer.id}</dd>
          </div>
        </dl>
      </details>
      <div className="cloud-info-note">
        <HardDrive />
        <p>文件保存在专属数据卷中，供你的交互会话持续使用。</p>
      </div>
      <ErrorNotice
        error={
          computer.error_code ? sandboxReason(computer.error_code) : undefined
        }
      />
    </>
  );
}
