import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Play, Plus, Settings2, Terminal } from "lucide-react";
import { request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { PageHeader, PanelRoot, Tabs, TabPanel } from "@/components/layout";
import { CursorPagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import type { Resource } from "@/types/collaboration";
import { JobEditor } from "./editor";
import {
  date,
  duration,
  JobStatus,
  reasonLabel,
  runStatus,
  Status,
  triggerLabel,
} from "./presentation";
import { RunView, StartForm } from "./runs";
import { Schedules, Resources } from "./settings";
import type { Job, Receipt, Run } from "./types";

export function JobsPage({ project }: { project: Resource }) {
  const { jobId, runId } = useParams();
  const [params] = useSearchParams();
  const base = `/projects/${project.id}/jobs`;
  const selected = useApiQuery<Job>(["job", base, jobId], `${base}/${jobId}`, {
    enabled: !!jobId && jobId !== "new",
    staleTime: 0,
  });
  if (jobId === "new")
    return project.can_manage ? (
      <JobEditor key={`${base}/new`} project={project} base={base} />
    ) : (
      <Notice tone="danger">只有项目管理员可以创建作业。</Notice>
    );
  if (!jobId) return <JobList project={project} base={base} />;
  return (
    <AsyncBoundary
      loading={selected.isPending}
      error={selected.error}
      onRetry={() => void selected.refetch()}
    >
      {selected.data &&
        (runId ? (
          <RunView
            key={`${base}/${runId}`}
            job={selected.data.data}
            base={`${base}/${jobId}`}
            runId={runId}
          />
        ) : params.get("edit") === "1" && selected.data.data.can_manage ? (
          <JobEditor
            key={`${base}/${jobId}`}
            job={selected.data.data}
            project={project}
            base={base}
          />
        ) : (
          <JobDetail
            key={`${base}/${jobId}`}
            job={selected.data.data}
            base={`${base}/${jobId}`}
          />
        ))}
    </AsyncBoundary>
  );
}
function JobList({ project, base }: { project: Resource; base: string }) {
  const [before, setBefore] = useState("");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const session = useSession();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["jobs", session.user.id, base, before, filter, status],
    queryFn: ({ signal }) =>
      request<{ items: Job[] }>(
        `${base}?${new URLSearchParams({ before, q: filter, status })}`,
        { signal },
      ),
    refetchInterval: 3000,
  });
  const rows = query.data?.data.items ?? [];
  const canCreate = project.can_manage && project.status === "active";
  return (
    <>
      <PageHeader
        title="项目作业"
        description="管理项目脚本、定时计划和运行记录。"
        actions={
          canCreate && (
            <Button render={<Link to={`${base}/new`} />} nativeButton={false}>
              <Plus />
              创建作业
            </Button>
          )
        }
      />
      <PanelRoot>
        <TableToolbar
          onReset={() => {
            setFilter("");
            setStatus("");
            setBefore("");
          }}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
        >
          <StandaloneInput
            aria-label="搜索作业"
            value={filter}
            placeholder="作业名称或说明"
            onChange={(event) => {
              setFilter(event.target.value);
              setBefore("");
            }}
          />
          <StandaloneSelect
            aria-label="启用状态"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setBefore("");
            }}
          >
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用 / 草稿</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={!rows.length}
          emptyTitle={filter || status ? "没有符合筛选条件的作业" : "暂无作业"}
          emptyDescription={
            filter || status || !canCreate
              ? undefined
              : "点击右上角的「创建作业」添加项目脚本。"
          }
          emptyIcon={Terminal}
        >
          <SimpleTable
            actions
            label="作业列表"
            headers={[
              "作业",
              "状态",
              "最近运行",
              "下次计划",
              "排队 / 执行中",
              "",
            ]}
          >
            {rows.map((job) => {
              const to = `${base}/${job.id}`;
              return (
                <tr
                  key={job.id}
                  className="cursor-pointer"
                  onClick={() => navigate(to)}
                >
                  <td>
                    <Link
                      to={to}
                      aria-label={job.name}
                      className="flex w-fit max-w-full items-center gap-3 rounded-md text-foreground hover:text-primary"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-primary">
                        <Terminal aria-hidden className="size-4" />
                      </span>
                      <span className="min-w-0 max-w-sm">
                        <strong className="block truncate font-medium">
                          {job.name}
                        </strong>
                        <small className="mt-0.5 block truncate text-muted">
                          {job.description || job.code}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <JobStatus job={job} />
                  </td>
                  <td>
                    {job.latest_status ? (
                      <Status value={job.latest_status} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tabular-nums whitespace-nowrap">
                    {date(job.next_fire_at)}
                  </td>
                  <td className="tabular-nums">
                    {job.queued_count} / {job.active_count}
                    <small className="mt-0.5 block text-muted">
                      并发上限 {job.max_concurrency}
                    </small>
                  </td>
                  <td>
                    <ArrowUpRight
                      className="ml-auto size-4 text-muted"
                      aria-hidden
                    />
                  </td>
                </tr>
              );
            })}
          </SimpleTable>
        </AsyncBoundary>
        <CursorPagination
          before={before}
          next={rows.length === 100 ? rows.at(-1)?.id : undefined}
          onChange={setBefore}
          olderLabel="更早作业"
        />
      </PanelRoot>
    </>
  );
}
function JobDetail({ job, base }: { job: Job; base: string }) {
  const [params, setParams] = useSearchParams();
  const items = [
    { value: "runs", label: "运行记录" },
    { value: "triggers", label: "触发记录" },
    { value: "schedules", label: "定时计划" },
    ...(job.can_manage ? [{ value: "resources", label: "资源授权" }] : []),
  ];
  const tab =
    items.find((item) => item.value === params.get("tab"))?.value ?? "runs";
  const [start, setStart] = useState(false);
  const disabledReason = !job.revision_id
    ? "保存脚本后可运行"
    : !job.enabled
      ? "启用作业后可运行"
      : !job.can_run
        ? "需要运行授权"
        : "";
  return (
    <>
      <PageHeader
        title={job.name}
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <JobStatus job={job} />
            <code className="text-xs">{job.code}</code>
            {job.description && (
              <span className="whitespace-pre-wrap">{job.description}</span>
            )}
          </div>
        }
        actions={
          <>
            {job.can_manage && (
              <Button
                variant="outline"
                render={<Link to={`${base}?edit=1`} />}
                nativeButton={false}
              >
                <Settings2 />
                编辑与调试
              </Button>
            )}
            <div className="relative">
              <Button
                disabled={Boolean(disabledReason)}
                onClick={() => setStart(true)}
              >
                <Play />
                运行作业
              </Button>
              {disabledReason && (
                <p className="mt-1 text-right text-xs text-muted">
                  {disabledReason}
                </p>
              )}
            </div>
          </>
        }
      />
      {start && (
        <StartForm job={job} base={base} onClose={() => setStart(false)} />
      )}
      <Tabs
        label="作业详情"
        items={items}
        value={tab}
        onChange={(value) => setParams({ tab: value })}
      >
        <TabPanel value="runs" className="pt-5">
          <RunList base={base} />
        </TabPanel>
        <TabPanel value="triggers" className="pt-5">
          <Triggers base={base} />
        </TabPanel>
        <TabPanel value="schedules" className="pt-5">
          <Schedules job={job} base={base} />
        </TabPanel>
        {job.can_manage && (
          <TabPanel value="resources" className="pt-5">
            <Resources job={job} base={base} />
          </TabPanel>
        )}
      </Tabs>
    </>
  );
}
function RunList({ base }: { base: string }) {
  const session = useSession();
  const navigate = useNavigate();
  const [before, setBefore] = useState("");
  const query = useQuery({
    queryKey: ["job-runs", session.user.id, base, before],
    queryFn: ({ signal }) =>
      request<{ items: Run[] }>(`${base}/runs?before=${before}`, { signal }),
    refetchInterval: 2000,
  });
  const rows = query.data?.data.items ?? [];
  return (
    <PanelRoot>
      <TableToolbar
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      >
        <span className="text-sm text-muted">
          包含手动、调试、定时和事件运行
        </span>
      </TableToolbar>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!rows.length}
        emptyTitle="暂无运行记录"
      >
        <SimpleTable
          label="运行记录"
          headers={["运行", "状态", "触发方式", "提交时间", "结束时间", "耗时"]}
        >
          {rows.map((run) => {
            const to = `${base}/runs/${run.id}`;
            return (
              <tr
                key={run.id}
                className="cursor-pointer"
                onClick={() => navigate(to)}
              >
                <td>
                  <Link
                    to={to}
                    className="link font-mono"
                    aria-label={`运行 #${run.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    #{run.id}
                  </Link>
                </td>
                <td>
                  <Status value={runStatus(run)} />
                </td>
                <td>{triggerLabel(run.trigger_kind)}</td>
                <td className="tabular-nums whitespace-nowrap">
                  {date(run.queued_at)}
                </td>
                <td className="tabular-nums whitespace-nowrap">
                  {date(run.finished_at)}
                </td>
                <td className="tabular-nums whitespace-nowrap">
                  {duration(run)}
                </td>
              </tr>
            );
          })}
        </SimpleTable>
      </AsyncBoundary>
      <CursorPagination
        before={before}
        next={rows.length === 100 ? rows.at(-1)?.id : undefined}
        onChange={setBefore}
      />
    </PanelRoot>
  );
}
function Triggers({ base }: { base: string }) {
  const [before, setBefore] = useState("");
  const q = useApiQuery<{ items: Receipt[] }>(
    ["job-triggers", base, before],
    `${base}/triggers?before=${before}`,
  );
  const rows = q.data?.data.items ?? [];
  return (
    <PanelRoot>
      <TableToolbar
        onRefresh={() => void q.refetch()}
        refreshing={q.isFetching}
      >
        <span className="text-sm text-muted">
          查看触发请求是否受理，以及被拒绝或跳过的原因。
        </span>
      </TableToolbar>
      <AsyncBoundary
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={!rows.length}
        emptyTitle="暂无手动或调试触发记录"
      >
        <SimpleTable
          label="触发记录"
          headers={["触发时间", "触发方式", "处理结果", "原因", "运行"]}
        >
          {rows.map((receipt) => (
            <tr key={receipt.id}>
              <td className="tabular-nums whitespace-nowrap">
                {date(receipt.created_at)}
              </td>
              <td>{triggerLabel(receipt.trigger_kind)}</td>
              <td>
                <Status value={receipt.outcome} />
              </td>
              <td title={receipt.reason_code || undefined}>
                {reasonLabel(receipt.reason_code)}
              </td>
              <td>
                {receipt.run_id ? (
                  <Link className="link" to={`${base}/runs/${receipt.run_id}`}>
                    运行 #{receipt.run_id}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      <CursorPagination
        before={before}
        next={rows.length === 100 ? rows.at(-1)?.id : undefined}
        onChange={setBefore}
      />
    </PanelRoot>
  );
}
