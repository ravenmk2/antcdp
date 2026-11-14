import { useState, type ReactNode } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { MoreHorizontal, Play, Plus, Settings2, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { AsyncBoundary, EmptyState } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { MCPConfig, MCPServer } from "@/types/agent-resources";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import {
  EnabledState,
  ResourceSection,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import { useManagedList } from "@/features/agents/resources/use-managed-list";
import { PageHeader, Panel } from "@/components/layout";
import { TableToolbar } from "@/components/table-toolbar";
import { SimpleTable } from "@/components/table";
import { Pagination } from "@/components/pagination";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import {
  ResourceAuthenticationEditor,
  ResourceDelete,
} from "@/features/agents/resources/resource-actions";
import { DescriptionPreview } from "@/components/description-preview";
import { MCPAgents } from "@/features/agents/resources/mcp-agents";
import { MCPDebugWorkspace } from "@/features/agents/resources/mcp-debug";
const mcpKeys = ["agent-resources", "mcp"];
const blankConfig: MCPConfig = {
  url: "",
  transport: "streamable_http",
  timeout_seconds: 60,
  requested_protocol_versions: [],
};
function cleanConfig(config: MCPConfig): MCPConfig {
  return {
    ...config,
    url: config.url.trim(),
    requested_protocol_versions: config.requested_protocol_versions
      .map((v) => v.trim())
      .filter(Boolean),
  };
}
export function MCPServersPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const edit = params.get("edit"),
    agents = params.get("agents");
  const overlayLink = (key: string, id: string) => {
    const next = new URLSearchParams(params);
    next.delete("edit");
    next.delete("agents");
    next.set(key, id);
    return "/admin/mcp-servers?" + next.toString();
  };
  const closeOverlay = () =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.delete("edit");
      next.delete("agents");
      return next;
    });
  return (
    <>
      <MCPServerList
        title="MCP 服务"
        description="连接远端 MCP 端点，测试连接并单独调试工具。智能体按整个服务绑定权限。"
        path={agentAdminRoot + "/mcp-servers"}
        route="/admin/mcp-servers"
        preview={(server) => (
          <DescriptionPreview
            name={server.name}
            label="详细信息"
            triggerLabel={`查看 ${server.name} 的详细信息`}
            description={[
              server.description || "暂无说明",
              "",
              "端点：" + server.config.url,
              "认证：" +
                (server.authentication.auth_method === "custom_header"
                  ? "自定义 · " + server.authentication.header_name
                  : server.authentication.auth_method === "bearer"
                    ? "Bearer Token"
                    : "无需认证"),
              "超时：" + server.config.timeout_seconds + " 秒",
              "协议：" +
                (server.config.requested_protocol_versions.join("、") ||
                  "自动协商"),
              "关联智能体：" + server.agent_count,
              "更新时间：" + new Date(server.updated_at).toLocaleString(),
            ].join("\n")}
          />
        )}
        secondary={(server) => (
          <span className="font-mono" title={server.config.url}>
            {server.config.url}
          </span>
        )}
        columns={[
          {
            title: "认证方式",
            render: (server) =>
              server.authentication.auth_method === "custom_header" ? (
                <span>
                  自定义
                  <span className="mt-1 block font-mono text-xs text-muted">
                    {server.authentication.header_name}
                  </span>
                </span>
              ) : server.authentication.auth_method === "bearer" ? (
                "Bearer Token"
              ) : (
                "无需认证"
              ),
          },
          {
            title: "最近测试",
            render: (server) =>
              server.latest_test ? (
                <div className="space-y-1 text-sm">
                  <span
                    className={
                      server.latest_test.outdated
                        ? "text-muted"
                        : server.latest_test.status === "succeeded"
                          ? "text-success"
                          : "text-danger"
                    }
                  >
                    {server.latest_test.outdated
                      ? "配置已变化，待测试"
                      : server.latest_test.status === "succeeded"
                        ? "测试成功"
                        : "测试失败"}
                  </span>
                  <p className="text-xs text-muted">
                    {new Date(server.latest_test.finished_at).toLocaleString()}
                  </p>
                </div>
              ) : (
                <span className="text-muted">尚未测试</span>
              ),
          },
          {
            title: "关联智能体",
            render: (server) => (
              <Link
                className="text-primary hover:underline"
                to={overlayLink("agents", server.id)}
              >
                {server.agent_count}
              </Link>
            ),
          },
        ]}
        rowActions={(server) => (
          <ResourceDelete
            domain={agentAdminRoot}
            path={"/mcp-servers/" + server.id}
            scope={"mcp_server:" + server.id}
            command="mcp_server.delete"
            etag={JSON.stringify(server.version)}
            label={"服务“" + server.name + "”"}
            onDeleted={() =>
              void queryClient.invalidateQueries({
                queryKey: ["agent-resources"],
              })
            }
            trigger={(open, disabled) => (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={server.name + "更多操作"}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    render={
                      <Link to={"/admin/mcp-servers/" + server.id}>
                        <Play />
                        调试
                      </Link>
                    }
                  />
                  <DropdownMenuItem
                    render={
                      <Link to={overlayLink("edit", server.id)}>
                        <Settings2 />
                        编辑
                      </Link>
                    }
                  />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={open}>
                    <Trash2 />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        )}
      />
      {(edit || agents) && (
        <MCPManagementDrawer
          key={(edit ? "edit:" : "agents:") + (edit || agents)}
          serverId={(edit || agents)!}
          mode={edit ? "edit" : "agents"}
          onClose={closeOverlay}
        />
      )}
    </>
  );
}
function MCPConfigFields({
  value,
  onChange,
}: {
  value: MCPConfig;
  onChange: (value: MCPConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <Field
        label="MCP URL"
        hint="Streamable HTTP 端点地址。远端提供哪些资源和访问权限，由 MCP 服务端决定。"
      >
        <Input
          name="config.url"
          type="url"
          required
          value={value.url}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
      </Field>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          高级连接选项
        </summary>
        <div className="mt-4 grid grid-cols-[180px_1fr] gap-5">
          <Field label="调用超时（秒）">
            <Input
              type="number"
              required
              min={1}
              max={300}
              value={value.timeout_seconds}
              onChange={(e) =>
                onChange({ ...value, timeout_seconds: Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label="请求协商的协议版本"
            hint="每行一个版本，最多 8 项。留空使用平台支持的协议集合。"
          >
            <Textarea
              rows={3}
              value={value.requested_protocol_versions.join("\n")}
              onChange={(e) =>
                onChange({
                  ...value,
                  requested_protocol_versions: e.target.value.split("\n"),
                })
              }
            />
          </Field>
        </div>
      </details>
    </div>
  );
}
export function MCPServerCreatePage() {
  const [draft, setDraft] = useState({
      name: "",
      description: "",
      enabled: true,
      config: blankConfig,
    }),
    [method, setMethod] = useState("bearer"),
    [secret, setSecret] = useState(""),
    [header, setHeader] = useState("X-API-Key");
  const [connectAfterCreate, setConnectAfterCreate] = useState(true);
  const navigate = useNavigate(),
    action = useAgentCommand<MCPServer>("mcp:create");
  const dirty = Boolean(
    draft.name ||
    draft.description ||
    secret ||
    method !== "bearer" ||
    header !== "X-API-Key" ||
    JSON.stringify(draft.config) !== JSON.stringify(blankConfig),
  );
  const release = useUnsaved(dirty, action.pending || action.uncertain);
  useCommandResult(action.state, (server) => {
    release();
    setSecret("");
    action.command.reset();
    navigate(
      connectAfterCreate
        ? `/admin/mcp-servers/${server.id}?connect=1`
        : "/admin/mcp-servers",
      { replace: true },
    );
  });
  return (
    <>
      <MCPServersPage />
      <Drawer
        open
        wide
        title="新建 MCP 服务"
        description="凭据由系统统一管理，不会发送给模型或沙箱。"
        dirty={dirty}
        pending={action.pending || action.uncertain}
        onClose={() => {
          release();
          navigate("/admin/mcp-servers");
        }}
        footer={
          <>
            <OverlayCancelButton />
            <Button
              type="submit"
              form="mcp-create"
              variant="outline"
              disabled={action.pending || action.uncertain}
              onClick={() => setConnectAfterCreate(false)}
            >
              仅保存
            </Button>
            <Button
              type="submit"
              form="mcp-create"
              onClick={() => setConnectAfterCreate(true)}
              pending={action.pending}
              disabled={action.uncertain}
            >
              保存并连接
            </Button>
          </>
        }
      >
        <form
          id="mcp-create"
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void action.command.run({
              domain: agentAdminRoot,
              path: "/mcp-servers",
              command: "mcp_server.create",
              scope: "mcp_servers",
              options: {
                method: "POST",
                body: {
                  ...draft,
                  config: cleanConfig(draft.config),
                  authentication: {
                    auth_method: method,
                    header_name: method === "custom_header" ? header : null,
                    secret:
                      method === "none"
                        ? { operation: "clear" }
                        : { operation: "replace", value: secret },
                  },
                },
              },
            });
          }}
        >
          {action.recovery}
          <fieldset
            className="space-y-6"
            disabled={action.pending || action.uncertain}
          >
            <Field label="名称">
              <Input
                required
                autoFocus
                maxLength={100}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <MCPConfigFields
              value={draft.config}
              onChange={(config) => setDraft({ ...draft, config })}
            />
            <ResourceSection title="认证">
              <div className="grid grid-cols-2 gap-5">
                <Field label="认证方式">
                  <Select value={method} onValueChange={setMethod}>
                    <option value="bearer">Bearer Token</option>
                    <option value="custom_header">自定义</option>
                    <option value="none">无需认证</option>
                  </Select>
                </Field>
                {method === "custom_header" && (
                  <Field label="认证请求头">
                    <Input
                      required
                      maxLength={64}
                      value={header}
                      onChange={(event) => setHeader(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              {method !== "none" && (
                <Field label="认证凭据">
                  <Input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </Field>
              )}
            </ResourceSection>
            <Field label="管理说明">
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
          </fieldset>
        </form>
      </Drawer>
    </>
  );
}

export function MCPServerDetailPage() {
  const { serverId = "" } = useParams();
  const [params] = useSearchParams();
  const cache = useQueryClient();
  const query = useApiQuery<MCPServer>(
    [...mcpKeys, serverId],
    agentAdminRoot + "/mcp-servers/" + serverId,
  );
  const server = query.data?.data;
  if (params.get("tab") === "config" || params.get("tab") === "agents")
    return (
      <Navigate
        replace
        to={
          "/admin/mcp-servers?" +
          (params.get("tab") === "config" ? "edit=" : "agents=") +
          encodeURIComponent(serverId)
        }
      />
    );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {server && query.data && (
        <MCPDebugWorkspace
          key={server.id}
          server={server}
          etag={query.data.etag}
          onRefresh={() =>
            void cache.invalidateQueries({ queryKey: ["agent-resources"] })
          }
          autoConnect={params.get("connect") === "1"}
        />
      )}
    </AsyncBoundary>
  );
}

function MCPManagementDrawer({
  serverId,
  mode,
  onClose,
}: {
  serverId: string;
  mode: "edit" | "agents";
  onClose: () => void;
}) {
  const query = useApiQuery<MCPServer>(
    [...mcpKeys, serverId],
    agentAdminRoot + "/mcp-servers/" + serverId,
  );
  const cache = useQueryClient();
  const [auth, setAuth] = useState(false);
  const refresh = () =>
    void cache.invalidateQueries({ queryKey: ["agent-resources"] });
  if (mode === "edit" && query.data) {
    if (auth)
      return (
        <ResourceAuthenticationEditor
          domain={agentAdminRoot}
          path={"/mcp-servers/" + serverId}
          scope={"mcp_server:" + serverId}
          command="mcp_server.authentication"
          etag={query.data.etag}
          authentication={query.data.data.authentication}
          mcp
          drawer
          onClose={onClose}
          onSaved={refresh}
        />
      );
    return (
      <MCPServerEditor
        key={serverId}
        initial={query.data}
        onSaved={() => {
          refresh();
          onClose();
        }}
        onClose={onClose}
        onAuth={() => setAuth(true)}
      />
    );
  }
  return (
    <Drawer
      open
      wide
      title={mode === "agents" ? "关联智能体" : "编辑 MCP 服务"}
      description={query.data?.data.name}
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && mode === "agents" && <MCPAgents serverId={serverId} />}
      </AsyncBoundary>
    </Drawer>
  );
}
function MCPServerEditor({
  initial,
  onSaved,
  onClose,
  onAuth,
}: {
  initial: ApiResponse<MCPServer>;
  onSaved: () => void;
  onClose: () => void;
  onAuth: () => void;
}) {
  const from = (server: MCPServer) => ({
    name: server.name,
    description: server.description,
    config: server.config,
    enabled: server.enabled,
  });
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data));
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    initial,
    path: `${agentAdminRoot}/mcp-servers/${initial.data.id}`,
    dirty,
    adopt: (value) => {
      setDraft(from(value));
      setBaseline(from(value));
    },
    complete: onSaved,
  });
  return (
    <Drawer
      open
      wide
      title="编辑 MCP 服务"
      description={initial.data.name}
      dirty={dirty || save.blocked}
      pending={save.pending}
      onClose={() => {
        save.release();
        onClose();
      }}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            form="mcp-edit"
            type="submit"
            pending={save.pending}
            disabled={save.blocked || !dirty}
          >
            保存修改
          </Button>
        </>
      }
    >
      <form
        id="mcp-edit"
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save.save({ ...draft, config: cleanConfig(draft.config) });
        }}
      >
        {save.recovery}
        <div>
          <fieldset
            className="space-y-6"
            disabled={save.pending || save.blocked}
          >
            <div className="grid grid-cols-[1fr_auto] items-end gap-6">
              <Field label="名称">
                <Input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <label className="mb-2 flex items-center gap-3 text-sm">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                />
                启用服务
              </label>
            </div>
            <MCPConfigFields
              value={draft.config}
              onChange={(config) => setDraft({ ...draft, config })}
            />
            <Field label="管理说明">
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
          </fieldset>
        </div>
      </form>
      <section className="mt-7 border-t pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">认证凭据</h3>
            <p className="mt-1 text-xs text-muted">
              {initial.data.authentication.auth_method === "custom_header"
                ? "自定义 · " + initial.data.authentication.header_name
                : initial.data.authentication.auth_method === "bearer"
                  ? "Bearer Token"
                  : "无需认证"}{" "}
              ·{" "}
              {initial.data.authentication.has_secret ? "凭据已配置" : "无凭据"}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={dirty || save.pending || save.blocked}
            onClick={onAuth}
          >
            修改认证凭据
          </Button>
        </div>
        {dirty && (
          <p className="mt-2 text-xs text-muted">
            保存当前连接修改后，可继续修改认证凭据。
          </p>
        )}
      </section>
    </Drawer>
  );
}

function MCPServerList({
  title,
  description,
  path,
  route,
  extra,
  actions,
  label = (item) => item.name,
  extraHeading = "连接 / 版本",
  createLabel,
  columns,
  rowActions,
  secondary,
  nameHref,
  preview,
}: {
  title: string;
  description: string;
  path: string;
  route: string;
  extra?: (item: MCPServer) => ReactNode;
  actions?: ReactNode;
  label?: (item: MCPServer) => string;
  extraHeading?: string;
  createLabel?: string;
  columns?: { title: string; render: (item: MCPServer) => ReactNode }[];
  rowActions?: (item: MCPServer) => ReactNode;
  secondary?: (item: MCPServer) => ReactNode;
  nameHref?: (item: MCPServer) => string;
  preview?: (item: MCPServer) => ReactNode;
}) {
  const { page, size, change, enabled, search, list } =
    useManagedList<MCPServer>(path);
  return (
    <div className="page">
      <PageHeader title={title} description={description} actions={actions} />
      <Panel>
        <TableToolbar
          onRefresh={() => list.refetch()}
          refreshing={list.isFetching}
          onReset={() => change({ q: "", enabled: "", page: "1" })}
          actions={
            <Button
              render={
                <Link to={`${route}/new`}>
                  <Plus className="size-4" />
                  {createLabel ?? `新建${title}`}
                </Link>
              }
              nativeButton={false}
              role="link"
            />
          }
        >
          <StandaloneInput
            aria-label={`搜索${title}`}
            placeholder="搜索名称或说明"
            className="w-72"
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
          />
          <StandaloneSelect
            aria-label="启用状态"
            value={enabled}
            onValueChange={(value) => change({ enabled: value, page: "1" })}
          >
            <option value="all">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => list.refetch()}
        >
          {list.data?.data.length ? (
            <SimpleTable
              headers={[
                "名称与说明",
                ...(columns?.map((c) => c.title) ?? [extraHeading]),
                "状态",
                "操作",
              ]}
              label={title}
              actions
            >
              {list.data.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="max-w-lg">
                      <div className="flex items-center gap-2">
                        <Link
                          className="min-w-0 truncate font-medium text-primary hover:underline"
                          title={label(item)}
                          to={nameHref ? nameHref(item) : `${route}/${item.id}`}
                        >
                          {label(item)}
                        </Link>
                        {preview
                          ? preview(item)
                          : item.description && (
                              <DescriptionPreview
                                name={label(item)}
                                description={item.description}
                              />
                            )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                        {secondary
                          ? secondary(item)
                          : item.description || "暂无说明"}
                      </p>
                    </div>
                  </td>
                  {columns ? (
                    columns.map((column) => (
                      <td key={column.title}>{column.render(item)}</td>
                    ))
                  ) : (
                    <td>{extra?.(item)}</td>
                  )}
                  <td>
                    <EnabledState enabled={item.enabled} />
                  </td>
                  <td>
                    {rowActions ? (
                      rowActions(item)
                    ) : (
                      <Button
                        variant="ghost"
                        render={<Link to={`${route}/${item.id}`}>管理</Link>}
                        nativeButton={false}
                        role="link"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </SimpleTable>
          ) : (
            <EmptyState
              title={`暂无${title}`}
              description="可以创建第一项配置，或调整筛选条件。"
            />
          )}
          <Pagination
            page={page}
            size={size}
            total={list.data?.pagination?.total}
            pending={list.isFetching}
            onChange={(next, count) =>
              change({ page: String(next), page_size: String(count) })
            }
          />
        </AsyncBoundary>
      </Panel>
    </div>
  );
}
