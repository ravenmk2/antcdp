import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Select, Textarea } from "@/components/fields";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { ModelDefinition, ModelSummary } from "@/types/models";
import type { ModelBindingWrite, ModelBindings } from "@/types/agents";
import { agentAdminRoot, agentKeys } from "@/features/agents/data/agent-api";
import {
  ConfigActions,
  objectJSON,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";

type DraftBinding = ModelBindingWrite & { parametersText: string };
function draftFrom(data: ModelBindings) {
  return {
    items: data.items.map((item): DraftBinding => ({
      ...item,
      parametersText: JSON.stringify(item.generation_overrides, null, 2),
    })),
    defaultModelId:
      data.items.find((item) => item.id === data.default_model_binding_id)
        ?.model_definition_id ?? "",
  };
}
export function AgentModelBindings({
  agentId,
  onSaved,
  readOnly = false,
}: {
  agentId: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = `${agentAdminRoot}/definitions/${agentId}/model-bindings`;
  const query = useApiQuery<ModelBindings>(
    [...agentKeys, agentId, "model-bindings"],
    path,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <ModelBindingsForm
          key={`${agentId}:${readOnly ? query.data.etag : "edit"}`}
          initial={query.data}
          path={path}
          onSaved={onSaved}
          readOnly={readOnly}
        />
      )}
    </AsyncBoundary>
  );
}
function ModelBindingsForm({
  initial,
  path,
  onSaved,
  readOnly = false,
}: {
  initial: ApiResponse<ModelBindings>;
  path: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(() => draftFrom(initial.data)),
    [baseline, setBaseline] = useState(() =>
      JSON.stringify(draftFrom(initial.data)),
    );
  const [picking, setPicking] = useState(false),
    [adding, setAdding] = useState(false),
    [error, setError] = useState<unknown>();
  const details = useQueries({
    queries: draft.items.map((item) => ({
      queryKey: [
        "model-management",
        "binding-detail",
        item.model_definition_id,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request<ModelDefinition>(
          `/admin/models/definitions/${item.model_definition_id}`,
          { signal },
        ),
      retry: false,
    })),
  });
  const save = useResourceSave({
    enabled: !readOnly,
    path,
    method: "PUT",
    initial,
    dirty: JSON.stringify(draft) !== baseline,
    adopt: (data) => {
      const next = draftFrom(data);
      setDraft(next);
      setBaseline(JSON.stringify(next));
    },
    complete: onSaved,
  });
  const locked = save.pending || save.blocked || adding;
  function update(index: number, patch: Partial<DraftBinding>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  }
  async function choose(model: ModelSummary) {
    if (adding) return;
    setAdding(true);
    setError(undefined);
    try {
      const detail = await request<ModelDefinition>(
        `/admin/models/definitions/${model.id}`,
      );
      const options = detail.data.thinking_options.map((option) => option.key);
      if (!options.length)
        throw new Error("该模型尚未配置可用思考选项，请先在模型管理中配置。");
      setDraft((current) => ({
        defaultModelId: current.defaultModelId || model.id,
        items: [
          ...current.items,
          {
            model_definition_id: model.id,
            thinking_options: options,
            default_thinking: options[0],
            generation_overrides: {},
            parametersText: "{}",
          },
        ],
      }));
      setPicking(false);
    } catch (failure) {
      setError(failure);
    } finally {
      setAdding(false);
    }
  }
  function submit() {
    setError(undefined);
    try {
      const items = draft.items.map(({ parametersText, ...item }) => {
        if (
          !item.thinking_options.length ||
          !item.thinking_options.includes(item.default_thinking)
        )
          throw new Error(
            "每个模型至少选择一个思考选项，默认项必须在允许列表中。",
          );
        return {
          model_definition_id: item.model_definition_id,
          thinking_options: item.thinking_options,
          default_thinking: item.default_thinking,
          generation_overrides: objectJSON(parametersText),
        };
      });
      const selected = items.find(
        (item) => item.model_definition_id === draft.defaultModelId,
      );
      if (!selected) throw new Error("请选择默认模型。");
      void save.save({
        items,
        default_model_id: selected.model_definition_id,
        default_thinking_option_key: selected.default_thinking,
      });
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <Panel bodyClassName="p-6">
      <div className="agent-config-editor">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="font-semibold">允许使用的模型</h2>
            <p className="mt-1 text-sm text-muted">
              会话开始前可在白名单中选择；首次有效输入后锁定模型和思考配置。
            </p>
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              disabled={locked || draft.items.length >= 32}
              onClick={() => setPicking(true)}
            >
              添加模型
            </Button>
          )}
        </div>
        {save.recovery}
        <ErrorNotice error={error} />
        {!draft.items.length && (
          <Notice>尚未绑定模型。智能体启用前需要一个有效的默认模型。</Notice>
        )}
        <div className="agent-config-scroll">
          <fieldset
            disabled={locked}
            className={draft.items.length ? "agent-binding-list" : undefined}
          >
            {draft.items.map((item, index) => {
              const model = details[index].data?.data;
              return (
                <section key={item.model_definition_id} className="space-y-4">
                  <div className="flex justify-between gap-4">
                    <div>
                      <h3 className="break-words font-semibold">
                        {model?.name ?? `模型 ${item.model_definition_id}`}
                      </h3>
                      <p className="mt-1 break-all text-xs text-muted">
                        {model?.model_id}
                      </p>
                    </div>
                    {readOnly ? (
                      draft.defaultModelId === item.model_definition_id && (
                        <StatusBadge tone="info">默认模型</StatusBadge>
                      )
                    ) : (
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="default_model"
                            checked={
                              draft.defaultModelId === item.model_definition_id
                            }
                            onChange={() =>
                              setDraft({
                                ...draft,
                                defaultModelId: item.model_definition_id,
                              })
                            }
                          />
                          默认模型
                        </label>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setDraft((current) => ({
                              items: current.items.filter(
                                (_, i) => i !== index,
                              ),
                              defaultModelId:
                                current.defaultModelId ===
                                item.model_definition_id
                                  ? (current.items.find((_, i) => i !== index)
                                      ?.model_definition_id ?? "")
                                  : current.defaultModelId,
                            }))
                          }
                        >
                          移除
                        </Button>
                      </div>
                    )}
                  </div>
                  <AsyncBoundary
                    loading={details[index].isPending}
                    error={details[index].error}
                    onRetry={() => details[index].refetch()}
                  >
                    {model &&
                      (readOnly ? (
                        <dl className="agent-read-facts grid gap-5 sm:grid-cols-2">
                          <div>
                            <dt>允许的思考选项</dt>
                            <dd>
                              {item.thinking_options
                                .map(
                                  (key) =>
                                    model.thinking_options.find(
                                      (option) => option.key === key,
                                    )?.label ?? key,
                                )
                                .join("、")}
                            </dd>
                          </div>
                          <div>
                            <dt>默认思考选项</dt>
                            <dd>
                              {model.thinking_options.find(
                                (option) =>
                                  option.key === item.default_thinking,
                              )?.label ?? item.default_thinking}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <p className="mb-2 text-xs font-medium">
                              允许的思考选项
                            </p>
                            <div className="flex flex-wrap gap-4">
                              {model.thinking_options.map((option) => (
                                <label
                                  key={option.key}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={item.thinking_options.includes(
                                      option.key,
                                    )}
                                    onChange={(event) => {
                                      const next = event.target.checked
                                        ? [...item.thinking_options, option.key]
                                        : item.thinking_options.filter(
                                            (key) => key !== option.key,
                                          );
                                      update(index, {
                                        thinking_options: next,
                                        default_thinking: next.includes(
                                          item.default_thinking,
                                        )
                                          ? item.default_thinking
                                          : (next[0] ?? ""),
                                      });
                                    }}
                                  />
                                  {option.label}
                                </label>
                              ))}
                            </div>
                          </div>
                          <Field label="默认思考选项">
                            <Select
                              name={`thinking-${index}`}
                              value={item.default_thinking}
                              onValueChange={(value) =>
                                update(index, { default_thinking: value })
                              }
                            >
                              {model.thinking_options
                                .filter((option) =>
                                  item.thinking_options.includes(option.key),
                                )
                                .map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                            </Select>
                          </Field>
                        </div>
                      ))}
                  </AsyncBoundary>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">
                      模型参数覆盖
                    </summary>
                    <div className="mt-3">
                      {readOnly ? (
                        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                          {item.parametersText === "{}"
                            ? "使用模型默认参数"
                            : item.parametersText}
                        </pre>
                      ) : (
                        <Field
                          label="覆盖参数（JSON）"
                          hint="仅允许模型协议已注册的生成参数。保存时服务端校验，不可传入认证、消息或工具定义。"
                        >
                          <Textarea
                            className="font-mono text-xs"
                            rows={5}
                            value={item.parametersText}
                            onChange={(event) =>
                              update(index, {
                                parametersText: event.target.value,
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                  </details>
                </section>
              );
            })}
          </fieldset>
        </div>
        {!readOnly && (
          <ConfigActions
            dirty={JSON.stringify(draft) !== baseline}
            pending={save.pending}
            blocked={save.blocked}
          >
            <Button
              pending={save.pending}
              disabled={locked || JSON.stringify(draft) === baseline}
              onClick={submit}
            >
              保存模型绑定
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => setDraft(JSON.parse(baseline) as typeof draft)}
            >
              取消修改
            </Button>
          </ConfigActions>
        )}
        {picking && (
          <ResourcePicker<ModelSummary>
            title="选择模型"
            path="/admin/models/definitions?enabled=true"
            identify={(item) => item.id}
            label={(item) => item.name}
            description={(item) => `${item.model_id} · ${item.protocol}`}
            disabled={(item) =>
              adding ||
              draft.items.some(
                (current) => current.model_definition_id === item.id,
              )
            }
            onChoose={(item) => void choose(item)}
            onClose={() => {
              if (!adding) setPicking(false);
            }}
          />
        )}
      </div>
    </Panel>
  );
}
