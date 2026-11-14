import { useState, type FormEvent } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ArrowLeft,
  Play,
  FileText,
  Folder,
  Bot,
  SlidersHorizontal,
  Wrench,
  ShieldCheck,
  MoreHorizontal,
  Trash2,
  Pencil,
  Eye,
  Plug,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/button";
import { DescriptionPreview } from "@/components/description-preview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import { PageHeader, Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { useDebouncedSearch } from "@/hooks/use-search";
import type { ApiResponse } from "@/api/client";
import type {
  AgentDefinition,
  AgentType,
  AgentScope,
  AgentSummary,
} from "@/types/agents";
import {
  agentAdminRoot,
  agentKeys,
  agentQuery,
} from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import {
  EnabledState,
  ConfigActions,
  ResourceDescription,
  IdentityBadge,
  ResourceSection,
  useListParams,
  useResourceSave,
  scopeLabel,
} from "@/features/agents/resources/admin-shared";
import { AgentModelBindings } from "@/features/agents/resources/model-bindings";
import { AgentMCPBindings } from "@/features/agents/resources/mcp-bindings";
import { AgentToolBindings } from "@/features/agents/resources/tool-bindings";
import { AgentRuntimePolicy } from "@/features/agents/resources/runtime-policy";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import type { Resource } from "@/types/collaboration";
import { AgentSkillBindings } from "@/features/agents/resources/skill-bindings";
import { RobotResources } from "@/features/agents/resources/robot-resources";
import { CloudTemplateEditor } from "@/features/agents/cloud/template-editor";
import { AgentOverview, AgentActivation } from "./agent-overview";

export function AgentsPage() {
  const { params, page, size, change } = useListParams();
  const q = params.get("q") ?? "",
    mode = params.get("agent_type") ?? "all",
    scope = params.get("scope_kind") ?? "all",
    enabled = params.get("enabled") ?? "all";
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = agentQuery({
    q,
    agent_type: mode,
    scope_kind: scope,
    enabled,
    page,
    page_size: size,
  });
  const agents = useApiQuery<AgentSummary[]>(
    [...agentKeys, "definitions", query],
    `${agentAdminRoot}/definitions?${query}`,
  );
  return (
    <div className="page">
      <PageHeader
        title="智能体管理"
        description="配置智能体归属和能力。交互型使用对话用户身份，服务型使用专属机器人身份。"
      />
      <Panel>
        <TableToolbar
          onRefresh={() => agents.refetch()}
          refreshing={agents.isFetching}
          onReset={() =>
            change({
              q: "",
              agent_type: "",
              scope_kind: "",
              enabled: "",
              page: "1",
            })
          }
          actions={
            <Button
              render={
                <Link to="/admin/agents/new">
                  <Plus className="size-4" />
                  新建智能体
                </Link>
              }
              nativeButton={false}
              role="link"
            />
          }
        >
          <StandaloneInput
            aria-label="搜索智能体"
            placeholder="搜索名称或说明"
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
            className="w-64"
          />
          <StandaloneSelect
            aria-label="类型"
            value={mode}
            onValueChange={(value) => change({ agent_type: value, page: "1" })}
          >
            <option value="all">全部类型</option>
            <option value="interactive">交互型</option>
            <option value="service">服务型</option>
          </StandaloneSelect>
          <StandaloneSelect
            aria-label="归属"
            value={scope}
            onValueChange={(value) => change({ scope_kind: value, page: "1" })}
          >
            <option value="all">全部归属</option>
            <option value="platform">平台</option>
            <option value="team">团队</option>
            <option value="project">项目</option>
          </StandaloneSelect>
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
          loading={agents.isPending}
          error={agents.error}
          onRetry={() => agents.refetch()}
        >
          {agents.data?.data.length ? (
            <SimpleTable
              label="智能体列表"
              headers={[
                "智能体",
                "类型",
                "归属",
                "模型 / 工具",
                "状态",
                "操作",
              ]}
              actions
            >
              {agents.data.data.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/admin/agents/${agent.id}`}
                        className="max-w-lg truncate font-medium text-primary"
                        title={agent.name}
                      >
                        {agent.name}
                      </Link>
                      {agent.description && (
                        <DescriptionPreview
                          name={agent.name}
                          description={agent.description}
                        />
                      )}
                    </div>
                    <p
                      className="mt-1 max-w-xl truncate text-xs text-muted"
                      title={agent.description}
                    >
                      {agent.description || "暂无说明"}
                    </p>
                  </td>
                  <td>
                    <IdentityBadge mode={agent.agent_type} />
                  </td>
                  <td>
                    {scopeLabel(agent.scope_kind)}
                    <p className="mt-1 text-xs text-muted">
                      {agent.scope_id ? `ID ${agent.scope_id}` : "所有登录用户"}
                    </p>
                  </td>
                  <td>
                    <span className="inline-flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        <strong className="font-medium text-foreground">
                          {agent.model_binding_count}
                        </strong>{" "}
                        个模型
                      </span>
                      <span>
                        <strong className="font-medium text-foreground">
                          {agent.tool_binding_count} / MCP{" "}
                          {agent.mcp_binding_count}
                        </strong>{" "}
                        项工具
                      </span>
                    </span>
                  </td>
                  <td>
                    <EnabledState enabled={agent.enabled} />
                  </td>
                  <td>
                    <Button
                      render={
                        <Link to={`/admin/agents/${agent.id}`}>配置</Link>
                      }
                      nativeButton={false}
                      role="link"
                      variant="link"
                    />
                  </td>
                </tr>
              ))}
            </SimpleTable>
          ) : (
            <EmptyState
              title="暂无匹配的智能体"
              description="创建后配置模型与权限，再开放使用。"
            />
          )}
          <Pagination
            page={page}
            size={size}
            total={agents.data?.pagination?.total}
            pending={agents.isFetching}
            onChange={(next, count) =>
              change({ page: String(next), page_size: String(count) })
            }
          />
        </AsyncBoundary>
      </Panel>
    </div>
  );
}

export function AgentCreatePage() {
  const navigate = useNavigate(),
    errors = useFormErrors();
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    agent_type: "interactive" as AgentType,
    scope_kind: "platform" as AgentScope,
    scope_id: null as string | null,
  });
  const [picking, setPicking] = useState(false),
    [scopeName, setScopeName] = useState("");
  const { command, state, pending, uncertain, recovery } =
    useAgentCommand<AgentDefinition>("agent:create");
  const dirty = Boolean(
    draft.name ||
    draft.description ||
    draft.agent_type !== "interactive" ||
    draft.scope_kind !== "platform",
  );
  const release = useUnsaved(dirty, pending || uncertain);
  useCommandResult(state, (agent) => {
    release();
    command.reset();
    navigate(`/admin/agents/${agent.id}`, { replace: true });
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    errors.clear();
    if (
      !errors.validate({
        name: draft.name.trim() ? "" : "请输入智能体名称",
        scope_id:
          draft.scope_kind !== "platform" && !draft.scope_id
            ? "请选择归属"
            : "",
      })
    )
      return;
    await command.run({
      domain: agentAdminRoot,
      path: "/definitions",
      command: "agent_definition.create",
      scope: "agent_definitions",
      options: { method: "POST", body: { ...draft, enabled: false } },
    });
    if (command.getSnapshot().phase === "failed")
      errors.show(command.getSnapshot().error, [
        "name",
        "description",
        "scope_id",
        "scope_kind",
      ]);
  }
  return (
    <>
      <AgentsPage />
      <Drawer
        open
        title="新建智能体"
        description="类型和归属创建后固定。完成模型与能力配置后再启用。"
        dirty={dirty}
        pending={pending || uncertain}
        onClose={() => {
          release();
          navigate("/admin/agents");
        }}
        footer={
          <>
            <OverlayCancelButton />
            <Button
              type="submit"
              form="agent-create"
              pending={pending}
              disabled={uncertain}
            >
              创建并配置
            </Button>
          </>
        }
      >
        <form
          id="agent-create"
          ref={errors.formRef}
          onSubmit={submit}
          noValidate
          className="space-y-6"
        >
          <ErrorNotice error={errors.error} />
          {recovery}
          <fieldset disabled={pending || uncertain} className="space-y-5">
            <Field label="智能体名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={draft.name}
                maxLength={100}
                autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="类型" required>
              <Select
                name="agent_type"
                value={draft.agent_type}
                onValueChange={(value) =>
                  setDraft({ ...draft, agent_type: value as AgentType })
                }
              >
                <option value="interactive">交互型</option>
                <option value="service">服务型</option>
              </Select>
            </Field>
            <Notice>
              {draft.agent_type === "interactive"
                ? "使用对话用户的身份和个人云电脑，历史内容仅本人可见。"
                : "自动创建专属机器人账号，使用独立云电脑池。机器人资料、权限和凭据均在此智能体内管理。"}
            </Notice>
            <Field label="归属" required>
              <Select
                name="scope_kind"
                value={draft.scope_kind}
                onValueChange={(value) => {
                  setDraft({
                    ...draft,
                    scope_kind: value as AgentScope,
                    scope_id: null,
                  });
                  setScopeName("");
                }}
              >
                <option value="platform">平台</option>
                <option value="team">团队</option>
                <option value="project">项目</option>
              </Select>
            </Field>
            {draft.scope_kind !== "platform" && (
              <Field
                label={draft.scope_kind === "team" ? "归属团队" : "归属项目"}
                required
                error={errors.fields.scope_id}
              >
                <Button
                  name="scope_id"
                  variant="outline"
                  onClick={() => setPicking(true)}
                >
                  {scopeName || "选择归属"}
                </Button>
              </Field>
            )}
            <p className="text-sm text-muted">
              平台智能体向所有登录用户开放；团队、项目智能体按成员关系获得使用资格。资源访问范围由执行账号的权限决定。
            </p>
            <Field label="说明" error={errors.fields.description}>
              <Textarea
                name="description"
                rows={4}
                maxLength={1000}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>
          </fieldset>
        </form>
        {picking && (
          <ResourcePicker<Resource>
            title={draft.scope_kind === "team" ? "选择团队" : "选择项目"}
            path={`/${draft.scope_kind === "team" ? "teams" : "projects"}?scope=all&status=active`}
            identify={(item) => item.id}
            label={(item) => item.name}
            onChoose={(item) => {
              setDraft({ ...draft, scope_id: item.id });
              setScopeName(item.name);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </Drawer>
    </>
  );
}

export function AgentDetailPage() {
  const { agentId = "" } = useParams();
  const [params] = useSearchParams();
  const requestedTab =
    params.get("tab") ?? (params.get("view") === "edit" ? "basic" : "overview");
  const editing = params.get("view") === "edit";
  const tab = [
    "overview",
    "prompt",
    "basic",
    "resources",
    "models",
    "tools",
    "mcp",
    "skills",
    "runtime",
    "computer",
  ].includes(requestedTab)
    ? requestedTab
    : "overview";
  const cache = useQueryClient(),
    navigate = useNavigate();
  const agent = useApiQuery<AgentDefinition>(
    [...agentKeys, "definition", agentId],
    `${agentAdminRoot}/definitions/${agentId}`,
  );
  const [deleting, setDeleting] = useState(false);
  const deletion = useAgentCommand<null>(`agent:${agentId}:delete`);
  useCommandResult(deletion.state, () => {
    deletion.command.reset();
    void cache.invalidateQueries({ queryKey: agentKeys });
    navigate("/admin/agents", { replace: true });
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: agentKeys });
  };
  return (
    <div className="page">
      <PageHeader
        title={agent.data?.data.name ?? "智能体配置"}
        description={
          <ResourceDescription
            name={agent.data?.data.name ?? "智能体"}
            description={agent.data?.data.description}
          />
        }
        actions={
          <>
            <Button
              render={
                <Link to="/admin/agents">
                  <ArrowLeft className="size-4" />
                  返回列表
                </Link>
              }
              nativeButton={false}
              role="link"
              variant="outline"
            />
            {agent.data?.data.enabled && (
              <Button
                render={
                  <Link
                    to={
                      agent.data.data.agent_type === "service"
                        ? `/admin/agents/${agentId}/debug`
                        : `/home?agent=${agentId}`
                    }
                  >
                    <Play className="size-4" />
                    调试对话
                  </Link>
                }
                nativeButton={false}
                role="link"
              />
            )}
            {agent.data && tab !== "overview" && (
              <Button
                render={
                  <Link to={`?tab=${tab}${editing ? "" : "&view=edit"}`} />
                }
                nativeButton={false}
                role="link"
                variant="outline"
              >
                {editing ? (
                  <Eye className="size-4" />
                ) : (
                  <Pencil className="size-4" />
                )}
                {editing ? "完成编辑" : "编辑配置"}
              </Button>
            )}
            {agent.data && (
              <Button
                render={
                  <Link
                    to={`?tab=overview&action=${agent.data.data.enabled ? "disable" : "enable"}`}
                  />
                }
                nativeButton={false}
                role="link"
                variant={agent.data.data.enabled ? "outline" : "default"}
              >
                {agent.data.data.enabled ? "停用智能体" : "检查并启用"}
              </Button>
            )}
            {agent.data && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      aria-label="智能体更多操作"
                      disabled={deletion.pending || deletion.uncertain}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 />
                    删除智能体
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      <AsyncBoundary
        loading={agent.isPending}
        error={agent.error}
        onRetry={() => agent.refetch()}
      >
        {agent.data && (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <IdentityBadge mode={agent.data.data.agent_type} />
              <span className="text-sm">
                {scopeLabel(agent.data.data.scope_kind)}
                {agent.data.data.scope_id
                  ? ` · ${agent.data.data.scope_id}`
                  : " · 所有登录用户"}
              </span>
              <EnabledState enabled={agent.data.data.enabled} />
              <span className="font-mono text-xs text-muted">
                {agent.data.data.code}
              </span>
            </div>
            <div className="agent-settings-layout">
              <nav aria-label="智能体配置分区" className="agent-settings-nav">
                {[
                  {
                    label: "智能体",
                    items: [
                      {
                        value: "overview",
                        label: "概览",
                        icon: LayoutDashboard,
                      },
                    ],
                  },
                  {
                    label: "基础配置",
                    items: [
                      { value: "basic", label: "基本信息", icon: Bot },
                      { value: "prompt", label: "系统提示词", icon: FileText },
                      {
                        value: "models",
                        label: "模型",
                        icon: SlidersHorizontal,
                      },
                    ],
                  },
                  {
                    label: "能力配置",
                    items: [
                      { value: "tools", label: "内置工具", icon: Wrench },
                      { value: "mcp", label: "MCP 服务", icon: Plug },
                      { value: "skills", label: "技能", icon: FileText },
                    ],
                  },
                  {
                    label: "运行配置",
                    items: [
                      {
                        value: "runtime",
                        label: "执行预算",
                        icon: ShieldCheck,
                      },
                      ...(agent.data.data.agent_type === "service"
                        ? [
                            {
                              value: "resources",
                              label: "机器人权限与凭据",
                              icon: Folder,
                            },
                            {
                              value: "computer",
                              label: "云电脑池",
                              icon: SlidersHorizontal,
                            },
                          ]
                        : []),
                    ],
                  },
                ].map((group) => (
                  <div key={group.label}>
                    <p className="agent-settings-group">{group.label}</p>
                    {group.items.map(({ value, label, icon: Icon }) => (
                      <Link
                        key={value}
                        to={`?tab=${value}${editing && value !== "overview" ? "&view=edit" : ""}`}
                        aria-current={tab === value ? "page" : undefined}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {label}
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="agent-settings-content">
                {editing && tab !== "overview" && (
                  <p className="mb-5 text-sm text-muted">
                    正在编辑 ·
                    各分区分别保存，保存后可继续配置。完成后点击“完成编辑”。
                  </p>
                )}
                {tab === "overview" && (
                  <AgentOverview agent={agent.data.data} />
                )}
                {tab === "prompt" &&
                  (editing ? (
                    <PromptEditor
                      key={agentId}
                      initial={agent.data}
                      onSaved={refresh}
                    />
                  ) : (
                    <AgentPromptRead agent={agent.data.data} />
                  ))}
                {tab === "basic" &&
                  (editing ? (
                    <AgentBasicEditor
                      key={agentId}
                      initial={agent.data}
                      onSaved={refresh}
                    />
                  ) : (
                    <AgentBasicRead agent={agent.data.data} />
                  ))}
                {tab === "resources" &&
                  agent.data.data.agent_type === "service" && (
                    <RobotResources
                      key={String(editing)}
                      agent={agent.data.data}
                      readOnly={!editing}
                    />
                  )}
                {tab === "computer" &&
                  agent.data.data.agent_type === "service" && (
                    <CloudTemplateEditor
                      key={String(editing)}
                      agent={agent.data}
                      onSaved={refresh}
                      readOnly={!editing}
                    />
                  )}
                {tab === "skills" && (
                  <AgentSkillBindings
                    key={String(editing)}
                    agentId={agentId}
                    onSaved={refresh}
                    readOnly={!editing}
                  />
                )}
                {tab === "models" && (
                  <AgentModelBindings
                    key={String(editing)}
                    agentId={agentId}
                    onSaved={refresh}
                    readOnly={!editing}
                  />
                )}
                {tab === "tools" && (
                  <AgentToolBindings
                    key={String(editing)}
                    agentId={agentId}
                    mode={agent.data.data.agent_type}
                    onSaved={refresh}
                    readOnly={!editing}
                  />
                )}
                {tab === "mcp" && (
                  <AgentMCPBindings
                    key={String(editing)}
                    agentId={agentId}
                    onSaved={refresh}
                    readOnly={!editing}
                  />
                )}
                {tab === "runtime" && (
                  <AgentRuntimePolicy
                    key={editing ? "edit" : agent.data.etag}
                    initial={agent.data}
                    onSaved={refresh}
                    readOnly={!editing}
                  />
                )}
                {(tab === "resources" || tab === "computer") &&
                  agent.data.data.agent_type !== "service" && (
                    <Notice>
                      此配置仅适用于服务型智能体。交互型智能体使用对话用户的身份与个人云电脑。
                    </Notice>
                  )}
              </div>
            </div>
            {(params.get("action") === "enable" ||
              params.get("action") === "disable") && (
              <AgentActivation
                key={`${agentId}:${params.get("action")}`}
                initial={agent.data}
                enable={params.get("action") === "enable"}
                onClose={() => navigate("?tab=overview")}
                onSaved={() => {
                  void refresh();
                  navigate("?tab=overview");
                }}
              />
            )}
            {deletion.recovery}
            <ConfirmDialog
              open={deleting}
              title="删除智能体？"
              description="删除后不再接受新轮次，历史记录保留。服务型的专属机器人同时停用；已有云电脑需单独维护。"
              danger
              pending={deletion.pending}
              onClose={() => setDeleting(false)}
              onConfirm={() => {
                if (!agent.data || deletion.uncertain) return;
                void deletion.command.run({
                  domain: agentAdminRoot,
                  path: `/definitions/${agentId}`,
                  command: "agent_definition.delete",
                  scope: `agent_definition:${agentId}`,
                  options: { method: "DELETE", etag: agent.data.etag },
                });
              }}
            >
              {deletion.recovery}
            </ConfirmDialog>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
function AgentBasicRead({ agent }: { agent: AgentDefinition }) {
  return (
    <Panel bodyClassName="p-6">
      <ResourceSection title="基本信息">
        <dl className="agent-read-facts">
          <div>
            <dt>智能体名称</dt>
            <dd>{agent.name}</dd>
          </div>
          <div>
            <dt>说明</dt>
            <dd className="whitespace-pre-wrap">
              {agent.description || "尚未填写说明"}
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              <EnabledState enabled={agent.enabled} />
            </dd>
          </div>
          <div>
            <dt>智能体标识</dt>
            <dd className="font-mono text-xs">{agent.code}</dd>
          </div>
        </dl>
      </ResourceSection>
    </Panel>
  );
}
function AgentPromptRead({ agent }: { agent: AgentDefinition }) {
  return (
    <Panel bodyClassName="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">系统提示词</h2>
          <p className="mt-1 text-sm text-muted">
            定义智能体的角色、工作方式和行为边界。
          </p>
        </div>
        <Button
          render={<Link to="?tab=prompt&view=edit" />}
          nativeButton={false}
          role="link"
          variant="outline"
        >
          <Pencil className="size-4" />
          编辑系统提示
        </Button>
      </div>
      <pre className="agent-prompt-read" aria-label="系统提示词内容">
        {agent.system_prompt || "尚未配置系统提示词。"}
      </pre>
    </Panel>
  );
}
function AgentBasicEditor({
  initial,
  onSaved,
}: {
  initial: ApiResponse<AgentDefinition>;
  onSaved: () => void;
}) {
  const fields = (agent: AgentDefinition) => ({
    name: agent.name,
    description: agent.description,
  });
  const [draft, setDraft] = useState(() => fields(initial.data));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const errors = useFormErrors();
  const save = useResourceSave({
    path: `${agentAdminRoot}/definitions/${initial.data.id}`,
    initial,
    dirty: JSON.stringify(draft) !== baseline,
    adopt: (data) => {
      const next = fields(data);
      setDraft(next);
      setBaseline(JSON.stringify(next));
    },
    complete: onSaved,
    showError: (error) => errors.show(error, ["name", "description"]),
  });
  return (
    <form
      ref={errors.formRef}
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        errors.clear();
        if (errors.validate({ name: draft.name.trim() ? "" : "请输入名称" }))
          void save.save(draft);
      }}
    >
      {save.recovery}
      <ErrorNotice error={errors.error} />
      <fieldset disabled={save.pending || save.blocked} className="max-w-3xl">
        <Panel bodyClassName="p-6">
          <ResourceSection title="基本信息">
            <Field label="智能体名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={draft.name}
                maxLength={100}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field label="说明" error={errors.fields.description}>
              <Textarea
                name="description"
                value={draft.description}
                maxLength={1000}
                rows={4}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
          </ResourceSection>
        </Panel>
      </fieldset>
      <ConfigActions
        dirty={JSON.stringify(draft) !== baseline}
        pending={save.pending}
        blocked={save.blocked}
      >
        <Button
          type="submit"
          pending={save.pending}
          disabled={save.blocked || JSON.stringify(draft) === baseline}
        >
          保存修改
        </Button>
        <Button
          variant="outline"
          disabled={save.pending || save.blocked}
          onClick={() => setDraft(JSON.parse(baseline) as typeof draft)}
        >
          取消修改
        </Button>
      </ConfigActions>
    </form>
  );
}

export function AgentPromptPage() {
  const { agentId = "" } = useParams();
  return (
    <Navigate to={`/admin/agents/${agentId}?tab=prompt&view=edit`} replace />
  );
}
function PromptEditor({
  initial,
  onSaved,
}: {
  initial: ApiResponse<AgentDefinition>;
  onSaved: () => void;
}) {
  const [text, setText] = useState(initial.data.system_prompt),
    [baseline, setBaseline] = useState(initial.data.system_prompt);
  const save = useResourceSave({
    path: `${agentAdminRoot}/definitions/${initial.data.id}`,
    initial,
    dirty: text !== baseline,
    adopt: (agent) => {
      setText(agent.system_prompt);
      setBaseline(agent.system_prompt);
    },
    complete: onSaved,
  });
  return (
    <Panel bodyClassName="p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save.save({ system_prompt: text });
        }}
        className="space-y-5"
      >
        {save.recovery}
        <Field
          label="系统提示"
          hint="最多 128 KiB UTF-8。修改从下一轮实际开始时生效，已开始的轮次继续使用原配置。"
        >
          <Textarea
            name="system_prompt"
            rows={16}
            className="agent-prompt-input font-mono text-sm leading-7"
            value={text}
            disabled={save.pending || save.blocked}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">
          {new TextEncoder().encode(text).byteLength.toLocaleString()} / 131,072
          字节
        </p>
        <ConfigActions
          dirty={text !== baseline}
          pending={save.pending}
          blocked={save.blocked}
        >
          <Button
            type="submit"
            pending={save.pending}
            disabled={
              save.blocked ||
              text === baseline ||
              new TextEncoder().encode(text).byteLength > 131072
            }
          >
            保存系统提示
          </Button>
          <Button
            variant="outline"
            disabled={save.pending || save.blocked || text === baseline}
            onClick={() => setText(baseline)}
          >
            取消修改
          </Button>
        </ConfigActions>
      </form>
    </Panel>
  );
}
