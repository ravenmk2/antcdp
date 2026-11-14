import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import {
  Field,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionPreview } from "@/components/description-preview";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type {
  AgentType,
  BindingCollection,
  ToolBinding,
  ToolCatalogEntry,
  ToolPolicy,
} from "@/types/agents";
import { agentAdminRoot, agentKeys } from "@/features/agents/data/agent-api";
import {
  ConfigActions,
  objectJSON,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import { toolSummaries } from "@/features/agents/resources/tool-presentation";

const policyNames: Record<ToolPolicy, string> = {
  allow: "允许",
  confirm: "每次确认",
  deny: "禁止",
};
type ToolDraft = { tool_key: string; policy: ToolPolicy; constraints: string };
function toolDraft(data: BindingCollection<ToolBinding>): ToolDraft[] {
  return data.items.map((item) => ({
    tool_key: item.tool_key,
    policy: item.policy,
    constraints: JSON.stringify(item.parameter_constraints, null, 2),
  }));
}
export function AgentToolBindings({
  agentId,
  mode,
  onSaved,
  readOnly = false,
}: {
  agentId: string;
  mode: AgentType;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = `${agentAdminRoot}/definitions/${agentId}/tool-bindings`;
  const query = useApiQuery<BindingCollection<ToolBinding>>(
    [...agentKeys, agentId, "tool-bindings"],
    path,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <ToolBindingsForm
          key={`${agentId}:${readOnly ? query.data.etag : "edit"}`}
          path={path}
          initial={query.data}
          mode={mode}
          onSaved={onSaved}
          readOnly={readOnly}
        />
      )}
    </AsyncBoundary>
  );
}
function ToolBindingsForm({
  path,
  initial,
  mode,
  onSaved,
  readOnly = false,
}: {
  path: string;
  initial: ApiResponse<BindingCollection<ToolBinding>>;
  mode: AgentType;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(() => toolDraft(initial.data)),
    [baseline, setBaseline] = useState(() =>
      JSON.stringify(toolDraft(initial.data)),
    );
  const [picking, setPicking] = useState(false),
    [error, setError] = useState<unknown>(),
    [selected, setSelected] = useState<Record<string, ToolCatalogEntry>>({});
  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const keys = initial.data.items
    .map((item) => item.tool_key)
    .sort()
    .join(",");
  const catalog = useQuery({
    queryKey: [...agentKeys, "bound-tool-catalog", keys],
    queryFn: async ({ signal }) => {
      const wanted = new Set(initial.data.items.map((item) => item.tool_key)),
        found: Record<string, ToolCatalogEntry> = {};
      for (let page = 1; wanted.size; page++) {
        const result = await request<ToolCatalogEntry[]>(
          `${agentAdminRoot}/tool-catalog?page=${page}&page_size=100`,
          { signal },
        );
        for (const item of result.data)
          if (wanted.delete(item.tool_key)) found[item.tool_key] = item;
        if (
          page * 100 >= (result.pagination?.total ?? result.data.length) ||
          !result.data.length
        )
          break;
      }
      return found;
    },
    retry: false,
  });
  const save = useResourceSave({
    enabled: !readOnly,
    path,
    initial,
    method: "PUT",
    dirty: JSON.stringify(draft) !== baseline,
    adopt: (data) => {
      const next = toolDraft(data);
      setDraft(next);
      setBaseline(JSON.stringify(next));
    },
    complete: onSaved,
  });
  const locked = save.pending || save.blocked;
  const searchTerm = search.trim().toLocaleLowerCase();
  const visibleDraft = draft.filter((item) => {
    const tool = selected[item.tool_key] ?? catalog.data?.[item.tool_key];
    return (
      (!policyFilter || item.policy === policyFilter) &&
      (!searchTerm ||
        [
          item.tool_key,
          tool?.name,
          tool?.description,
          toolSummaries[item.tool_key],
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(searchTerm))
    );
  });
  const groups = ["常规工具", "网络检索", "沙箱文件与执行", "待核实工具"]
    .map((title) => ({
      title,
      items: visibleDraft.filter((item) => {
        const tool = selected[item.tool_key] ?? catalog.data?.[item.tool_key];
        const group = !tool
          ? "待核实工具"
          : tool.requires_sandbox
            ? "沙箱文件与执行"
            : ["web_search", "web_fetch"].includes(item.tool_key)
              ? "网络检索"
              : "常规工具";
        return title === group;
      }),
    }))
    .filter((group) => group.items.length);
  function patch(key: string, values: Partial<ToolDraft>) {
    setDraft((items) =>
      items.map((item) =>
        item.tool_key === key ? { ...item, ...values } : item,
      ),
    );
  }
  function submit() {
    try {
      setError(undefined);
      void save.save({
        items: draft.map((item) => ({
          tool_key: item.tool_key,
          policy: item.policy,
          parameter_constraints: objectJSON(item.constraints),
        })),
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
            <h2 className="font-semibold">内置工具授权</h2>
            <p className="mt-1 text-sm text-muted">
              逐项配置内置工具的执行策略。外部服务在「MCP 服务」中独立管理。
            </p>
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              disabled={locked || draft.length >= 128}
              onClick={() => setPicking(true)}
            >
              添加工具
            </Button>
          )}
        </div>
        {mode === "service" && (
          <Notice>
            服务型使用专属机器人执行预授权动作，不支持人工批准。提问结束本轮，补充信息后开启新轮次。
          </Notice>
        )}
        {save.recovery}
        <ErrorNotice error={error} />
        <ErrorNotice error={catalog.error} />
        {catalog.isError && (
          <Button variant="outline" onClick={() => catalog.refetch()}>
            重新读取工具目录
          </Button>
        )}
        {!draft.length && (
          <Notice>尚未绑定工具。模型只能使用管理员明确允许的能力。</Notice>
        )}
        {draft.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <StandaloneInput
              className="w-80 max-w-full"
              aria-label="搜索已绑定工具"
              placeholder="搜索工具名称、标识或说明"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <StandaloneSelect
              className="w-40"
              aria-label="筛选执行策略"
              value={policyFilter}
              onValueChange={setPolicyFilter}
            >
              <option value="">全部策略</option>
              {Object.entries(policyNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </StandaloneSelect>
            {(search || policyFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setPolicyFilter("");
                }}
              >
                清除筛选
              </Button>
            )}
            <span className="text-xs text-muted" role="status">
              显示 {visibleDraft.length} / {draft.length} 项工具
            </span>
          </div>
        )}
        {draft.length > 0 && !visibleDraft.length && (
          <Notice>没有匹配的已绑定工具，请调整搜索或执行策略筛选。</Notice>
        )}
        <div className="agent-config-scroll">
          <fieldset disabled={locked} className="space-y-4">
            {groups.map((group) => (
              <div key={group.title} className="agent-tool-group">
                <div className="agent-tool-group-header">
                  <h3 className="font-medium text-foreground">{group.title}</h3>
                  <span className={readOnly ? "w-36" : "mr-22 w-36"}>
                    执行策略
                  </span>
                </div>
                {group.items.map((item) => {
                  const tool =
                    selected[item.tool_key] ?? catalog.data?.[item.tool_key];
                  const constraintsSchema = tool?.parameter_constraints_schema;
                  const hasConstraintEditor =
                    item.constraints.trim() !== "{}" ||
                    (constraintsSchema &&
                      (constraintsSchema.additionalProperties !== false ||
                        Object.keys(
                          (constraintsSchema.properties as
                            object | undefined) ?? {},
                        ).length > 0));
                  return (
                    <section key={item.tool_key} className="agent-tool-row">
                      <div
                        className="agent-tool-overview"
                        data-read-only={readOnly || undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="break-words text-sm font-medium">
                              {tool?.name ?? item.tool_key}
                            </h4>
                            {tool && (
                              <DescriptionPreview
                                name={tool.name}
                                description={tool.description}
                                label="完整工具说明"
                              />
                            )}
                            {tool?.execution_class === "side_effect" && (
                              <StatusBadge tone="warning">有副作用</StatusBadge>
                            )}
                            {tool && !tool.availability.available && (
                              <StatusBadge tone="warning">
                                当前不可用
                              </StatusBadge>
                            )}
                            <span className="break-all font-mono text-xs text-faint">
                              {item.tool_key}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted">
                            {(tool?.source.kind === "builtin"
                              ? toolSummaries[item.tool_key]
                              : undefined) ??
                              tool?.description ??
                              (catalog.isPending
                                ? "正在读取工具说明…"
                                : "此工具当前不在可用目录中，可以移除绑定。")}
                          </p>
                        </div>
                        <div className="w-36 shrink-0">
                          {readOnly ? (
                            <StatusBadge
                              tone={
                                item.policy === "allow"
                                  ? "success"
                                  : item.policy === "confirm"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {policyNames[item.policy]}
                            </StatusBadge>
                          ) : (
                            <StandaloneSelect
                              aria-label={`${tool?.name ?? item.tool_key}的执行策略`}
                              name={`policy-${item.tool_key}`}
                              value={item.policy}
                              disabled={!tool}
                              onValueChange={(value) =>
                                patch(item.tool_key, {
                                  policy: value as ToolPolicy,
                                })
                              }
                            >
                              {(tool?.supported_policies ?? [item.policy])
                                .filter(
                                  (policy) =>
                                    mode !== "service" || policy !== "confirm",
                                )
                                .map((policy) => (
                                  <option key={policy} value={policy}>
                                    {policyNames[policy]}
                                  </option>
                                ))}
                            </StandaloneSelect>
                          )}
                        </div>
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setDraft((items) =>
                                items.filter(
                                  (current) =>
                                    current.tool_key !== item.tool_key,
                                ),
                              )
                            }
                          >
                            移除
                          </Button>
                        )}
                      </div>
                      {hasConstraintEditor && (
                        <details className="agent-tool-parameters">
                          <summary>受限参数规则</summary>
                          {readOnly ? (
                            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs">
                              {item.constraints}
                            </pre>
                          ) : (
                            <div className="mt-3 grid grid-cols-2 gap-4">
                              <Field
                                label="参数限制（JSON）"
                                hint="仅接受工具目录声明的规则字段，不支持脚本或任意授权表达式。"
                              >
                                <Textarea
                                  rows={5}
                                  className="font-mono text-xs"
                                  value={item.constraints}
                                  disabled={!tool}
                                  onChange={(event) =>
                                    patch(item.tool_key, {
                                      constraints: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <div>
                                <p className="mb-2 text-xs text-muted">
                                  工具允许的限制结构
                                </p>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-subtle p-3 text-xs">
                                  {tool
                                    ? JSON.stringify(
                                        tool.parameter_constraints_schema,
                                        null,
                                        2,
                                      )
                                    : "暂不可用"}
                                </pre>
                              </div>
                            </div>
                          )}
                        </details>
                      )}
                    </section>
                  );
                })}
              </div>
            ))}
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
              保存工具绑定
            </Button>
            <Button
              variant="outline"
              disabled={locked || JSON.stringify(draft) === baseline}
              onClick={() => setDraft(JSON.parse(baseline) as ToolDraft[])}
            >
              取消修改
            </Button>
          </ConfigActions>
        )}
        {picking && (
          <ResourcePicker<ToolCatalogEntry>
            title="选择工具"
            path={`${agentAdminRoot}/tool-catalog`}
            searchable={false}
            identify={(item) => item.tool_key}
            label={(item) => item.name}
            description={(item) =>
              item.source.kind === "builtin"
                ? (toolSummaries[item.tool_key] ?? item.description)
                : item.description
            }
            disabled={(tool) =>
              !tool.availability.available ||
              draft.some((item) => item.tool_key === tool.tool_key)
            }
            onChoose={(tool) => {
              setSearch("");
              setPolicyFilter("");
              setSelected((old) => ({ ...old, [tool.tool_key]: tool }));
              setDraft((old) => [
                ...old,
                { tool_key: tool.tool_key, policy: "deny", constraints: "{}" },
              ]);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </Panel>
  );
}
