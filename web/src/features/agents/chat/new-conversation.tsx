import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import {
  Bot,
  ChevronDown,
  Folder,
  LockKeyhole,
  Sparkles,
  X,
} from "lucide-react";
import { Button, IconButton } from "@/components/button";
import { Field, Select } from "@/components/fields";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type {
  AgentDefinition,
  AgentSummary,
  CatalogAgent,
  StartOptions,
} from "@/types/agents";
import type { Resource } from "@/types/collaboration";
import { agentAdminRoot, agentRoot } from "../data/agent-api";
import {
  useConversationDraft,
  useConversationSend,
} from "../data/agent-runtime";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import { ChatComposer } from "./composer";
import { ProjectContextPicker } from "./project-context-picker";

export function NewConversation({
  service = false,
  agentId,
}: {
  service?: boolean;
  agentId?: string;
}) {
  const cache = useQueryClient();
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const id = service ? `new:service:${agentId}` : "new:interactive";
  const { state: draft, draft: editor } = useConversationDraft(id),
    send = useConversationSend(id);
  const [picking, setPicking] = useState(false),
    [projectPicker, setProjectPicker] = useState(false);
  const catalog = useApiQuery<(CatalogAgent | AgentSummary)[]>(
    ["agent-start-catalog", service],
    service
      ? `${agentAdminRoot}/definitions?agent_type=service&enabled=true&page=1&page_size=20`
      : `${agentRoot}/catalog?page=1&page_size=20`,
  );
  const requested =
    agentId ||
    draft.agentId ||
    params.get("agent") ||
    catalog.data?.data[0]?.id ||
    "";
  const agent = useApiQuery<CatalogAgent | AgentDefinition>(
    ["agent-start-detail", service, requested],
    service
      ? `${agentAdminRoot}/definitions/${requested}`
      : `${agentRoot}/catalog/${requested}`,
    { enabled: Boolean(requested) },
  );
  const options = useApiQuery<StartOptions>(
    ["agent-start-options", requested],
    `${agentAdminRoot}/definitions/${requested}/start-options`,
    { enabled: service && Boolean(requested) },
  );
  const defaults = service
    ? options.data?.data
    : (agent.data?.data as CatalogAgent | undefined);
  const modelOptions = defaults?.model_options;
  const projectOptions = defaults?.available_projects ?? [];
  const ownerScope = !service;
  const projectID = draft.projectId;
  const project = useApiQuery<Resource>(
    ["project", projectID],
    `/projects/${projectID}`,
    { enabled: ownerScope && Boolean(projectID) },
  );
  const chosen = projectOptions.find(({ id }) => id === projectID);
  const projectName = chosen?.name ?? project.data?.data.name;
  const projectAvailable =
    !projectID ||
    (ownerScope ? project.data?.data.status === "active" : Boolean(chosen));
  const selected =
    modelOptions?.find((model) => model.binding_id === draft.modelId) ??
    modelOptions?.find(
      (model) => model.binding_id === defaults?.default_model_binding_id,
    ) ??
    modelOptions?.[0];
  const thinking =
    selected?.thinking_options.find((option) => option.key === draft.thinking)
      ?.key ??
    selected?.thinking_options.find(
      (option) => option.key === defaults?.default_thinking_option_key,
    )?.key ??
    selected?.thinking_options[0]?.key;
  const value = agent.data?.data;
  const locked = send.state.phase !== "idle";
  const available =
    value &&
    projectAvailable &&
    (service
      ? (value as AgentDefinition).enabled &&
        (value as AgentDefinition).agent_type === "service"
      : (value as CatalogAgent).availability.available);
  const target =
    value && selected && thinking
      ? {
          create: {
            agent_id: value.id,
            model_selection: {
              model_binding_id: selected.binding_id,
              thinking_option_key: thinking,
            },
            project_context_id: projectID ?? null,
          },
        }
      : null;
  const openSession = (sessionId: string) => {
    void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
    void cache.invalidateQueries({ queryKey: ["workspace-attention"] });
    navigate(
      service
        ? `/admin/agents/${requested}/debug/${sessionId}`
        : `/agents/sessions/${sessionId}`,
    );
  };
  return (
    <section className="agent-start-panel" aria-label="开始新对话">
      <header className="agent-start-heading">
        <span className="agent-start-mark">
          <Sparkles className="size-5" />
        </span>
        <div>
          {service ? <h1>调试服务型智能体</h1> : <h2>开始一段对话</h2>}
          <p>
            {service
              ? "使用专属机器人和其云电脑池执行，权限来自机器人账号。"
              : "选择智能体，描述这次需要完成的工作。"}
          </p>
        </div>
      </header>
      <AsyncBoundary
        loading={catalog.isPending}
        error={catalog.error}
        onRetry={() => catalog.refetch()}
      >
        {catalog.data?.data.length || requested ? (
          <>
            <ChatComposer
              variant="start"
              sendLabel="开始对话"
              footerLeading={
                <span className="agent-start-lock">
                  <LockKeyhole className="size-3.5" />
                  开始后模型与思考模式不可更改
                </span>
              }
              id={id}
              target={target}
              disabled={!available || !selected || !thinking}
              onAccepted={(sessionId) => openSession(sessionId)}
              onOpenSession={openSession}
            >
              <div className="agent-start-options">
                <div className="agent-start-field">
                  <p>智能体</p>
                  <Button
                    className="agent-start-selector"
                    contentClassName="w-full min-w-0 justify-between"
                    variant="outline"
                    aria-label={`选择智能体，${value?.name ?? "尚未选择"}`}
                    title={value?.name}
                    disabled={locked || Boolean(agentId)}
                    onClick={() => setPicking(true)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Bot className="size-4 shrink-0" />
                      <span className="truncate">
                        {value?.name ?? "选择智能体"}
                      </span>
                    </span>
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
                <Field label="模型" className="agent-start-field">
                  <Select
                    disabled={locked || !selected}
                    value={selected?.binding_id ?? ""}
                    onValueChange={(modelId) =>
                      editor.patch({ modelId, thinking: "" })
                    }
                  >
                    {modelOptions?.map((model) => (
                      <option key={model.binding_id} value={model.binding_id}>
                        {model.display_name} · {model.provider_label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(selected?.thinking_options.length ?? 0) > 1 && (
                  <Field label="思考模式" className="agent-start-field">
                    <Select
                      disabled={locked || !thinking}
                      value={thinking ?? ""}
                      onValueChange={(value) =>
                        editor.patch({ thinking: value })
                      }
                    >
                      {selected?.thinking_options.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className="agent-start-field">
                  <p>
                    项目上下文{" "}
                    <span className="agent-start-optional">可选</span>
                  </p>
                  <div className="agent-start-project">
                    <Button
                      variant="outline"
                      className="agent-start-selector"
                      contentClassName="w-full min-w-0 justify-between"
                      aria-label={`选择项目上下文，${projectID ? (projectName ?? "已选项目") : "不指定项目"}`}
                      title={projectName}
                      disabled={
                        locked || (!ownerScope && projectOptions.length === 0)
                      }
                      onClick={() => setProjectPicker(true)}
                    >
                      <Folder className="size-4" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {projectID ? (projectName ?? "已选项目") : "不指定项目"}
                      </span>
                      <ChevronDown className="size-4 shrink-0" />
                    </Button>
                    {projectID && (
                      <IconButton
                        variant="ghost"
                        label="清除项目上下文"
                        size="iconSm"
                        disabled={locked}
                        onClick={() => editor.patch({ projectId: null })}
                      >
                        <X />
                      </IconButton>
                    )}
                  </div>
                </div>
              </div>
            </ChatComposer>
            <ErrorNotice
              error={agent.error || options.error || project.error}
            />
            {value && !available && (
              <Notice tone="warning">
                {defaults && !projectAvailable
                  ? "所选项目当前不可用。请选择其他项目或清除项目上下文。"
                  : "当前智能体暂不可开始会话。请重新选择，或联系管理员核对模型及授权配置。"}
              </Notice>
            )}
          </>
        ) : (
          <EmptyState
            compact
            icon={Bot}
            title="尚无可用智能体"
            description="管理员配置并启用交互型智能体后，即可从这里开始对话。"
          />
        )}
      </AsyncBoundary>
      {picking && (
        <ResourcePicker<CatalogAgent | AgentSummary>
          title="选择智能体"
          path={
            service
              ? `${agentAdminRoot}/definitions?agent_type=service&enabled=true`
              : `${agentRoot}/catalog`
          }
          identify={(item) => item.id}
          label={(item) => item.name}
          description={(item) => item.description}
          onChoose={(item) => {
            editor.patch({
              agentId: item.id,
              modelId: "",
              thinking: "",
              projectId: undefined,
            });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {projectPicker && (
        <ProjectContextPicker
          ownerScope={ownerScope}
          options={projectOptions}
          onChoose={(projectId) => {
            editor.patch({ projectId });
            setProjectPicker(false);
          }}
          onClose={() => setProjectPicker(false)}
        />
      )}
    </section>
  );
}
