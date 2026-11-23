import { resourceCodeSchema } from "@/domain/validation";
import type { User } from "@/types/auth";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
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
  UserRound,
  Plug,
  LayoutDashboard,
  ChevronRight,
  Globe2,
  MessageSquare,
  Search,
  Workflow,
  UsersRound,
  X,
} from "lucide-react";
import { Button, IconButton } from "@/components/button";
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
import { AgentDialog, AgentDialogCancel } from "./management/dialog";
import { ConfigActions } from "./management/section-actions";
import {
  useAgentListPosition,
  useAgentListReturn,
} from "./management/list-navigation";
import styles from "./management/management.module.css";
import listStyles from "./management/list-page.module.css";
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
  ResourceDescription,
  IdentityBadge,
  ResourceSection,
  useListParams,
  useResourceSave,
  scopeLabel,
} from "@/features/agents/resources/admin-shared";
import { AgentModelBindings } from "./management/model-bindings";
import { AgentMCPBindings } from "./management/mcp-bindings";
import { AgentToolBindings } from "./management/tool-bindings";
import { AgentPapiGrants } from "@/features/agents/resources/papi-grants";
import { AgentRuntimePolicy } from "./management/runtime-policy";
import { ResourcePicker } from "./management/resource-picker";
import type { Resource } from "@/types/collaboration";
import { AgentSkillBindings } from "./management/skill-bindings";
import { RobotResources } from "@/features/agents/resources/robot-resources";
import {
  CloudSpecBindingEditor,
  SpecPicker,
} from "./management/spec-binding-editor";
import { AgentOverview, AgentActivation } from "./agent-overview";
import { AgentListPage } from "./management/list-page";

const agentScopeIcons = { platform: Globe2, team: UsersRound, project: Folder };

export function AgentsPage() {
  const { params, page, size, change } = useListParams();
  const requestedType = params.get("agent_type");
  const q = params.get("q") ?? "",
    mode = requestedType === "interactive" ? "chat" : (requestedType ?? "all"),
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
  const listBody = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (listBody.current) listBody.current.scrollTop = 0;
  }, [query]);
  const rememberList = useAgentListPosition(agents.isSuccess, listBody);
  const filtered =
    !!q || mode !== "all" || scope !== "all" || enabled !== "all";
  const filter = (key: string, value: string) =>
    change({ [key]: value, q: search.value.trim(), page: "1" });
  const reset = () => {
    search.setValue("");
    change({ q: "", agent_type: "", scope_kind: "", enabled: "", page: "1" });
  };
  return (
    <AgentListPage>
      <PageHeader className={listStyles.header}>
        <div className={listStyles.heading}>
          <span className={listStyles.headingIcon}>
            <Bot aria-hidden />
          </span>
          <h1 className="page-title">助手管理</h1>
        </div>
        <div className={listStyles.headerActions}>
          <Button
            render={
              <Link
                to={{
                  pathname: "/admin/agents/new",
                  search: params.toString(),
                }}
                onClick={rememberList}
                id="agent-new-trigger"
              >
                <Plus className="size-4" />
                新建助手
              </Link>
            }
            nativeButton={false}
            role="link"
          />
        </div>
      </PageHeader>
      <TableToolbar
        onRefresh={() => agents.refetch()}
        refreshing={agents.isFetching}
        onReset={filtered || search.value ? reset : undefined}
        renderToolbar={({ filters, controls }) => (
          <div className={listStyles.toolbar}>
            <div
              className={listStyles.typeFilter}
              role="group"
              aria-label="类型"
            >
              {[
                { value: "all", label: "全部助手" },
                { value: "chat", label: "对话型" },
                { value: "service", label: "服务型" },
              ].map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={mode === value}
                  onClick={() => filter("agent_type", value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className={listStyles.filters}>{filters}</div>
            <div className={listStyles.toolbarActions}>{controls}</div>
          </div>
        )}
      >
        <form
          role="search"
          className={listStyles.search}
          onSubmit={(event) => {
            event.preventDefault();
            if (!search.composing.current) search.submit();
          }}
        >
          <Search className={listStyles.searchIcon} aria-hidden />
          <StandaloneInput
            aria-label="搜索助手"
            placeholder="搜索名称或说明"
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
            onCompositionStart={() => {
              search.composing.current = true;
            }}
            onCompositionEnd={search.compositionEnd}
            className="w-full ps-9 pe-10"
          />
          {search.value && (
            <IconButton
              type="button"
              label="清除搜索"
              size="iconSm"
              className={`absolute ${listStyles.clearSearch}`}
              onClick={() => {
                search.setValue("");
                change({ q: "", page: "1" });
              }}
            >
              <X aria-hidden />
            </IconButton>
          )}
        </form>
        <StandaloneSelect
          aria-label="归属"
          value={scope}
          onValueChange={(value) => filter("scope_kind", value)}
        >
          <option value="all">全部归属</option>
          <option value="platform">平台</option>
          <option value="team">团队</option>
          <option value="project">项目</option>
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="启用状态"
          value={enabled}
          onValueChange={(value) => filter("enabled", value)}
        >
          <option value="all">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已停用</option>
        </StandaloneSelect>
      </TableToolbar>
      <div
        className={listStyles.body}
        ref={listBody}
        tabIndex={0}
        role="region"
        aria-label="助手列表区域"
        aria-busy={agents.isFetching}
      >
        <AsyncBoundary
          loading={agents.isPending}
          error={agents.error}
          onRetry={() => agents.refetch()}
        >
          {agents.data?.data.length ? (
            <SimpleTable
              label="助手列表"
              headers={[
                "助手",
                "类型",
                "归属",
                "模型",
                "内置工具",
                "MCP 服务",
                "状态",
              ]}
              className={listStyles.table}
            >
              {agents.data.data.map((agent) => {
                const AgentIcon =
                  agent.agent_type === "service" ? Workflow : MessageSquare;
                const ScopeIcon = agentScopeIcons[agent.scope_kind];
                return (
                  <tr key={agent.id}>
                    <td>
                      <div className={listStyles.identity}>
                        <Link
                          to={`/admin/agents/${agent.id}`}
                          onClick={rememberList}
                          className={listStyles.identityLink}
                          aria-label={agent.name}
                          title={agent.name}
                        >
                          <span
                            className={listStyles.agentIcon}
                            data-agent-type={agent.agent_type}
                          >
                            <AgentIcon aria-hidden />
                          </span>
                          <span className={listStyles.identityText}>
                            <span className={listStyles.agentName}>
                              {agent.name}
                            </span>
                            {agent.description && (
                              <span className={listStyles.agentDescription}>
                                {agent.description}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            className={listStyles.openIndicator}
                            aria-hidden
                          />
                        </Link>
                        {agent.description && (
                          <DescriptionPreview
                            name={agent.name}
                            description={agent.description}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <IdentityBadge mode={agent.agent_type} />
                    </td>
                    <td>
                      <div className={listStyles.scopeValue}>
                        <ScopeIcon aria-hidden />
                        <span>
                          {scopeLabel(agent.scope_kind)}
                          <span className={listStyles.scopeDetail}>
                            {agent.scope_id
                              ? `ID ${agent.scope_id}`
                              : "所有登录用户"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>{agent.model_binding_count}</td>
                    <td>{agent.tool_binding_count}</td>
                    <td>{agent.mcp_binding_count}</td>
                    <td>
                      <EnabledState enabled={agent.enabled} />
                    </td>
                  </tr>
                );
              })}
            </SimpleTable>
          ) : (
            <EmptyState
              icon={filtered ? Search : Bot}
              title={filtered ? "暂无匹配的助手" : "尚未创建助手"}
              description={
                filtered
                  ? "调整搜索词或筛选条件后重试。"
                  : "新建助手后即可配置模型与能力。"
              }
              action={
                filtered && (
                  <Button variant="outline" onClick={reset}>
                    重置筛选条件
                  </Button>
                )
              }
            />
          )}
        </AsyncBoundary>
      </div>
      <Pagination
        page={page}
        size={size}
        total={agents.data?.pagination?.total}
        pending={agents.isFetching || !agents.data}
        onChange={(next, count) =>
          change({ page: String(next), page_size: String(count) })
        }
      />
    </AgentListPage>
  );
}

export function AgentCreatePage() {
  const listUrl = useAgentListReturn();
  const navigate = useNavigate(),
    errors = useFormErrors();
  const [specID, setSpecID] = useState("");
  const robots = useApiQuery<(User & { managed_agent_id: string | null })[]>(
    ["unbound-robots"],
    "/admin/robots?page_size=100&unbound=true",
  );
  const [draft, setDraft] = useState({
    code: "",
    executor_kind: "chat_user" as AgentDefinition["executor_kind"],
    use_policy: "scope" as AgentDefinition["use_policy"],
    robot_user_id: null as string | null,
    name: "",
    description: "",
    greeting: "",
    agent_type: "chat" as AgentType,
    scope_kind: "platform" as AgentScope,
    scope_id: null as string | null,
  });
  const [picking, setPicking] = useState(false),
    [scopeName, setScopeName] = useState("");
  const { command, state, pending, uncertain, recovery } =
    useAgentCommand<AgentDefinition>("agent:create");
  const dirty = Boolean(
    draft.code ||
    draft.name ||
    draft.description ||
    (draft.agent_type === "chat" && draft.greeting) ||
    draft.executor_kind !== "chat_user" ||
    draft.agent_type !== "chat" ||
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
        code: resourceCodeSchema.safeParse(draft.code).success
          ? ""
          : "请输入 1–64 位小写字母、数字、_ 或 - 的编码",
        robot_user_id:
          draft.executor_kind === "robot" && !draft.robot_user_id
            ? "请选择未绑定助手的机器人"
            : "",
        name: draft.name.trim() ? "" : "请输入助手名称",
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
      options: {
        method: "POST",
        body: {
          ...draft,
          greeting: draft.agent_type === "chat" ? draft.greeting : undefined,
          ...(draft.executor_kind === "robot" && specID
            ? { sandbox_spec_id: specID }
            : {}),
          robot_user_id:
            draft.executor_kind === "robot" ? draft.robot_user_id : null,
          enabled: false,
        },
      },
    });
    if (command.getSnapshot().phase === "failed")
      errors.show(command.getSnapshot().error, [
        "code",
        "robot_user_id",
        "name",
        "description",
        "greeting",
        "scope_id",
        "scope_kind",
      ]);
  }
  return (
    <>
      <AgentsPage />
      <AgentDialog
        side="right"
        icon={<Bot />}
        title="新建助手"
        description="创建后将进入配置页，完成模型设置后即可检查并启用。"
        dirty={dirty}
        pending={pending || uncertain}
        onClose={() => {
          release();
          navigate(listUrl, {
            state: { restoreList: true, focusCreate: true },
          });
        }}
        footer={
          <>
            <AgentDialogCancel pending={pending || uncertain} />
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
            <div className={styles.fieldPair}>
              {" "}
              <Field label="助手名称" required error={errors.fields.name}>
                <Input
                  name="name"
                  value={draft.name}
                  maxLength={100}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="编码" required error={errors.fields.code}>
                <Input
                  value={draft.code}
                  maxLength={64}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </Field>
            </div>
            <fieldset className={styles.identity}>
              <legend>执行身份</legend>
              <div className={styles.fieldPair}>
                {(
                  [
                    {
                      value: "chat",
                      title: "对话型",
                      hint: "允许用户从工作台发起对话",
                      Icon: UserRound,
                    },
                    {
                      value: "service",
                      title: "服务型",
                      hint: "仅供作业和事件订阅调用",
                      Icon: Bot,
                    },
                  ] as const
                ).map(({ value, title, hint, Icon }) => (
                  <label key={value} className={styles.identityOption}>
                    <input
                      type="radio"
                      name="agent_type"
                      value={value}
                      checked={draft.agent_type === value}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          agent_type: value,
                          executor_kind:
                            value === "service" ? "robot" : "chat_user",
                          use_policy: "scope",
                        })
                      }
                    />
                    <Icon aria-hidden />
                    <span>
                      <strong>{title}</strong>
                      <small>{hint}</small>
                    </span>
                  </label>
                ))}
              </div>
              <p className={styles.hint}>助手类型创建后固定。</p>
            </fieldset>
            {draft.agent_type === "chat" && (
              <Field label="执行身份">
                <Select
                  value={draft.executor_kind}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      executor_kind: value === "robot" ? "robot" : "chat_user",
                      use_policy: value === "robot" ? "allowlist" : "scope",
                    })
                  }
                >
                  <option value="chat_user">对话用户 · 个人云电脑</option>
                  <option value="robot">机器人 · 机器人云电脑池</option>
                </Select>
              </Field>
            )}
            <Field label="使用权限">
              <Select
                value={draft.use_policy}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    use_policy: value === "scope" ? "scope" : "allowlist",
                  })
                }
              >
                <option value="scope">归属范围内的成员</option>
                <option value="allowlist">指定账号或项目角色</option>
              </Select>
            </Field>
            {draft.executor_kind === "robot" && (
              <>
                <ErrorNotice error={robots.error} />
                <Field
                  label="执行机器人"
                  required
                  error={errors.fields.robot_user_id}
                >
                  <Select
                    value={draft.robot_user_id ?? ""}
                    onValueChange={(value) =>
                      setDraft({ ...draft, robot_user_id: value || null })
                    }
                  >
                    <option value="">选择未绑定机器人</option>
                    {robots.data?.data
                      .filter((u) => !u.managed_agent_id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name} ({u.username})
                          {u.status === "disabled" ? " · 已停用" : ""}
                        </option>
                      ))}
                  </Select>
                </Field>
                <p className={styles.hint}>执行机器人绑定后不可更换。</p>
                <SpecPicker value={specID} onChange={setSpecID} />
                <Link className="text-primary" to="/admin/robots">
                  管理机器人账号
                </Link>
              </>
            )}
            <Field
              label="归属"
              required
              hint="创建后固定。团队和项目助手仅向相应成员开放。"
            >
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
            <p className="text-sm text-muted">资源访问权限由执行账号决定。</p>
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
            {draft.agent_type === "chat" && (
              <AgentGreetingField
                value={draft.greeting}
                error={errors.fields.greeting}
                onChange={(greeting) => setDraft({ ...draft, greeting })}
              />
            )}
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
      </AgentDialog>
    </>
  );
}

export function AgentDetailPage() {
  const listUrl = useAgentListReturn();
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
    "papi",
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
    navigate(listUrl, { replace: true, state: { restoreList: true } });
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: agentKeys });
  };
  const sections = [
    {
      label: "助手",
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
        { value: "papi", label: "平台 API 授权", icon: Plug },
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
        ...(agent.data?.data.executor_kind === "robot"
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
  ];
  const currentSection = sections
    .flatMap((group) => group.items)
    .find((item) => item.value === tab);
  return (
    <div className={`page page-wide ${styles.scope} ${styles.detail}`}>
      <PageHeader
        title={agent.data?.data.name ?? "助手配置"}
        description={
          <div>
            {agent.data && (
              <div className={styles.metadata}>
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
            )}
            <ResourceDescription
              name={agent.data?.data.name ?? "助手"}
              description={agent.data?.data.description}
            />
          </div>
        }
        actions={
          <>
            <Button
              render={
                <Link to={listUrl} state={{ restoreList: true }}>
                  <ArrowLeft className="size-4" />
                  返回列表
                </Link>
              }
              nativeButton={false}
              role="link"
              variant="outline"
            />
            {agent.data?.data.enabled &&
              agent.data.data.agent_type === "chat" && (
                <Button
                  render={
                    <Link to={`/home?agent=${agentId}`}>
                      <Play className="size-4" />
                      调试对话
                    </Link>
                  }
                  nativeButton={false}
                  role="link"
                />
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
                {agent.data.data.enabled ? "停用助手" : "检查并启用"}
              </Button>
            )}
            {agent.data && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      aria-label="助手更多操作"
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
                    删除助手
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
            <div className="agent-settings-layout">
              <nav aria-label="助手配置分区" className="agent-settings-nav">
                {sections.map((group) => (
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
              <div key={tab} className="agent-settings-content">
                {currentSection &&
                  tab !== "tools" &&
                  tab !== "overview" &&
                  (!editing || tab === "resources" || tab === "papi") && (
                    <div className={styles.sectionTools}>
                      <h2>{currentSection.label}</h2>
                      <Button
                        role="link"
                        nativeButton={false}
                        variant="outline"
                        render={
                          <Link
                            to={
                              editing ? `?tab=${tab}` : `?tab=${tab}&view=edit`
                            }
                          />
                        }
                      >
                        <Pencil className="size-4" />
                        {editing ? "退出编辑" : "编辑配置"}
                      </Button>
                    </div>
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
                      onSaved={async () => {
                        await Promise.all([
                          refresh(),
                          cache.invalidateQueries({
                            queryKey: ["agent-start-detail", false, agentId],
                          }),
                        ]);
                      }}
                    />
                  ) : (
                    <AgentBasicRead agent={agent.data.data} />
                  ))}
                {tab === "resources" &&
                  agent.data.data.executor_kind === "robot" && (
                    <RobotResources
                      key={String(editing)}
                      robotId={agent.data.data.robot_user_id!}
                      readOnly={!editing}
                    />
                  )}
                {tab === "computer" &&
                  agent.data.data.executor_kind === "robot" && (
                    <CloudSpecBindingEditor
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
                    key={agentId}
                    agentId={agentId}
                    mode={agent.data.data.agent_type}
                    onSaved={refresh}
                  />
                )}
                {tab === "papi" && (
                  <AgentPapiGrants
                    key={`${agentId}:${editing}`}
                    agentId={agentId}
                    readOnly={!editing}
                    onSaved={refresh}
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
                  agent.data.data.executor_kind !== "robot" && (
                    <Notice>
                      此助手由对话用户执行，使用该用户的权限和个人云电脑。
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
            {deleting && (
              <AgentDialog
                compact
                tone="danger"
                title={"删除「" + agent.data.data.name + "」？"}
                description="删除后不再接受新轮次，历史记录保留。绑定的机器人独立保留，已有云电脑需单独维护。"
                pending={deletion.pending}
                onClose={() => setDeleting(false)}
                footer={
                  <>
                    <AgentDialogCancel
                      initialFocus
                      pending={deletion.pending}
                    />
                    <Button
                      variant="danger"
                      pending={deletion.pending}
                      disabled={deletion.uncertain}
                      onClick={() => {
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
                      删除助手
                    </Button>
                  </>
                }
              >
                {deletion.recovery}
              </AgentDialog>
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
function AgentBasicRead({ agent }: { agent: AgentDefinition }) {
  return (
    <Panel bodyClassName="p-6">
      <dl className="agent-read-facts grid grid-cols-2 gap-6">
        <div>
          <dt>执行身份</dt>
          <dd>
            {agent.executor_kind === "robot"
              ? `机器人 #${agent.robot_user_id}`
              : "对话用户"}
          </dd>
        </div>
        <div>
          <dt>使用权限</dt>
          <dd>
            {agent.use_policy === "scope"
              ? "归属范围内的成员"
              : "指定账号或项目角色"}
          </dd>
        </div>
        <div>
          <dt>助手名称</dt>
          <dd>{agent.name}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd className="whitespace-pre-wrap">
            {agent.description || "尚未填写说明"}
          </dd>
        </div>
        {agent.agent_type === "chat" && (
          <div>
            <dt>欢迎语</dt>
            <dd className="whitespace-pre-wrap wrap-break-word">
              {agent.greeting || "尚未配置欢迎语"}
            </dd>
          </div>
        )}
        <div>
          <dt>状态</dt>
          <dd>
            <EnabledState enabled={agent.enabled} />
          </dd>
        </div>
        <div>
          <dt>助手标识</dt>
          <dd className="font-mono text-xs">{agent.code}</dd>
        </div>
      </dl>
    </Panel>
  );
}
function AgentPromptRead({ agent }: { agent: AgentDefinition }) {
  return (
    <Panel bodyClassName="p-6">
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
    use_policy: agent.use_policy,
    use_grants: agent.use_grants ?? [],
    ...(agent.agent_type === "chat" ? { greeting: agent.greeting ?? "" } : {}),
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
    showError: (error) =>
      errors.show(error, ["name", "description", "greeting"]),
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
            <Field label="助手名称" required error={errors.fields.name}>
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
            <Field label="使用权限">
              <Select
                value={draft.use_policy}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    use_policy: value === "scope" ? "scope" : "allowlist",
                  })
                }
              >
                <option value="scope">归属范围内的成员</option>
                <option value="allowlist">指定账号或项目角色</option>
              </Select>
            </Field>
            {(draft.use_policy === "allowlist" ||
              initial.data.agent_type === "service") && (
              <div className="space-y-2">
                {draft.use_grants.map((grant, index) => (
                  <div className="flex items-center gap-2" key={index}>
                    <Select
                      aria-label="授权对象类型"
                      value={grant.kind}
                      onValueChange={(value) =>
                        setDraft({
                          ...draft,
                          use_grants: draft.use_grants.map((g, i) =>
                            i === index
                              ? { ...g, kind: value as typeof g.kind, id: "" }
                              : g,
                          ),
                        })
                      }
                    >
                      <option value="user">账号</option>
                      {initial.data.scope_kind === "project" && (
                        <option value="role">项目角色</option>
                      )}
                      {initial.data.agent_type === "service" && (
                        <option value="job">作业</option>
                      )}
                    </Select>
                    <Input
                      aria-label="授权对象 ID"
                      placeholder="对象 ID"
                      value={grant.id}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          use_grants: draft.use_grants.map((g, i) =>
                            i === index
                              ? {
                                  ...g,
                                  id: event.target.value.replace(/\D/g, ""),
                                }
                              : g,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          use_grants: draft.use_grants.filter(
                            (_, i) => index !== i,
                          ),
                        })
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      use_grants: [
                        ...draft.use_grants,
                        {
                          kind:
                            initial.data.agent_type === "service"
                              ? "job"
                              : "user",
                          id: "",
                        },
                      ],
                    })
                  }
                >
                  添加调用授权
                </Button>
              </div>
            )}
            {draft.greeting !== undefined && (
              <AgentGreetingField
                value={draft.greeting}
                error={errors.fields.greeting}
                onChange={(greeting) => setDraft({ ...draft, greeting })}
              />
            )}
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
          保存本分区
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

function AgentGreetingField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="欢迎语"
      error={error}
      hint="仅在新对话展示。{user} 为当前用户的显示名称，{assistant} 为助手名称。"
    >
      <Textarea
        name="greeting"
        rows={3}
        maxLength={1000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
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
            保存本分区
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
