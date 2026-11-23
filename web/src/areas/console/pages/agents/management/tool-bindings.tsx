import { ConfigActions } from "./section-actions";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import {
  Field,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Search, Wrench } from "lucide-react";
import styles from "./tools.module.css";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
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
  objectJSON,
  useResourceSave,
} from "@/features/agents/resources/admin-shared";

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
}: {
  agentId: string;
  mode: AgentType;
  onSaved: () => void;
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
          key={agentId}
          path={path}
          initial={query.data}
          mode={mode}
          onSaved={onSaved}
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
}: {
  path: string;
  initial: ApiResponse<BindingCollection<ToolBinding>>;
  mode: AgentType;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => toolDraft(initial.data));
  const [baseline, setBaseline] = useState(draft);
  const [remembered, setRemembered] = useState<Record<string, ToolDraft>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const catalog = useQuery({
    queryKey: [...agentKeys, "complete-tool-catalog"],
    queryFn: async ({ signal }) => {
      const entries: ToolCatalogEntry[] = [];
      for (let page = 1; ; page++) {
        const result = await request<ToolCatalogEntry[]>(
          `${agentAdminRoot}/tool-catalog?page=${page}&page_size=100`,
          { signal },
        );
        entries.push(...result.data);
        const total = result.pagination?.total;
        if (
          !result.data.length ||
          (total === undefined
            ? result.data.length < 100
            : entries.length >= total)
        )
          return entries;
      }
    },
    retry: false,
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    path,
    initial,
    method: "PUT",
    dirty,
    complete: onSaved,
    adopt(value) {
      const next = toolDraft(value);
      setBaseline(next);
      setDraft(next);
      setRemembered({});
      setError(undefined);
    },
  });
  const locked = save.pending || save.blocked;
  const bindings = new Map(draft.map((item) => [item.tool_key, item]));
  const tools = new Map(
    (catalog.data ?? []).map((tool) => [tool.tool_key, tool]),
  );
  const keys = [...new Set([...tools.keys(), ...bindings.keys()])];
  const enabledCount = draft.filter((item) => item.policy !== "deny").length;
  const term = search.trim().toLocaleLowerCase();
  const visible = keys.filter((key) => {
    const item = bindings.get(key),
      tool = tools.get(key);
    if (mode === "service" && key === "ask_question") return false;
    const active = !!item && item.policy !== "deny";
    return (
      (filter === "all" || (filter === "on") === active) &&
      [key, tool?.name, tool?.description, toolSummaries[key]].some((text) =>
        text?.toLocaleLowerCase().includes(term),
      )
    );
  });
  function put(item: ToolDraft) {
    setDraft((current) =>
      current.some((row) => row.tool_key === item.tool_key)
        ? current.map((row) => (row.tool_key === item.tool_key ? item : row))
        : [...current, item],
    );
  }
  function forget(key: string) {
    setDraft((current) => current.filter((item) => item.tool_key !== key));
  }
  function toggle(key: string, enabled: boolean, policies: ToolPolicy[]) {
    const item = bindings.get(key),
      tool = tools.get(key);
    if (!enabled && item) {
      setRemembered((current) => ({ ...current, [key]: item }));
      if (
        baseline.some((row) => row.tool_key === key) &&
        tool?.supported_policies.includes("deny")
      )
        put({ ...item, policy: "deny" });
      else forget(key);
    } else if (enabled && tool?.availability.available && policies.length) {
      const last = remembered[key];
      const policy =
        last && policies.includes(last.policy)
          ? last.policy
          : policies.includes("confirm")
            ? "confirm"
            : policies[0];
      put({
        tool_key: key,
        policy,
        constraints: item?.constraints ?? last?.constraints ?? "{}",
      });
    }
  }
  function submit() {
    try {
      setError(undefined);
      void save.save({
        items: draft.map((item) => {
          try {
            return {
              tool_key: item.tool_key,
              policy: item.policy,
              parameter_constraints: objectJSON(item.constraints),
            };
          } catch {
            throw new Error(
              `${tools.get(item.tool_key)?.name ?? item.tool_key}：参数限制必须是有效的 JSON 对象。`,
            );
          }
        }),
      });
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <section className={styles.scope} aria-label="内置工具">
      <header className={styles.header}>
        <div className={styles.heading}>
          <Wrench aria-hidden />
          <h2>内置工具</h2>
        </div>
        <label className={styles.search}>
          <Search size={16} aria-hidden />
          <StandaloneInput
            aria-label="搜索工具"
            placeholder="搜索工具名称、标识或用途"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </header>
      <div className={styles.filters} aria-label="工具状态">
        {(
          [
            ["all", "全部工具", keys.length],
            ["on", "已启用", enabledCount],
            ["off", "未启用", keys.length - enabledCount],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <div className={styles.scroll}>
        {save.recovery}
        <ErrorNotice error={error} />
        <AsyncBoundary
          loading={catalog.isPending}
          error={catalog.error}
          onRetry={() => catalog.refetch()}
        >
          <table aria-label="工具目录">
            <colgroup>
              <col />
              <col className={styles.categoryCol} />
              <col className={styles.policyCol} />
              <col className={styles.switchCol} />
            </colgroup>
            <thead>
              <tr>
                <th>工具与用途</th>
                <th>分类</th>
                <th>执行策略</th>
                <th>启用</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((key) => {
                const tool = tools.get(key),
                  item = bindings.get(key),
                  on = !!item && item.policy !== "deny",
                  name = tool?.name ?? key;
                const policies = (tool?.supported_policies ?? []).filter(
                  (policy) =>
                    policy !== "deny" &&
                    (mode !== "service" || policy !== "confirm"),
                );
                const canEnable =
                  !!tool?.availability.available &&
                  !!policies.length &&
                  (!!item || draft.length < 128);
                const schema = tool?.parameter_constraints_schema;
                const configurable =
                  item &&
                  (item.constraints.trim() !== "{}" ||
                    (schema &&
                      (schema.additionalProperties !== false ||
                        Object.keys(schema.properties ?? {}).length > 0)));
                const group = !tool
                  ? "目录外绑定"
                  : tool.requires_sandbox
                    ? "沙箱"
                    : key === "web_search" || key === "web_fetch"
                      ? "网络检索"
                      : key.startsWith("papi_")
                        ? "平台 API"
                        : "常规工具";
                return (
                  <Fragment key={key}>
                    <tr>
                      <td>
                        <button
                          className={styles.toolName}
                          type="button"
                          aria-expanded={expanded === key}
                          onClick={() =>
                            setExpanded(expanded === key ? null : key)
                          }
                        >
                          <ChevronDown size={14} aria-hidden />
                          <span>{name}</span>
                        </button>
                        <p className={styles.summary}>
                          {on && !tool?.availability.available && (
                            <span className={styles.issue}>当前不可用 · </span>
                          )}
                          {tool?.execution_class === "side_effect" && (
                            <span className={styles.issue}>有副作用 · </span>
                          )}
                          {toolSummaries[key] ||
                            tool?.description ||
                            (tool
                              ? "暂无用途说明"
                              : "此工具已从目录移除，可展开清理绑定。")}
                        </p>
                      </td>
                      <td>{group}</td>
                      <td>
                        {on && policies.length > 1 ? (
                          <StandaloneSelect
                            aria-label={`${name}的执行策略`}
                            disabled={locked || !tool?.availability.available}
                            value={item.policy}
                            onValueChange={(value) =>
                              put({ ...item, policy: value as ToolPolicy })
                            }
                          >
                            {policies.map((policy) => (
                              <option key={policy} value={policy}>
                                {policyNames[policy]}
                              </option>
                            ))}
                          </StandaloneSelect>
                        ) : on ? (
                          policyNames[item.policy]
                        ) : (
                          <span className={styles.muted}>
                            {!tool || !tool.availability.available
                              ? "当前不可用"
                              : !policies.length
                                ? "此身份不支持"
                                : !canEnable
                                  ? "绑定已达上限"
                                  : "—"}
                          </span>
                        )}
                      </td>
                      <td>
                        <Switch
                          aria-label={`启用${name}`}
                          checked={on}
                          disabled={locked || (!on && !canEnable)}
                          onCheckedChange={(value) =>
                            toggle(key, value, policies)
                          }
                        />
                      </td>
                    </tr>
                    {expanded === key && (
                      <tr className={styles.details}>
                        <td colSpan={4}>
                          <div className="space-y-3">
                            <code>{key}</code>
                            {tool?.description && (
                              <p className="whitespace-pre-wrap">
                                {tool.description}
                              </p>
                            )}
                            {tool?.execution_class === "side_effect" && (
                              <p>此工具可能更改外部资源。</p>
                            )}
                            {configurable && (
                              <div className={styles.rules}>
                                <Field label="参数限制（JSON）">
                                  <Textarea
                                    rows={4}
                                    className="font-mono"
                                    value={item.constraints}
                                    disabled={locked || !tool}
                                    onChange={(e) =>
                                      put({
                                        ...item,
                                        constraints: e.target.value,
                                      })
                                    }
                                  />
                                </Field>
                                {schema && (
                                  <div>
                                    <strong>允许的限制结构</strong>
                                    <pre>{JSON.stringify(schema, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                            {item && (!on || !tool) && (
                              <Button
                                variant="outline"
                                disabled={locked}
                                onClick={() => forget(key)}
                              >
                                移除绑定
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!visible.length && (
            <div className={styles.empty}>
              {keys.length ? "没有符合条件的工具" : "工具目录为空"}
              {(search || filter !== "all") && (
                <Button
                  variant="link"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
          )}
        </AsyncBoundary>
      </div>
      <ConfigActions
        dirty={dirty}
        pending={save.pending}
        blocked={save.blocked}
        showExit={false}
      >
        <Button
          variant="outline"
          disabled={locked || !dirty}
          onClick={() => {
            setDraft(baseline);
            setRemembered({});
            setError(undefined);
          }}
        >
          取消修改
        </Button>
        <Button
          disabled={locked || !dirty || !catalog.isSuccess}
          pending={save.pending}
          onClick={submit}
        >
          保存本分区
        </Button>
      </ConfigActions>
    </section>
  );
}
