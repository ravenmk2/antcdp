import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { Bot, ChevronDown, LockKeyhole, Sparkles } from "lucide-react";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
} from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type { CatalogAgent } from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import {
  useConversationDraft,
  useConversationSend,
} from "../data/agent-runtime";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import { ChatComposer } from "./composer";
import { ModelSelectionControls } from "./model-selection";

export function NewConversation({ agentId }: { agentId?: string }) {
  const { user } = useSession();
  const cache = useQueryClient();
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const routeAgent = agentId || params.get("agent") || "";
  const id = `new:chat:${routeAgent || "default"}`;
  const { state: draft, draft: editor } = useConversationDraft(id),
    send = useConversationSend(id);
  const [picking, setPicking] = useState(false);
  const fixedAgent = Boolean(agentId);
  const catalog = useApiQuery<CatalogAgent[]>(
    ["agent-start-catalog"],
    `${agentRoot}/catalog?page=1&page_size=20`,
    { enabled: !fixedAgent },
  );
  const requested =
    routeAgent || draft.agentId || catalog.data?.data[0]?.id || "";
  const agent = useApiQuery<CatalogAgent>(
    ["agent-start-detail", requested],
    `${agentRoot}/catalog/${requested}`,
    { enabled: Boolean(requested) },
  );
  const defaults = agent.data?.data;
  const modelOptions = defaults?.model_options;
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
      (option) =>
        option.key ===
        (selected.default_thinking_option_key ??
          defaults?.default_thinking_option_key),
    )?.key ??
    selected?.thinking_options[0]?.key ??
    "";
  const value = agent.data?.data;
  const greeting = value?.greeting
    ?.trim()
    .replace(/\{user\}|\{assistant\}/g, (token) =>
      token === "{user}" ? user.display_name : value.name,
    );
  const locked = send.state.phase !== "idle";
  const available = value?.availability.available;
  const target =
    value && selected
      ? {
          create: {
            agent_id: value.id,
            model_selection: {
              model_binding_id: selected.binding_id,
              thinking_option_key: thinking,
            },
          },
        }
      : null;
  const openSession = (sessionId: string) => {
    // This page and its composer each observe the send flow. Release this
    // page's guard before the composer's accepted callback navigates.
    send.release();
    void cache.invalidateQueries({ queryKey: ["agent-sessions"] });
    void cache.invalidateQueries({ queryKey: ["workspace-attention"] });
    navigate(`/chats/${sessionId}`);
  };
  const selectionControls = (
    <ModelSelectionControls
      models={modelOptions ?? []}
      value={{
        model_binding_id: selected?.binding_id ?? "",
        thinking_option_key: thinking ?? "",
      }}
      disabled={locked}
      onChange={(value) =>
        editor.patch({
          modelId: value.model_binding_id,
          thinking: value.thinking_option_key,
        })
      }
    />
  );
  if (fixedAgent)
    return (
      <section
        className="agent-chat-page agent-new-conversation"
        aria-label="新对话"
      >
        <div className="agent-new-conversation-content">
          {greeting && (
            <header className="agent-new-conversation-heading">
              <h1 className="whitespace-pre-wrap wrap-break-word">
                {greeting}
              </h1>
            </header>
          )}
          <AsyncBoundary
            loading={agent.isPending}
            error={agent.error}
            onRetry={() => agent.refetch()}
          >
            {value && !available && (
              <Notice tone="warning">当前助手暂不可开始会话。</Notice>
            )}
            <ChatComposer
              id={id}
              target={target}
              imageInput={selected?.image_input}
              disabled={!available || !selected}
              onAccepted={openSession}
              onOpenSession={openSession}
              settings={selectionControls}
            />
          </AsyncBoundary>
        </div>
      </section>
    );
  return (
    <section className="agent-start-panel" aria-label="开始新对话">
      {greeting && (
        <header className="agent-start-heading">
          <span className="agent-start-mark">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="whitespace-pre-wrap wrap-break-word">{greeting}</h1>
          </div>
        </header>
      )}
      <AsyncBoundary
        loading={catalog.isPending}
        error={catalog.error}
        onRetry={() => catalog.refetch()}
      >
        {catalog.data?.data.length || requested ? (
          <>
            <ChatComposer
              variant="start"
              settings={selectionControls}
              sendLabel="开始对话"
              footerLeading={
                <span className="agent-start-lock">
                  <LockKeyhole className="size-3.5" />
                  开始后模型锁定，思考强度可随时调整
                </span>
              }
              id={id}
              target={target}
              imageInput={selected?.image_input}
              disabled={!available || !selected}
              onAccepted={(sessionId) => openSession(sessionId)}
              onOpenSession={openSession}
            >
              <div className="agent-start-options">
                {!agentId && (
                  <div className="agent-start-field">
                    <p>助手</p>
                    <Button
                      className="agent-start-selector"
                      contentClassName="w-full min-w-0 justify-between"
                      variant="outline"
                      aria-label={`选择助手，${value?.name ?? "尚未选择"}`}
                      title={value?.name}
                      disabled={locked || Boolean(agentId)}
                      onClick={() => setPicking(true)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Bot className="size-4 shrink-0" />
                        <span className="truncate">
                          {value?.name ?? "选择助手"}
                        </span>
                      </span>
                      <ChevronDown className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </ChatComposer>
            <ErrorNotice error={agent.error} />
            {value && !available && (
              <Notice tone="warning">
                当前助手暂不可开始会话。请重新选择，或联系管理员核对模型及授权配置。
              </Notice>
            )}
          </>
        ) : (
          <EmptyState
            compact
            icon={Bot}
            title="尚无可用助手"
            description="管理员配置并启用对话型助手后，即可从这里开始对话。"
          />
        )}
      </AsyncBoundary>
      {picking && (
        <ResourcePicker<CatalogAgent>
          title="选择助手"
          path={`${agentRoot}/catalog`}
          identify={(item) => item.id}
          label={(item) => item.name}
          description={(item) => item.description}
          onChoose={(item) => {
            editor.patch({
              agentId: item.id,
              modelId: "",
              thinking: "",
            });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
