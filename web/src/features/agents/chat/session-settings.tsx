import { useEffect, useState } from "react";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input, Select } from "@/components/fields";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import type {
  CatalogAgent,
  SessionConfiguration,
  SessionDetail,
  StartOptions,
} from "@/types/agents";
import { agentAdminRoot, agentRoot } from "../data/agent-api";
import { useResourceSave } from "@/features/agents/resources/admin-shared";

export function SessionSettings({
  session,
  onClose,
  onSaved,
}: {
  session: SessionDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = session.configuration.id;
  const query = useApiQuery<SessionConfiguration>(
    ["agent-session", id, "configuration"],
    `${agentRoot}/sessions/${id}/configuration`,
  );
  const [state, setState] = useState({ dirty: false, pending: false });
  return (
    <Modal
      open
      wide
      title="会话设置"
      dirty={state.dirty}
      pending={state.pending}
      onClose={onClose}
      footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <SessionSettingsForm
            initial={query.data}
            session={session}
            onState={setState}
            onSaved={onSaved}
          />
        )}
      </AsyncBoundary>
    </Modal>
  );
}
function SessionSettingsForm({
  initial,
  session,
  onState,
  onSaved,
}: {
  initial: ApiResponse<SessionConfiguration>;
  session: SessionDetail;
  onState: (state: { dirty: boolean; pending: boolean }) => void;
  onSaved: () => void;
}) {
  const from = (config: SessionConfiguration) => ({
    title: config.title,
    model_selection: config.model_selection,
  });
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data));
  const config = initial.data,
    archived = Boolean(config.archived_at),
    service = config.agent_type === "service",
    dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    initial,
    path: `${agentRoot}/sessions/${config.id}/configuration`,
    dirty,
    adopt: (value) => {
      setDraft(from(value));
      setBaseline(from(value));
    },
    complete: onSaved,
  });
  useEffect(
    () => onState({ dirty, pending: save.pending || save.blocked }),
    [dirty, save.pending, save.blocked, onState],
  );
  const options = useApiQuery<CatalogAgent | StartOptions>(
    ["agent-session", config.id, "model-options"],
    service
      ? `${agentAdminRoot}/definitions/${config.agent_id}/start-options`
      : `${agentRoot}/catalog/${config.agent_id}`,
    { enabled: !archived && session.state.agent_access_available },
  );
  const currentModel = options.data?.data.model_options.find(
    (model) => model.binding_id === draft.model_selection.model_binding_id,
  );
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const body: Record<string, unknown> = {};
        if (draft.title !== baseline.title) body.title = draft.title;
        if (
          JSON.stringify(draft.model_selection) !==
          JSON.stringify(baseline.model_selection)
        )
          body.model_selection = draft.model_selection;
        void save.save(body);
      }}
    >
      {save.recovery}
      <fieldset className="space-y-5" disabled={save.pending || save.blocked}>
        <Field label="会话标题">
          <Input
            required
            maxLength={200}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </Field>
        {config.model_locked_at && (
          <Notice>
            模型已锁定：{session.selection.model_name}
            。思考强度可调整，从下一轮执行生效。
          </Notice>
        )}
        {!archived && (
          <AsyncBoundary
            loading={options.isPending}
            error={options.error}
            onRetry={() => options.refetch()}
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="模型">
                <Select
                  disabled={Boolean(config.model_locked_at)}
                  value={draft.model_selection.model_binding_id}
                  onValueChange={(id) => {
                    const model = options.data?.data.model_options.find(
                      (item) => item.binding_id === id,
                    );
                    if (model?.thinking_options[0])
                      setDraft({
                        ...draft,
                        model_selection: {
                          model_binding_id: id,
                          thinking_option_key: model.thinking_options[0].key,
                        },
                      });
                  }}
                >
                  {options.data?.data.model_options.map((model) => (
                    <option key={model.binding_id} value={model.binding_id}>
                      {model.display_name}
                    </option>
                  ))}
                </Select>
              </Field>
              {(currentModel?.thinking_options.length ?? 0) > 1 && (
                <Field label="思考强度">
                  <Select
                    value={draft.model_selection.thinking_option_key}
                    onValueChange={(key) =>
                      setDraft({
                        ...draft,
                        model_selection: {
                          ...draft.model_selection,
                          thinking_option_key: key,
                        },
                      })
                    }
                  >
                    {currentModel?.thinking_options.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </AsyncBoundary>
        )}
        {!archived && !session.state.agent_access_available && (
          <Notice tone="warning">
            当前已无此智能体的使用权限，仍可查看会话历史。
          </Notice>
        )}
      </fieldset>
      <Button
        type="submit"
        pending={save.pending}
        disabled={save.blocked || !dirty}
      >
        保存会话设置
      </Button>
    </form>
  );
}
