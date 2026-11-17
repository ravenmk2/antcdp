import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Settings2, Terminal, Save, Bug, X } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Field, Input, Textarea, Select } from "@/components/fields";
import { Panel, PageHeader } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource, MemberPage, ScopedRole } from "@/types/collaboration";
import { ScriptEditor } from "./script-editor";
import { Bindings } from "./bindings";
import {
  exampleScript,
  statusLabel,
  terminal,
  type Job,
  type Parameter,
  type Config,
  type Run,
  type Observation,
  type Log,
  type Receipt,
  type Grant,
  type ResourceCall,
} from "./types";
import { Schedules, Resources } from "./settings";

export const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export function Status({ value }: { value: string }) {
  return (
    <StatusBadge
      tone={
        value === "succeeded" || value === "accepted"
          ? "success"
          : ["failed", "timed_out", "denied", "rejected"].includes(value)
            ? "danger"
            : "neutral"
      }
    >
      {statusLabel[value] ?? value}
    </StatusBadge>
  );
}
function runStatus(run: Run) {
  return run.status === "stopping"
    ? run.stop_reason === "RUN_TIMEOUT"
      ? "超时收尾中"
      : "失败收尾中"
    : run.status;
}
export function JSONView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-surface-hover p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2) ?? "—"}
    </pre>
  );
}
export function Inputs({
  parameters,
  value,
  onChange,
}: {
  parameters: Parameter[];
  value: Record<string, string | string[]>;
  onChange: (value: Record<string, string | string[]>) => void;
}) {
  return (
    <div className="space-y-4">
      {parameters.map((p) => (
        <Field key={p.name} label={p.label} required={p.required} hint={p.name}>
          {p.type === "multiselect" ? (
            <div className="flex flex-wrap gap-3">
              {p.options?.map((option) => (
                <label
                  key={option}
                  className="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={
                      Array.isArray(value[p.name]) &&
                      (value[p.name] as string[]).includes(option)
                    }
                    onChange={(e) => {
                      const current = Array.isArray(value[p.name])
                        ? (value[p.name] as string[])
                        : [];
                      onChange({
                        ...value,
                        [p.name]: e.target.checked
                          ? [...current, option]
                          : current.filter((x) => x !== option),
                      });
                    }}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : p.type === "select" ? (
            <Select
              value={
                typeof value[p.name] === "string"
                  ? (value[p.name] as string)
                  : ""
              }
              onValueChange={(selected) => {
                const next = { ...value };
                if (selected) next[p.name] = selected;
                else delete next[p.name];
                onChange(next);
              }}
            >
              <option value="">请选择</option>
              {p.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={value[p.name] ?? ""}
              onChange={(e) => onChange({ ...value, [p.name]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}
export function defaults(parameters: Parameter[]) {
  return Object.fromEntries(
    parameters
      .filter((p) => p.default !== undefined)
      .map((p) => [p.name, p.default!]),
  ) as Record<string, string | string[]>;
}

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
      <Notice tone="danger">只有项目管理员可以创建任务。</Notice>
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
  return (
    <>
      <PageHeader
        title="项目任务"
        description="通过脚本自动化项目流程，集中查看手动、调试与定时运行。"
        actions={
          project.can_manage && project.status === "active" ? (
            <Button render={<Link to={`${base}/new`} />} nativeButton={false}>
              <Plus />
              创建任务
            </Button>
          ) : undefined
        }
      />
      <Panel
        title="任务列表"
        action={
          project.can_manage && (
            <Link
              className="link text-sm"
              to={`/projects/${project.id}/dingtalk`}
            >
              钉钉机器人
            </Link>
          )
        }
      >
        <div className="flex items-end gap-5">
          <Field label="搜索任务">
            <Input
              value={filter}
              placeholder="任务名称或说明"
              onChange={(e) => {
                setFilter(e.target.value);
                setBefore("");
              }}
            />
          </Field>
          <Field label="启用状态">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setBefore("");
              }}
            >
              <option value="">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用 / 草稿</option>
            </Select>
          </Field>
        </div>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          <div className="mt-5 divide-y divide-border">
            <div className="grid grid-cols-[minmax(240px,1fr)_85px_130px_90px_185px] gap-5 px-4 py-3 text-xs text-muted">
              <span>任务</span>
              <span>状态</span>
              <span>排队 / 执行中</span>
              <span>最近运行</span>
              <span>下次计划</span>
            </div>
            {rows.map((j) => (
              <Link
                key={j.id}
                to={`${base}/${j.id}`}
                className="grid grid-cols-[minmax(240px,1fr)_85px_130px_90px_185px] items-center gap-5 rounded-lg px-4 py-5 hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <Terminal className="size-4 shrink-0 text-primary" />
                    <span className="truncate">{j.name}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {j.description || "暂无说明"}
                  </p>
                </div>
                <StatusBadge tone={j.enabled ? "success" : "neutral"}>
                  {!j.revision_id ? "草稿" : j.enabled ? "已启用" : "已停用"}
                </StatusBadge>
                <span className="text-sm text-muted">
                  {j.queued_count} / {j.active_count}
                  <span className="mt-1 block text-xs">
                    并发上限 {j.max_concurrency}
                  </span>
                </span>
                <span>
                  {j.latest_status ? <Status value={j.latest_status} /> : "—"}
                </span>
                <span className="text-sm text-muted">
                  {date(j.next_fire_at)}
                </span>
              </Link>
            ))}
            {!rows.length && (
              <div className="py-16 text-center text-muted">
                {filter || status
                  ? "没有符合筛选条件的任务"
                  : "暂无任务。创建一个脚本任务开始自动化。"}
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-3">
            {before && (
              <Button variant="outline" onClick={() => setBefore("")}>
                返回最新
              </Button>
            )}
            {rows.length === 100 && (
              <Button
                variant="outline"
                onClick={() => setBefore(rows.at(-1)!.id)}
              >
                更早任务
              </Button>
            )}
          </div>
        </AsyncBoundary>
      </Panel>
    </>
  );
}
function JobDetail({ job, base }: { job: Job; base: string }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "runs";
  const [start, setStart] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={base.slice(0, base.lastIndexOf("/"))}>← 任务列表</Link>
        }
        title={job.name}
        description={job.description || "项目脚本任务"}
        actions={
          <>
            <StatusBadge>
              {!job.revision_id ? "草稿" : job.enabled ? "已启用" : "已停用"}
            </StatusBadge>
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
            <Button
              disabled={!job.can_run || !job.enabled}
              onClick={() => setStart(!start)}
            >
              <Play />
              运行任务
            </Button>
          </>
        }
      />
      {start && (
        <Panel
          title="运行参数"
          action={
            <Button variant="ghost" onClick={() => setStart(false)}>
              <X />
              关闭
            </Button>
          }
        >
          <StartForm job={job} base={base} />
        </Panel>
      )}
      <div className="flex gap-2 border-b border-border pb-3">
        {[
          ["runs", "运行记录"],
          ["triggers", "触发记录"],
          ["schedules", "定时计划"],
          ...(job.can_manage ? [["resources", "资源授权"]] : []),
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "secondary" : "ghost"}
            onClick={() => setParams({ tab: key! })}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "runs" ? (
        <RunList base={base} />
      ) : tab === "triggers" ? (
        <Triggers base={base} />
      ) : tab === "schedules" ? (
        <Schedules job={job} base={base} />
      ) : tab === "resources" && job.can_manage ? (
        <Resources job={job} base={base} />
      ) : null}
    </>
  );
}
function RunList({ base }: { base: string }) {
  const session = useSession();
  const [before, setBefore] = useState("");
  const query = useQuery({
    queryKey: ["job-runs", session.user.id, base, before],
    queryFn: () => request<{ items: Run[] }>(`${base}/runs?before=${before}`),
    refetchInterval: 2000,
  });
  const rows = query.data?.data.items ?? [];
  return (
    <Panel
      title="运行记录"
      action={<span className="text-xs text-muted">每 2 秒更新</span>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <div className="divide-y divide-border">
          {rows.map((run) => (
            <Link
              to={`${base}/runs/${run.id}`}
              key={run.id}
              className="grid grid-cols-[140px_140px_120px_1fr_1fr] items-center gap-5 rounded-lg px-4 py-4 text-sm hover:bg-surface-hover"
            >
              <span className="font-mono">#{run.id}</span>
              <span>
                <Status value={runStatus(run)} />
              </span>
              <span>
                {{ manual: "手动", debug: "调试", schedule: "定时" }[
                  run.trigger_kind
                ] ?? run.trigger_kind}
              </span>
              <span className="text-muted">提交于 {date(run.queued_at)}</span>
              <span className="text-muted">结束于 {date(run.finished_at)}</span>
            </Link>
          ))}
          {!rows.length && (
            <p className="py-12 text-center text-muted">暂无运行记录</p>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          {before && (
            <Button variant="outline" onClick={() => setBefore("")}>
              返回最新
            </Button>
          )}
          {rows.length === 100 && (
            <Button
              variant="outline"
              onClick={() => setBefore(rows.at(-1)!.id)}
            >
              更早记录
            </Button>
          )}
        </div>
      </AsyncBoundary>
    </Panel>
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
    <Panel title="触发记录">
      <AsyncBoundary
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-6 border-b border-border py-4 text-sm"
          >
            <span>{date(r.created_at)}</span>
            <Status value={r.outcome} />
            <span className="flex-1 text-muted">{r.reason_code}</span>
            {r.run_id && (
              <Link className="link" to={`${base}/runs/${r.run_id}`}>
                运行 #{r.run_id}
              </Link>
            )}
          </div>
        ))}
        {!rows.length && (
          <p className="py-8 text-muted">暂无手动或调试触发记录</p>
        )}
        <div className="mt-4 flex gap-3">
          {before && <Button onClick={() => setBefore("")}>返回最新</Button>}
          {rows.length === 100 && (
            <Button onClick={() => setBefore(rows.at(-1)!.id)}>更早记录</Button>
          )}
        </div>
      </AsyncBoundary>
    </Panel>
  );
}
function StartForm({
  job,
  base,
  config,
  rerun,
  onStarted,
}: {
  job: Job;
  base: string;
  config?: Config;
  rerun?: Run;
  onStarted?: (id: string) => void;
}) {
  const debug = !!config;
  const parameters = config?.parameters ?? job.parameters;
  const [values, setValues] = useState(() =>
    rerun
      ? Object.fromEntries(
          Object.entries(rerun.inputs).filter(([k]) =>
            parameters.some((p) => p.name === k),
          ),
        )
      : defaults(parameters ?? []),
  );
  const [state, setState] = useState("debug");
  const currentValues = {
    ...defaults(parameters ?? []),
    ...Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        parameters?.some((p) => p.name === key),
      ),
    ),
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [receipt, setReceipt] = useState<Receipt>();
  const retry = useRef<{ body: string; key: string } | null>(null);
  const navigate = useNavigate();
  async function submit() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const body = {
        inputs: currentValues,
        ...(debug
          ? { config, state_mode: state, timeout_ms: job.timeout_ms }
          : {}),
        ...(rerun ? { rerun_of_run_id: rerun.id } : {}),
      };
      const serialized = JSON.stringify(body);
      if (retry.current?.body !== serialized)
        retry.current = { body: serialized, key: crypto.randomUUID() };
      const r = await request<Receipt>(`${base}/${debug ? "debug" : "runs"}`, {
        method: "POST",
        body: { ...body, request_key: retry.current!.key },
      });
      setReceipt(r.data);
      retry.current = null;
      if (r.data.run_id) {
        if (onStarted) onStarted(r.data.run_id);
        else navigate(`${base}/runs/${r.data.run_id}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <Inputs
        parameters={parameters ?? []}
        value={currentValues}
        onChange={setValues}
      />
      {debug && (
        <>
          <Field label="调试状态">
            <Select value={state} onValueChange={(value) => setState(value)}>
              <option value="debug">独立调试状态</option>
              <option value="default">正式状态</option>
            </Select>
          </Field>
          <Notice tone="warning">
            调试会真实发送钉钉通知。
            {state === "default"
              ? "本次也会读写正式状态。"
              : "状态写入独立的调试存储。"}
          </Notice>
        </>
      )}
      <ErrorNotice error={error} />
      {receipt && !receipt.run_id && (
        <Notice tone="warning">
          {statusLabel[receipt.outcome]}：{receipt.reason_code}
        </Notice>
      )}
      <Button pending={pending} onClick={() => void submit()}>
        {debug ? <Bug /> : <Play />}
        {debug ? "启动调试" : "确认运行"}
      </Button>
    </div>
  );
}
function JobEditor({
  job: initialJob,
  project,
  base,
}: {
  job?: Job;
  project: Resource;
  base: string;
}) {
  const [job, setJob] = useState(initialJob);
  const [debugRun, setDebugRun] = useState<string>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    code: job?.code ?? "",
    name: job?.name ?? "",
    description: job?.description ?? "",
    enabled: job?.enabled ?? false,
    max_concurrency: job?.max_concurrency ?? 1,
    busy_policy: job?.busy_policy ?? "queue",
    timeout_ms: job?.timeout_ms ?? 1800000,
  }));
  const [config, setConfig] = useState<Config>(
    () =>
      job?.config ?? { script: exampleScript, parameters: [], bindings: [] },
  );
  const [grants, setGrants] = useState<Grant[]>(job?.grants ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [debug, setDebug] = useState(false);
  async function openDebug() {
    if (job) {
      setDebug(!debug);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const draft = await request<Job>(base, {
        method: "POST",
        body: {
          ...form,
          name: form.name || "未命名任务草稿",
          enabled: false,
          grants: [],
          config: null,
        },
      });
      setJob(draft.data);
      setDebug(true);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  const initial = useRef(JSON.stringify({ form, config, grants }));
  const markSaved = useUnsaved(
    initial.current !== JSON.stringify({ form, config, grants }),
    pending,
  );
  const [memberPage, setMemberPage] = useState(1);
  const members = useApiQuery<MemberPage>(
    ["job-members", project.id, memberPage],
    `/projects/${project.id}/members?page_size=100&page=${memberPage}`,
  );
  const roles = useApiQuery<{ items: ScopedRole[] }>(
    ["job-roles", project.id],
    `/projects/${project.id}/roles`,
  );
  function toggle(kind: string, id: string, checked: boolean) {
    setGrants((g) =>
      checked
        ? [...g, { kind, id }]
        : g.filter((x) => x.kind !== kind || x.id !== id),
    );
  }
  async function save() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const r = await request<Job>(job ? `${base}/${job.id}` : base, {
        method: job ? "PUT" : "POST",
        body: { ...form, config, grants, version: job?.version ?? "" },
      });
      markSaved();
      await qc.invalidateQueries({ queryKey: ["job"] });
      await qc.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`${base}/${r.data.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={<Link to={job ? `${base}/${job.id}` : base}>← 返回任务</Link>}
        title={
          job ? `${job.revision_id ? "编辑" : "草稿"} ${job.name}` : "创建任务"
        }
        description="保存任务配置；调试可以直接执行当前编辑中的脚本。"
        actions={
          <>
            {
              <Button
                variant="outline"
                pending={pending}
                onClick={() => void openDebug()}
              >
                <Bug />
                调试
              </Button>
            }
            <Button pending={pending} onClick={() => void save()}>
              <Save />
              保存任务
            </Button>
          </>
        }
      />
      <ErrorNotice error={error} />
      <div className="grid grid-cols-[minmax(340px,0.32fr)_minmax(0,0.68fr)] items-start gap-6">
        <div className="max-h-[calc(100vh-240px)] space-y-6 overflow-auto pr-1">
          <Panel title="基本配置">
            <div className="space-y-4">
              <Field label="编码" required>
                <Input
                  value={form.code}
                  maxLength={64}
                  disabled={Boolean(job)}
                  placeholder="build_deploy"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="任务名称" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="说明">
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
              <Field label="任务状态">
                <Select
                  value={String(form.enabled)}
                  onValueChange={(value) =>
                    setForm({ ...form, enabled: value === "true" })
                  }
                >
                  <option value="true">启用</option>
                  <option value="false">停用</option>
                </Select>
              </Field>
              <Field label="任务并发数">
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={form.max_concurrency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_concurrency: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="并发满额时">
                <Select
                  value={form.busy_policy}
                  onValueChange={(value) =>
                    setForm({ ...form, busy_policy: value })
                  }
                >
                  <option value="queue">排队等待</option>
                  <option value="skip">跳过本次触发</option>
                </Select>
              </Field>
              <Field label="超时时长（秒）">
                <Input
                  type="number"
                  min="1"
                  value={form.timeout_ms / 1000}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      timeout_ms: Number(e.target.value) * 1000,
                    })
                  }
                />
              </Field>
            </div>
          </Panel>
          <Panel
            title="输入参数"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfig((c) => ({
                    ...c,
                    parameters: [
                      ...c.parameters,
                      { name: "", label: "", type: "text", required: false },
                    ],
                  }))
                }
              >
                <Plus />
                添加参数
              </Button>
            }
          >
            <ParameterEditor
              value={config.parameters}
              onChange={(parameters) =>
                setConfig((c) => ({ ...c, parameters }))
              }
            />
          </Panel>
          <Panel title="运行授权">
            <p className="mb-4 text-sm text-muted">
              项目管理员始终可以运行；其他成员按用户或项目角色授权。所有项目成员可以查看运行记录。
            </p>
            <ErrorNotice error={members.error ?? roles.error} />
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">项目成员</h4>
                {members.data?.data.items.map((m) => (
                  <label key={m.user_id} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={grants.some(
                        (g) => g.kind === "user" && g.id === m.user_id,
                      )}
                      onChange={(e) =>
                        toggle("user", m.user_id, e.target.checked)
                      }
                    />
                    {m.display_name}{" "}
                    <span className="text-muted">@{m.username}</span>
                  </label>
                ))}
                {(members.data?.data.total ?? 0) > 100 && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memberPage === 1}
                      onClick={() => setMemberPage((n) => n - 1)}
                    >
                      上一页成员
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        memberPage * 100 >= (members.data?.data.total ?? 0)
                      }
                      onClick={() => setMemberPage((n) => n + 1)}
                    >
                      下一页成员
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-medium">项目角色</h4>
                {roles.data?.data.items.map((r) => (
                  <label key={r.id} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={grants.some(
                        (g) => g.kind === "role" && g.id === r.id,
                      )}
                      onChange={(e) => toggle("role", r.id, e.target.checked)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          </Panel>
          <Panel title="资源绑定">
            <Bindings
              value={config.bindings}
              grants={job?.resource_grants ?? []}
              onChange={(bindings) => setConfig((c) => ({ ...c, bindings }))}
            />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel
            title="JavaScript 脚本"
            action={
              <span className="font-mono text-xs text-muted">
                async function main(ctx)
              </span>
            }
          >
            <ScriptEditor
              value={config.script}
              onChange={(script) => setConfig((c) => ({ ...c, script }))}
            />
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-primary">
                脚本 API 速查
              </summary>
              <pre className="mt-3 overflow-auto rounded-lg bg-surface-hover p-4 font-mono text-xs leading-6">{`ctx.inputs                         // 表单参数（只读）\nctx.run                            // 运行上下文（只读）\nctx.log.info("开始", { value: 1 })\nawait ctx.sleep(1000)\nctx.state.get("key")                // { value, etag } 或 null\nctx.state.put("key", value, { ifMatch: etag })\nctx.state.delete("key", { ifMatch: etag })\nawait ctx.dingtalk.send("robot_code", { format: "text", body: "完成" })\nawait Promise.all([operationA(), operationB()])`}</pre>
              <p className="mt-2 text-muted">
                宿主异步调用必须等待完成。服务连接调用尚未开放，调用尝试会记录审计。
              </p>
            </details>
          </Panel>
          {debug && job && (
            <Panel title="调试当前脚本">
              <StartForm
                job={{ ...job, timeout_ms: form.timeout_ms }}
                base={`${base}/${job.id}`}
                config={config}
                onStarted={setDebugRun}
              />
              {debugRun && (
                <a href="#job-debug-result" className="link mt-4 block text-sm">
                  查看调试 #{debugRun} 的日志和结果 ↓
                </a>
              )}
            </Panel>
          )}
          <Panel title="通知与资源">
            <p className="text-sm leading-6 text-muted">
              项目内钉钉机器人可直接按编码调用。服务连接和项目凭证需要先授权给任务，再设置脚本绑定。
            </p>
            <Link
              className="link mt-3 block text-sm"
              to={`/projects/${project.id}/dingtalk`}
            >
              管理项目钉钉机器人
            </Link>
            {job && (
              <Link
                className="link mt-3 block text-sm"
                to={`${base}/${job.id}?tab=resources`}
              >
                管理资源授权与绑定
              </Link>
            )}
          </Panel>
        </div>
      </div>
      {debugRun && job && (
        <div id="job-debug-result">
          <RunView
            key={debugRun}
            job={{ ...job, parameters: config.parameters }}
            base={`${base}/${job.id}`}
            runId={debugRun}
          />
        </div>
      )}
    </>
  );
}
function ParameterEditor({
  value,
  onChange,
}: {
  value: Parameter[];
  onChange: (value: Parameter[]) => void;
}) {
  function change(i: number, p: Partial<Parameter>) {
    onChange(value.map((v, n) => (n === i ? { ...v, ...p } : v)));
  }
  return (
    <div className="space-y-5">
      {value.map((p, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid grid-cols-[1fr_1fr_150px_36px] items-end gap-3">
            <Field label="参数名">
              <Input
                value={p.name}
                onChange={(e) => change(i, { name: e.target.value })}
              />
            </Field>
            <Field label="显示名称">
              <Input
                value={p.label}
                onChange={(e) => change(i, { label: e.target.value })}
              />
            </Field>
            <Field label="类型">
              <Select
                value={p.type}
                onValueChange={(value) =>
                  change(i, {
                    type: value as Parameter["type"],
                    default: undefined,
                  })
                }
              >
                <option value="text">文本</option>
                <option value="select">单选</option>
                <option value="multiselect">多选</option>
              </Select>
            </Field>
            <Button
              aria-label="删除参数"
              variant="ghost"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              <X />
            </Button>
          </div>
          {p.type !== "text" && (
            <Field label="选项（每行一个）">
              <Textarea
                value={p.options?.join("\n") ?? ""}
                onChange={(e) =>
                  change(i, { options: e.target.value.split("\n") })
                }
              />
            </Field>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.default !== undefined}
              onChange={(e) =>
                change(i, {
                  default: e.target.checked
                    ? p.type === "multiselect"
                      ? []
                      : ""
                    : undefined,
                })
              }
            />
            设置默认值
          </label>
          {p.default !== undefined && (
            <Inputs
              parameters={[{ ...p, label: "默认值", required: false }]}
              value={{ [p.name]: p.default }}
              onChange={(next) =>
                change(i, {
                  default: next[p.name] ?? (p.type === "multiselect" ? [] : ""),
                })
              }
            />
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => change(i, { required: e.target.checked })}
            />
            必填
          </label>
        </div>
      ))}
      {!value.length && (
        <p className="text-sm text-muted">此任务无需输入参数。</p>
      )}
    </div>
  );
}
function RunView({
  job,
  base,
  runId,
}: {
  job: Job;
  base: string;
  runId: string;
}) {
  const [data, setData] = useState<Observation>();
  const [logs, setLogs] = useState<Log[]>([]);
  const [calls, setCalls] = useState<ResourceCall[]>([]);
  const [level, setLevel] = useState("");
  const [kind, setKind] = useState("");
  const [follow, setFollow] = useState(true);
  const [seenSeq, setSeenSeq] = useState(0);
  const logPane = useRef<HTMLDivElement>(null);
  const session = useSession();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [rerun, setRerun] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let ended = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const r = await request<Observation>(
          `${base}/runs/${runId}?after_seq=${cursor}`,
          { signal: controller.signal },
        );
        if (ended) return;
        setData(r.data);
        setCalls((old) => {
          const merged = new Map(old.map((call) => [call.id, call]));
          for (const call of r.data.calls) merged.set(call.id, call);
          return [...merged.values()];
        });
        setError(undefined);
        const newLogs = r.data.logs.filter((l) => l.seq > cursor);
        if (newLogs.length) {
          cursor = newLogs.at(-1)!.seq;
          setLogs((old) => [
            ...old.filter((l) => l.seq < newLogs[0]!.seq),
            ...newLogs,
          ]);
        }
        if (!terminal(r.data.run.status) || cursor < r.data.run.last_log_seq)
          timer = setTimeout(
            () => void poll(),
            document.hidden
              ? 10000
              : cursor < r.data.run.last_log_seq
                ? 30
                : 1000,
          );
      } catch (e) {
        if (!ended) {
          setError(e);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setData(undefined);
            setLogs([]);
            setCalls([]);
            return;
          }
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    }
    void poll();
    return () => {
      ended = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, runId, attempt, session.user.id]);
  useEffect(() => {
    if (follow && logPane.current) {
      logPane.current.scrollTop = logPane.current.scrollHeight;
    }
  }, [logs, follow, level, kind]);
  const visibleLogs = logs.filter(
    (log) => (!level || log.level === level) && (!kind || log.kind === kind),
  );
  const unseen = follow ? 0 : logs.filter((log) => log.seq > seenSeq).length;
  const run = data?.run;
  async function cancel() {
    setPending(true);
    try {
      await request(`${base}/runs/${runId}/cancel`, {
        method: "POST",
        body: {},
      });
      setAttempt((a) => a + 1);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={<Link to={base}>← {job.name}</Link>}
        title={`运行 #${runId}`}
        description={
          run
            ? `${{ manual: "手动运行", debug: "调试运行", schedule: "定时运行" }[run.trigger_kind]} · ${date(run.queued_at)}`
            : "正在加载运行信息"
        }
        actions={
          <>
            {run && <Status value={runStatus(run)} />}
            <Button
              variant="outline"
              disabled={!job.can_run || !job.enabled}
              onClick={() => setRerun(!rerun)}
            >
              <Play />
              使用当前配置再运行
            </Button>
            {data?.can_cancel && !terminal(run!.status) && (
              <Button
                variant="dangerSoft"
                pending={pending}
                onClick={() => void cancel()}
              >
                取消运行
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={error} />
      {rerun && run && (
        <Panel title="重新运行（使用当前已保存配置）">
          <StartForm job={job} base={base} rerun={run} />
        </Panel>
      )}
      {run && (
        <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
          <div className="space-y-6">
            <Panel
              title="运行日志"
              action={
                <span className="text-xs text-muted">
                  {logs.length} 条 ·{" "}
                  {terminal(run.status) ? "已结束" : "实时更新"}
                </span>
              }
            >
              <div className="mb-3 flex items-end gap-4">
                <Field label="日志级别">
                  <Select value={level} onValueChange={setLevel}>
                    <option value="">全部级别</option>
                    <option value="info">信息</option>
                    <option value="warn">警告</option>
                    <option value="error">错误</option>
                  </Select>
                </Field>
                <Field label="日志类别">
                  <Select value={kind} onValueChange={setKind}>
                    <option value="">全部类别</option>
                    <option value="script">脚本</option>
                    <option value="execution">执行</option>
                    <option value="resource">资源</option>
                  </Select>
                </Field>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={follow}
                    onChange={(e) => {
                      setFollow(e.target.checked);
                      setSeenSeq(logs.at(-1)?.seq ?? 0);
                    }}
                  />
                  自动跟随
                </label>
                {unseen > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFollow(true)}
                  >
                    {unseen} 条新日志
                  </Button>
                )}
              </div>
              <div
                ref={logPane}
                onScroll={(e) => {
                  const pane = e.currentTarget;
                  if (
                    follow &&
                    pane.scrollHeight - pane.scrollTop - pane.clientHeight > 40
                  ) {
                    setFollow(false);
                    setSeenSeq(logs.at(-1)?.seq ?? 0);
                  }
                }}
                className="h-[420px] overflow-auto rounded-lg bg-[#101827] p-4 font-mono text-xs leading-7 text-slate-200"
              >
                {visibleLogs.map((log) => (
                  <div
                    key={log.seq}
                    className="grid grid-cols-[90px_52px_1fr] gap-3 border-b border-white/5"
                  >
                    <span className="text-slate-500">
                      {new Date(log.occurred_at).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}
                    </span>
                    <span
                      className={
                        log.level === "error"
                          ? "text-red-400"
                          : log.level === "warn"
                            ? "text-amber-300"
                            : "text-sky-400"
                      }
                    >
                      {log.level}
                    </span>
                    <div className="whitespace-pre-wrap break-all">
                      {log.message}
                      {log.fields && Object.keys(log.fields).length > 0 && (
                        <div className="text-slate-400">
                          {JSON.stringify(log.fields)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!visibleLogs.length && (
                  <p className="text-slate-500">
                    {logs.length ? "没有符合筛选条件的日志" : "等待日志…"}
                  </p>
                )}
              </div>
              {run.script_logs_truncated && (
                <p className="mt-3 text-sm text-muted">
                  脚本日志已达到配额；执行和资源审计记录继续保留。
                </p>
              )}
            </Panel>
            <Panel title="资源访问记录">
              {calls.map((call) => (
                <div key={call.id} className="border-b border-border py-3">
                  <div className="flex gap-4 text-sm">
                    <span className="font-mono">#{call.id}</span>
                    <span>
                      {call.resource_kind} · {call.operation}
                    </span>
                    <Status
                      value={
                        call.resource_kind === "dingtalk_robot" &&
                        call.outcome === "succeeded"
                          ? "accepted"
                          : call.outcome
                      }
                    />
                    <span className="text-muted">{call.error_code}</span>
                  </div>
                  <details className="mt-2 text-xs text-muted">
                    <summary>资源信息</summary>
                    <p className="my-2 break-all">目标：{call.target}</p>
                    <JSONView value={job.can_manage ? call : call.resource} />
                  </details>
                </div>
              ))}
              {!calls.length && (
                <p className="text-sm text-muted">暂无资源访问</p>
              )}
            </Panel>
          </div>
          <div className="space-y-6">
            <Panel title="运行信息">
              <dl className="space-y-4 text-sm">
                {[
                  ["提交时间", date(run.queued_at)],
                  ["开始时间", date(run.started_at)],
                  ["结束时间", date(run.finished_at)],
                  [
                    "状态存储",
                    run.state_mode === "debug" ? "调试状态" : "正式状态",
                  ],
                  [
                    "发起人",
                    run.actor_user_id
                      ? `用户 #${run.actor_user_id}`
                      : "定时计划",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="mb-1 text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel title="输入参数">
              <JSONView value={run.inputs} />
            </Panel>
            <Panel title="运行结果">
              {run.error_code && (
                <Notice tone="danger">
                  {run.error_code}
                  <pre className="mt-2 whitespace-pre-wrap text-xs">
                    {run.error_summary}
                  </pre>
                </Notice>
              )}
              {run.has_result ? (
                <JSONView value={run.result} />
              ) : (
                <p className="text-sm text-muted">
                  {terminal(run.status) ? "没有返回值" : "等待运行结束"}
                </p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
