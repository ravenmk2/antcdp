import { Button } from "@/components/button";
import { AsyncBoundary, EmptyState, StatusBadge } from "@/components/feedback";
import { Field, Input, Select, StandaloneSelect } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { agentAdminRoot, agentQuery } from "@/features/agents/data/agent-api";
import {
  identityNames,
  runStatusNames,
} from "@/features/agents/resources/admin-shared";
import { useApiQuery } from "@/hooks/use-api";
import type { RunMetadata, UsageReport } from "@/types/agents";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  completenessNames,
  ModelCalls,
  tokenValue,
  UsageSummary,
} from "@/features/agents/resources/usage";
function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function AgentUsagePage() {
  const [params] = useSearchParams(),
    tab = params.get("tab") ?? "usage";
  const [draft, setDraft] = useState(() => {
    const now = new Date(),
      from = new Date(now);
    from.setDate(now.getDate() - 6);
    return {
      from: dateString(from),
      to: dateString(now),
      agent_type: "all",
      agent_id: "",
      owner_user_id: "",
      model_definition_id: "",
      provider_id: "",
    };
  });
  const [filters, setFilters] = useState(draft),
    [group, setGroup] = useState<UsageReport["group_by"]>("day"),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("all");
  const query = agentQuery({
    ...filters,
    from: new Date(`${filters.from}T00:00:00`).toISOString(),
    to: new Date(`${filters.to}T23:59:59.999`).toISOString(),
  });
  const valid = Boolean(draft.from && draft.to && draft.from <= draft.to);
  return (
    <div className="page">
      <PageHeader
        title="运行与用量"
        description="仅查看调用、状态与用量元数据；管理权限不会开放其他用户的对话正文、工具参数或文件内容。"
      />
      <nav aria-label="运行与用量分区" className="tabs mb-6 gap-1">
        {[
          ["usage", "用量汇总"],
          ["runs", "运行元数据"],
          ["calls", "模型调用"],
        ].map(([key, label]) => (
          <Link
            key={key}
            className="tab px-5 text-sm"
            aria-current={tab === key ? "page" : undefined}
            to={`?tab=${key}`}
            onClick={() => {
              setPage(1);
              setStatus("all");
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Panel bodyClassName="p-5">
        <form
          className="grid grid-cols-4 items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              setFilters({ ...draft });
              setPage(1);
            }
          }}
        >
          <Field label="开始日期">
            <Input
              type="date"
              required
              value={draft.from}
              max={draft.to}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </Field>
          <Field label="结束日期">
            <Input
              type="date"
              required
              value={draft.to}
              min={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </Field>
          <Field label="运行模式">
            <Select
              value={draft.agent_type}
              onValueChange={(value) =>
                setDraft({ ...draft, agent_type: value })
              }
            >
              <option value="all">全部身份</option>
              <option value="interactive">交互型</option>
              <option value="service">服务型</option>
            </Select>
          </Field>
          {(
            [
              ["agent_id", "智能体 ID"],
              ["owner_user_id", "用户 ID"],
              ["model_definition_id", "模型 ID"],
              ["provider_id", "提供商 ID"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={`${label}（选填）`}>
              <Input
                value={draft[key]}
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </Field>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={!valid}>
              查询
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const cleared = {
                  ...filters,
                  agent_type: "all",
                  agent_id: "",
                  owner_user_id: "",
                  model_definition_id: "",
                  provider_id: "",
                };
                setDraft(cleared);
                setFilters(cleared);
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </div>
        </form>
      </Panel>
      <Panel
        className="mt-6"
        action={
          tab === "usage" ? (
            <StandaloneSelect
              aria-label="汇总维度"
              value={group}
              onValueChange={(value) =>
                setGroup(value as UsageReport["group_by"])
              }
            >
              <option value="day">按日期</option>
              <option value="agent">按智能体</option>
              <option value="model">按模型</option>
              <option value="provider">按提供商</option>
              <option value="agent_type">按运行模式</option>
            </StandaloneSelect>
          ) : tab === "runs" ? (
            <StandaloneSelect
              aria-label="运行状态"
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <option value="all">全部状态</option>
              {Object.entries(runStatusNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </StandaloneSelect>
          ) : undefined
        }
        title={
          tab === "usage"
            ? "汇总结果"
            : tab === "runs"
              ? "运行记录"
              : "模型调用记录"
        }
      >
        {tab === "usage" ? (
          <UsageReportView query={`${query}&group_by=${group}`} />
        ) : tab === "runs" ? (
          <RunMetadataView
            query={`${query}&${agentQuery({ status })}`}
            page={page}
            onPage={setPage}
          />
        ) : (
          <ModelCalls
            path={`${agentAdminRoot}/model-calls?${agentQuery({ from: new Date(`${filters.from}T00:00:00`).toISOString(), to: new Date(`${filters.to}T23:59:59.999`).toISOString(), model_definition_id: filters.model_definition_id, provider_id: filters.provider_id })}`}
          />
        )}
      </Panel>
      {tab === "calls" && (
        <p className="mt-3 text-xs text-muted">
          模型调用支持日期、模型和提供商筛选；身份、智能体与用户筛选用于用量及运行记录。
        </p>
      )}
    </div>
  );
}
function UsageReportView({ query }: { query: string }) {
  const result = useApiQuery<UsageReport>(
    ["agent-usage", query],
    `${agentAdminRoot}/usage?${query}`,
  );
  return (
    <AsyncBoundary
      loading={result.isPending}
      error={result.error}
      onRetry={() => result.refetch()}
    >
      {result.data && (
        <>
          <UsageSummary value={result.data.data.totals} />
          <div className="mt-6">
            <SimpleTable
              headers={[
                "分组",
                "调用 / 失败",
                "输入 Token",
                "输出 Token",
                "缓存读取 / 写入",
                "用量完整性",
              ]}
              label="分组用量"
            >
              {result.data.data.items.map(({ key, totals }) => (
                <tr key={key}>
                  <td className="max-w-64 break-all">
                    {result.data.data.group_by === "agent_type"
                      ? (identityNames[key as keyof typeof identityNames] ??
                        key)
                      : key}
                  </td>
                  <td>
                    {totals.model_call_count} / {totals.failed_call_count}
                  </td>
                  <td>{tokenValue(totals.input_tokens)}</td>
                  <td>{tokenValue(totals.output_tokens)}</td>
                  <td>
                    {tokenValue(totals.cache_read_tokens)} /{" "}
                    {tokenValue(totals.cache_write_tokens)}
                  </td>
                  <td>{completenessNames[totals.usage_completeness]}</td>
                </tr>
              ))}
            </SimpleTable>
          </div>
          {result.data.data.items.length === 0 && (
            <EmptyState title="此范围没有调用记录" />
          )}
          <p className="mt-3 text-xs text-muted">
            统计生成于{" "}
            {new Date(result.data.data.generated_at).toLocaleString()}
          </p>
        </>
      )}
    </AsyncBoundary>
  );
}
function RunMetadataView({
  query,
  page,
  onPage,
}: {
  query: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const result = useApiQuery<RunMetadata[]>(
      ["agent-run-metadata", query, page],
      `${agentAdminRoot}/runs?${query}&page=${page}&page_size=20`,
    ),
    [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <AsyncBoundary
        loading={result.isPending}
        error={result.error}
        onRetry={() => result.refetch()}
      >
        <SimpleTable
          label="运行元数据"
          headers={[
            "运行 / 智能体",
            "身份 / 用户",
            "状态",
            "模型 / 工具调用",
            "开始时间",
            "操作",
          ]}
          actions
        >
          {result.data?.data.map((run) => (
            <tr key={run.id}>
              <td>
                <span className="font-mono text-xs">{run.id}</span>
                <p className="mt-1 text-xs text-muted">智能体 {run.agent_id}</p>
              </td>
              <td>
                {identityNames[run.agent_type]}
                <p className="mt-1 text-xs text-muted">
                  {run.owner_user_id ? `用户 ${run.owner_user_id}` : "服务主体"}
                </p>
              </td>
              <td>
                <StatusBadge>{runStatusNames[run.status]}</StatusBadge>
                {run.reason_code && (
                  <p className="mt-1 max-w-48 break-all text-xs text-muted">
                    诊断：{run.reason_code}
                  </p>
                )}
              </td>
              <td>
                {run.model_call_count} / {run.tool_call_count}
                {run.unknown_tool_call_count > 0 && (
                  <p className="mt-1 text-xs text-warning">
                    {run.unknown_tool_call_count} 次结果待核实
                  </p>
                )}
              </td>
              <td>
                {run.started_at
                  ? new Date(run.started_at).toLocaleString()
                  : "尚未开始"}
              </td>
              <td>
                <Button variant="ghost" onClick={() => setSelected(run.id)}>
                  调用详情
                </Button>
                {run.can_open_content && (
                  <Button
                    render={
                      <Link
                        to={
                          run.agent_type === "service"
                            ? `/admin/agents/${run.agent_id}/debug/${run.session_id}`
                            : `/agents/sessions/${run.session_id}`
                        }
                      >
                        查看会话
                      </Link>
                    }
                    nativeButton={false}
                    role="link"
                    variant="ghost"
                  />
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
        {result.data?.data.length === 0 && <EmptyState title="暂无运行记录" />}
        <Pagination
          page={page}
          size={20}
          total={result.data?.pagination?.total}
          pending={result.isFetching}
          onChange={onPage}
        />
      </AsyncBoundary>
      {selected && (
        <Drawer
          open
          wide
          title={`运行 ${selected} 的模型调用`}
          onClose={() => setSelected(null)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <ModelCalls
            path={`${agentAdminRoot}/model-calls?run_id=${selected}`}
          />
        </Drawer>
      )}
    </>
  );
}
