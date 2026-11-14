import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Folder, File, FolderPlus, ChevronRight } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input } from "@/components/fields";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import {
  ConfirmDialog,
  Drawer,
  Modal,
  OverlayCancelButton,
} from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import type { Operation } from "@/types/agents";
import type {
  CloudOperationResult,
  CloudFileEntry,
  CloudComputer,
} from "@/types/cloud-computer";
import { agentRoot } from "../data/agent-api";
import { useAgentCommand, useCommandResult } from "../data/agent-runtime";
import { OccupancyView, SandboxOperationView, sandboxKeys } from "./shared";

export function WorkspaceFilesDrawer({
  computerId,
  onClose,
  readonly = false,
}: {
  computerId: string;
  onClose: () => void;
  readonly?: boolean;
}) {
  return (
    <Drawer
      open
      wide
      title="工作文件"
      description="当前云电脑数据卷内的文件。正式成果另存于平台，清理这里不会删除正式成果。"
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <WorkspaceFiles
        key={computerId}
        computerId={computerId}
        readonly={readonly}
      />
    </Drawer>
  );
}
export function WorkspaceFiles({
  computerId: initialComputerId,
  readonly = false,
}: {
  computerId: string;
  readonly?: boolean;
}) {
  const computerId = initialComputerId;
  const [path, setPath] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20),
    [create, setCreate] = useState(false),
    [remove, setRemove] = useState<CloudFileEntry | null>(null),
    [operation, setOperation] = useState<string | null>(null);
  const cache = useQueryClient();
  const query = useApiQuery<CloudFileEntry[]>(
    [...sandboxKeys, "entries", computerId, path, page, size],
    `${agentRoot}/cloud-computers/${computerId}/entries?${new URLSearchParams({ path, page: String(page), page_size: String(size) })}`,
  );
  const workspace = useQuery({
    queryKey: [...sandboxKeys, "workspace", computerId],
    queryFn: ({ signal }) =>
      request<CloudComputer>(`${agentRoot}/cloud-computers/${computerId}`, {
        signal,
      }),
    enabled: query.isFetched && !query.isFetching,
    retry: false,
    refetchInterval: (current) => {
      if (current.state.error) return 15000;
      const value = current.state.data?.data;
      return value &&
        (value.active_leases ||
          value.pending_transfers ||
          value.unknown_executions ||
          value.state === "provisioning")
        ? 3000
        : false;
    },
  });
  useEffect(() => {
    // Directory reads hold physical references themselves. Observe occupancy
    // after each read settles, then keep observing external work without
    // polling the directory and repeatedly acquiring more file references.
    if (!query.isFetched || query.isFetching) return;
    void cache.invalidateQueries({
      queryKey: [...sandboxKeys, "workspace", computerId],
      exact: true,
    });
  }, [
    cache,
    computerId,
    query.isFetched,
    query.isFetching,
    query.dataUpdatedAt,
    query.errorUpdatedAt,
  ]);
  const unavailable =
      query.isFetching ||
      query.isError ||
      workspace.isError ||
      workspace.data?.data.state !== "ready",
    busy = Boolean(
      workspace.data &&
      (workspace.data.data.active_leases ||
        workspace.data.data.pending_transfers ||
        workspace.data.data.unknown_executions),
    );
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: sandboxKeys });
  };
  const navigate = (next: string) => {
    setPath(next);
    setPage(1);
  };
  return (
    <div className="sandbox-workspace-files space-y-5">
      <AsyncBoundary
        loading={workspace.isPending}
        error={workspace.error}
        onRetry={() => workspace.refetch()}
      >
        {workspace.data && (
          <>
            <OccupancyView value={workspace.data.data} />
            {workspace.data.data.state !== "ready" && (
              <Notice tone="warning">
                工作空间当前
                {workspace.data.data.state === "provisioning"
                  ? "正在核实实际执行"
                  : "不可用"}
                。读取与维护仍以服务端核验为准。
              </Notice>
            )}
            {busy && (
              <Notice>
                活动任务、传输或待核实执行结束前不能创建目录、删除文件或维护云电脑。
              </Notice>
            )}
          </>
        )}
      </AsyncBoundary>
      <div className="sandbox-files-toolbar">
        <nav aria-label="工作目录" className="sandbox-files-breadcrumb">
          <Button variant="ghost" onClick={() => navigate("")}>
            /data
          </Button>
          {path
            .split("/")
            .filter(Boolean)
            .map((part, index, parts) => (
              <span key={index} className="flex min-w-0 items-center">
                <ChevronRight className="size-3 text-muted" />
                <Button
                  className="max-w-56 truncate"
                  variant="ghost"
                  title={part}
                  onClick={() => navigate(parts.slice(0, index + 1).join("/"))}
                >
                  {part}
                </Button>
              </span>
            ))}
        </nav>
        <div className="flex gap-2">
          <Button
            variant="outline"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新目录
          </Button>
          {!readonly && (
            <Button
              variant="outline"
              disabled={busy || unavailable}
              onClick={() => setCreate(true)}
            >
              <FolderPlus className="size-4" />
              新建目录
            </Button>
          )}
        </div>
      </div>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data?.data.length ? (
          <SimpleTable
            label="工作文件"
            className="sandbox-files-table"
            headers={["名称", "大小", "修改时间", "操作"]}
            actions
          >
            {query.data.data.map((entry) => (
              <tr key={entry.path}>
                <td>
                  <div className="flex min-w-0 items-center gap-3">
                    {entry.kind === "directory" ? (
                      <Folder className="size-4 shrink-0 text-muted" />
                    ) : (
                      <File className="size-4 shrink-0 text-muted" />
                    )}
                    {entry.kind === "directory" ? (
                      <Button
                        className="sandbox-file-name"
                        variant="ghost"
                        title={entry.name}
                        onClick={() => navigate(entry.path)}
                      >
                        {entry.name}
                      </Button>
                    ) : (
                      <span className="sandbox-file-name" title={entry.name}>
                        {entry.name}
                      </span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap text-muted">
                  {entry.size_bytes === null
                    ? "未提供"
                    : `${BigInt(entry.size_bytes).toLocaleString()} 字节`}
                </td>
                <td className="text-muted">
                  {entry.modified_at
                    ? new Date(entry.modified_at).toLocaleString()
                    : "未提供"}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    {entry.kind === "file" && (
                      <Button
                        render={
                          <a
                            href={`/api/v1${agentRoot}/cloud-computers/${computerId}/file-content?${new URLSearchParams({ path: entry.path, disposition: "attachment" })}`}
                            download
                          >
                            <Download className="size-4" />
                            下载
                          </a>
                        }
                        nativeButton={false}
                        role="link"
                        variant="ghost"
                      />
                    )}
                    {!readonly && (
                      <Button
                        variant="ghost"
                        disabled={busy || unavailable}
                        onClick={() => setRemove(entry)}
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </SimpleTable>
        ) : (
          <EmptyState
            title="当前目录没有文件"
            description="工作文件由任务执行产生，也可以在空闲时新建目录。"
          />
        )}
        <Pagination
          page={page}
          size={size}
          total={query.data?.pagination?.total}
          pending={query.isFetching}
          onChange={(next, count) => {
            setPage(next);
            setSize(count);
          }}
        />
      </AsyncBoundary>
      {operation && (
        <SandboxOperationView
          domain={agentRoot}
          id={operation}
          onSettled={() => refresh()}
          onClose={() => setOperation(null)}
        />
      )}
      {create && (
        <DirectoryCreate
          computerId={computerId}
          parentPath={path}
          onClose={() => setCreate(false)}
          onAccepted={(id) => {
            setOperation(id);
            setCreate(false);
            refresh();
          }}
        />
      )}
      {remove && (
        <WorkspaceMutation
          computerId={computerId}
          entry={remove}
          onClose={() => setRemove(null)}
          onAccepted={(id) => {
            setOperation(id);
            setRemove(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
function DirectoryCreate({
  computerId,
  parentPath,
  onClose,
  onAccepted,
}: {
  computerId: string;
  parentPath: string;
  onClose: () => void;
  onAccepted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const action = useAgentCommand<Operation>(`workspace:${computerId}:mkdir`);
  useCommandResult(action.state, (result) => {
    action.command.reset();
    onAccepted(result.id);
  });
  return (
    <Modal
      open
      title="新建目录"
      description={`创建位置：/data${parentPath ? `/${parentPath}` : ""}`}
      dirty={Boolean(name)}
      pending={action.pending || action.uncertain}
      onClose={onClose}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form="workspace-directory"
            pending={action.pending}
            disabled={action.uncertain}
          >
            创建目录
          </Button>
        </>
      }
    >
      <form
        id="workspace-directory"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void action.command.run({
            domain: agentRoot,
            path: `/cloud-computers/${computerId}/directories`,
            command: "workspace.mkdir",
            scope: `workspace:${computerId}`,
            options: {
              method: "POST",
              body: {
                path: [parentPath, name.trim()].filter(Boolean).join("/"),
              },
            },
          });
        }}
      >
        {action.recovery}
        <Field
          label="目录名称"
          hint="不覆盖已有文件，不允许使用 /、反斜杠、. 或 ..。"
        >
          <Input
            required
            pattern="[^/\\\\]+"
            maxLength={255}
            disabled={action.pending || action.uncertain}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
function WorkspaceMutation({
  computerId,
  entry,
  onClose,
  onAccepted,
}: {
  computerId: string;
  entry: CloudFileEntry;
  onClose: () => void;
  onAccepted: (id: string) => void;
}) {
  const action = useAgentCommand<Operation<CloudOperationResult>>(
    `cloud-files:${computerId}:remove`,
  );
  const [reading, setReading] = useState(false),
    [error, setError] = useState<unknown>();
  useCommandResult(action.state, (result) => {
    action.command.reset();
    onAccepted(result.id);
  });
  async function execute() {
    if (reading || action.pending || action.uncertain) return;
    setReading(true);
    setError(undefined);
    try {
      const current = await request<CloudComputer>(
        `${agentRoot}/cloud-computers/${computerId}`,
      );
      await action.command.run({
        domain: agentRoot,
        path: `/cloud-computers/${computerId}/file-removals`,
        command: "workspace.remove",
        scope: `workspace:${computerId}`,
        options: {
          method: "POST",
          etag: current.etag,
          body: {
            items: [{ path: entry.path, entry_token: entry.entry_token }],
            recursive: entry.kind === "directory",
          },
        },
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setReading(false);
    }
  }
  return (
    <ConfirmDialog
      open
      danger
      title={`删除${entry.kind === "directory" ? "目录及其内容" : "文件"}？`}
      description={`将删除 /data/${entry.path}。服务端会再次检查文件是否变化及活动引用；此操作无法撤销。`}
      confirmLabel="确认删除"
      pending={reading || action.pending || action.uncertain}
      onConfirm={() => void execute()}
      onClose={onClose}
    >
      <ErrorNotice error={error} />
      {action.recovery}
    </ConfirmDialog>
  );
}
