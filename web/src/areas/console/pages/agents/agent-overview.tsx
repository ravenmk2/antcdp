import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Blocks,
  Terminal,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import { AgentDialog, AgentDialogCancel } from "./management/dialog";
import styles from "./management/management.module.css";
import { useApiQuery } from "@/hooks/use-api";
import { agentAdminRoot, agentKeys } from "@/features/agents/data/agent-api";
import {
  scopeLabel,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import type {
  AgentDefinition,
  BindingCollection,
  ModelBindings,
  ToolBinding,
} from "@/types/agents";
import type { ModelDefinition } from "@/types/models";

function activationIssue(error: ApiError) {
  if (error.details.some((detail) => detail.code === "default_model_required"))
    return {
      tab: "models",
      message: "尚未设置有效的默认模型。请先添加模型并指定默认项。",
    };
  if (error.code === "MODEL_UNAVAILABLE")
    return {
      tab: "models",
      message: "绑定模型当前不可用，请检查模型、提供商的启用状态及凭据。",
    };
  if (error.code === "MODEL_CAPABILITY_UNSUPPORTED")
    return {
      tab: "models",
      message: "绑定模型缺少文本或工具调用能力，请调整模型或已启用的工具。",
    };
  if (
    error.code === "SERVICE_APPROVAL_UNSUPPORTED" ||
    error.details.some((detail) => detail.code === "tool_unavailable")
  )
    return {
      tab: "tools",
      message:
        "工具绑定或执行策略不可用，请检查内置工具。服务型助手不能使用需审批的策略。",
    };
  if (
    error.code === "VALIDATION_FAILED" &&
    error.details.some((detail) => detail.field?.startsWith("items"))
  )
    return {
      tab: "models",
      message: "模型绑定参数已失效，请核对思考选项及参数覆盖。",
    };
  return null;
}

function CheckResult({
  error,
  pending,
}: {
  error: ApiError | null;
  pending: boolean;
}) {
  const issue = error && activationIssue(error);
  if (pending) return <Notice>正在检查已保存的模型与能力配置…</Notice>;
  if (issue)
    return (
      <Notice tone="warning" title="当前阻塞项">
        <p>{issue.message}</p>
        <Link
          className="mt-3 inline-flex items-center gap-1 font-medium text-primary"
          to={`?tab=${issue.tab}&view=edit`}
        >
          {issue.tab === "models" ? "去配置模型" : "去配置工具"}{" "}
          <ArrowRight className="size-4" />
        </Link>
      </Notice>
    );
  if (error)
    return (
      <div className="space-y-2">
        <p className="text-sm">检查未完成，请重试或处理以下问题。</p>
        <ErrorNotice error={error} />
      </div>
    );
  return (
    <Notice tone="success" title="启用条件检查通过">
      已保存的配置满足启用条件。实际运行仍取决于外部服务和运行环境。
    </Notice>
  );
}

export function AgentOverview({ agent }: { agent: AgentDefinition }) {
  const base = `${agentAdminRoot}/definitions/${agent.id}`;
  const check = useApiQuery<AgentDefinition>(
    [...agentKeys, agent.id, "activation-check"],
    `${base}/activation-check`,
    { retry: false, staleTime: 0 },
  );
  const models = useApiQuery<ModelBindings>(
    [...agentKeys, agent.id, "model-bindings"],
    `${base}/model-bindings`,
  );
  const defaultBinding = models.data?.data.items.find(
    (item) => item.id === models.data.data.default_model_binding_id,
  );
  const model = useApiQuery<ModelDefinition>(
    ["model-management", "binding-detail", defaultBinding?.model_definition_id],
    `/admin/models/definitions/${defaultBinding?.model_definition_id}`,
    { enabled: Boolean(defaultBinding) },
  );
  return (
    <div className="agent-overview">
      <Panel bodyClassName="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={styles.cardHeading}>
              <ShieldCheck aria-hidden />
              配置检查
            </h2>
            <p className="mt-1 text-sm text-muted">
              检查已保存的配置是否满足启用条件。
            </p>
          </div>
          <Button
            variant="outline"
            pending={check.isFetching}
            onClick={() => void check.refetch()}
          >
            重新检查
          </Button>
        </div>
        <CheckResult
          pending={check.isFetching || check.isPending}
          error={check.error}
        />
        <div className="divide-y rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h3 className="text-sm font-medium">
                默认模型 <span className="text-xs text-muted">必需</span>
              </h3>
              <p className="mt-1 text-sm text-muted">
                {models.isPending
                  ? "正在读取…"
                  : models.error
                    ? "模型绑定读取失败"
                    : !defaultBinding
                      ? "尚未设置"
                      : model.error
                        ? "模型详情读取失败"
                        : (model.data?.data.name ?? "正在读取模型…")}
              </p>
            </div>
            <Link className="text-sm text-primary" to="?tab=models&view=edit">
              配置模型
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h3 className="text-sm font-medium">
                系统提示词 <span className="text-xs text-muted">建议配置</span>
              </h3>
              <p className="mt-1 text-sm text-muted">
                {agent.system_prompt.trim()
                  ? "已配置角色、工作方式与行为说明"
                  : "补充助手的角色与工作方式，空白不会阻止启用"}
              </p>
            </div>
            <Link className="text-sm text-primary" to="?tab=prompt&view=edit">
              编辑提示词
            </Link>
          </div>
        </div>
      </Panel>
      <Panel bodyClassName="p-6 space-y-4">
        <div>
          <h2 className={styles.cardHeading}>
            <Blocks aria-hidden />
            能力配置
          </h2>
          <p className="mt-1 text-sm text-muted">
            按任务需要绑定，未绑定的可选能力不影响启用。
          </p>
        </div>
        <div className="divide-y">
          <CapabilitySummary
            agentId={agent.id}
            kind="tool"
            label="内置工具"
            tab="tools"
          />
          <CapabilitySummary
            agentId={agent.id}
            kind="mcp"
            label="MCP 服务"
            tab="mcp"
          />
          <CapabilitySummary
            agentId={agent.id}
            kind="skill"
            label="技能"
            tab="skills"
          />
        </div>
      </Panel>
      <Panel bodyClassName="p-6 space-y-4">
        <h2 className={styles.cardHeading}>
          <Terminal aria-hidden />
          运行与调试
        </h2>
        <p className="text-sm text-muted">
          {agent.agent_type === "service"
            ? "使用专属机器人身份、已授权的资源与独立云电脑池。调试使用已保存的配置，也会执行实际工具操作。"
            : "使用当前对话用户的身份和个人云电脑。启用后可前往工作台，以本人身份验证已保存的配置。"}
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-primary">
          <Link to="?tab=runtime">查看执行预算</Link>
          {agent.agent_type === "service" && (
            <>
              <Link to="?tab=resources">检查权限与凭据</Link>
              <Link to="?tab=computer">查看云电脑池</Link>
            </>
          )}
        </div>
        {!agent.enabled && (
          <p className="text-sm text-muted">
            当前已停用，检查并启用后可开始调试对话。
          </p>
        )}
      </Panel>
    </div>
  );
}

function CapabilitySummary({
  agentId,
  kind,
  label,
  tab,
}: {
  agentId: string;
  kind: string;
  label: string;
  tab: string;
}) {
  const query = useApiQuery<
    BindingCollection<{ enabled?: boolean; policy?: ToolBinding["policy"] }>
  >(
    [...agentKeys, agentId, `${kind}-bindings`],
    `${agentAdminRoot}/definitions/${agentId}/${kind}-bindings`,
  );
  const items = query.data?.data.items;
  const active = items?.filter((item) =>
    kind === "tool" ? item.policy !== "deny" : item.enabled,
  ).length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="mt-1 text-xs text-muted">
          {query.isPending
            ? "正在读取…"
            : query.error
              ? "读取失败，进入配置后重试"
              : items?.length
                ? `已绑定 ${items.length} 项 · 启用 ${active} 项`
                : "未绑定 · 可选"}
        </p>
      </div>
      <Link className="text-sm text-primary" to={`?tab=${tab}&view=edit`}>
        配置{label}
      </Link>
    </div>
  );
}

export function AgentActivation({
  initial,
  enable,
  onClose,
  onSaved,
}: {
  initial: ApiResponse<AgentDefinition>;
  enable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const query = useQuery<ApiResponse<AgentDefinition>, ApiError>({
    queryKey: [...agentKeys, initial.data.id, "activation-dialog", enable],
    queryFn: ({ signal }) =>
      request<AgentDefinition>(
        `${agentAdminRoot}/definitions/${initial.data.id}${enable ? "/activation-check" : ""}`,
        { signal },
      ),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const ready = Boolean(query.data && !query.isFetching && !query.error);
  const checked = query.data ?? initial;
  const save = useResourceSave({
    path: `${agentAdminRoot}/definitions/${checked.data.id}`,
    initial: checked,
    enabled: ready,
    dirty: false,
    adopt: () => {},
    complete: onSaved,
  });
  return (
    <AgentDialog
      compact={!enable}
      icon={<ShieldCheck />}
      tone={enable ? undefined : "warning"}
      title={enable ? "启用前检查" : "停用助手"}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <AgentDialogCancel initialFocus pending={save.pending}>
            {ready ? "取消" : "关闭"}
          </AgentDialogCancel>
          {ready && (
            <Button
              variant={enable ? "default" : "danger"}
              pending={save.pending}
              disabled={save.blocked || !checked.etag}
              onClick={() => void save.save({ enabled: enable })}
            >
              {enable ? "确认启用" : "确认停用"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <h2 className="font-semibold">{checked.data.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {scopeLabel(checked.data.scope_kind)} ·{" "}
            {checked.data.scope_id ?? "所有登录用户"}
          </p>
        </div>
        {!ready && (
          <>
            {enable ? (
              <CheckResult
                pending={query.isFetching || query.isPending}
                error={query.error}
              />
            ) : (
              <AsyncBoundary loading={query.isPending} error={query.error}>
                <span />
              </AsyncBoundary>
            )}
            {query.error && (
              <Button variant="outline" onClick={() => void query.refetch()}>
                重新检查
              </Button>
            )}
          </>
        )}
        {ready &&
          (enable ? (
            <>
              <StatusBadge tone="success">
                <CheckCircle2 className="size-3" />
                启用检查通过
              </StatusBadge>
              <p className="text-sm text-muted">
                默认模型、模型能力和工具策略满足启用条件。提示词、MCP
                与技能按需配置，未添加的可选能力不会阻止启用。
              </p>
              <p className="text-sm">
                确认后，归属范围内的用户可使用此助手。启用时会再次校验最新配置。
              </p>
            </>
          ) : (
            <Notice tone="warning">
              停用后不再接受新轮次，保留历史记录；已开始的轮次继续完成。机器人账号的启停独立管理。
            </Notice>
          ))}
        {save.recovery}
      </div>
    </AgentDialog>
  );
}
