import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowDownToLine, Bug, ExternalLink, Play, Search } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { ErrorNotice, LoadingState, Notice } from "@/components/feedback";
import {
  Field,
  Select,
  StandaloneInput,
  StandaloneSelect,
} from "@/components/fields";
import { PageHeader } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { uuid } from "@/lib/utils";
import {
  date,
  defaults,
  duration,
  Inputs,
  JobSection,
  JSONView,
  runStatus,
  Status,
  triggerLabel,
  reasonLabel,
} from "./presentation";
import {
  statusLabel,
  terminal,
  type Config,
  type Job,
  type Log,
  type Observation,
  type Parameter,
  type Receipt,
  type ResourceCall,
  type Run,
} from "./types";

function compatibleInputs(parameters: Parameter[], values: Run["inputs"]) {
  const entries: [string, string | string[]][] = [];
  for (const parameter of parameters) {
    if (!Object.hasOwn(values, parameter.name)) continue;
    const value = values[parameter.name];
    if (parameter.type === "multiselect") {
      if (!Array.isArray(value)) continue;
      const choices = value.filter((choice) =>
        parameter.options?.includes(choice),
      );
      if (!value.length || choices.length)
        entries.push([parameter.name, choices]);
    } else if (
      typeof value === "string" &&
      (parameter.type === "text" || parameter.options?.includes(value))
    ) {
      entries.push([parameter.name, value]);
    }
  }
  return Object.fromEntries(entries);
}

export function StartForm({
  job,
  base,
  config,
  rerun,
  onStarted,
  onClose,
}: {
  job: Job;
  base: string;
  config?: Config;
  rerun?: Run;
  onStarted?: (id: string) => void;
  onClose?: () => void;
}) {
  const debug = !!config;
  const parameters = config?.parameters ?? job.parameters ?? [];
  const [values, setValues] = useState<Run["inputs"]>(
    () => rerun?.inputs ?? {},
  );
  const [state, setState] = useState("debug");
  const [attempted, setAttempted] = useState(false);
  const currentValues = {
    ...defaults(parameters),
    ...compatibleInputs(parameters, values),
  };
  const missing = new Set(
    parameters
      .filter((p) => {
        if (!p.required) return false;
        const value = Object.hasOwn(currentValues, p.name)
          ? currentValues[p.name]
          : undefined;
        return Array.isArray(value) ? !value.length : !value?.trim();
      })
      .map((p) => p.name),
  );
  const historical = rerun?.inputs ?? {};
  const carried = compatibleInputs(parameters, historical);
  const hasChangedInputs = Object.entries(historical).some(
    ([key, value]) =>
      !Object.hasOwn(carried, key) ||
      JSON.stringify(carried[key]) !== JSON.stringify(value),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [receipt, setReceipt] = useState<Receipt>();
  const retry = useRef<{ body: string; key: string } | null>(null);
  const navigate = useNavigate();
  async function submit() {
    if (pending) return;
    setError(undefined);
    setReceipt(undefined);
    setAttempted(true);
    if (config && !config.run_as_user_id) {
      setError(new Error("请先在作业配置中选择运行账号"));
      return;
    }
    if (missing.size) return;
    setPending(true);
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
        retry.current = { body: serialized, key: uuid() };
      const r = await request<Receipt>(`${base}/${debug ? "debug" : "runs"}`, {
        method: "POST",
        body: { ...body, request_key: retry.current!.key },
      });
      setReceipt(r.data);
      retry.current = null;
      if (r.data.run_id) {
        if (onStarted) onStarted(r.data.run_id);
        else {
          onClose?.();
          navigate(`${base}/runs/${r.data.run_id}`);
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  const submitButton = (
    <Button pending={pending} onClick={() => void submit()}>
      {debug ? <Bug /> : <Play />}
      {debug ? "启动调试" : "确认运行"}
    </Button>
  );
  const fields = (
    <div className="space-y-4">
      {parameters.length > 0 && (
        <Inputs
          parameters={parameters}
          value={currentValues}
          onChange={setValues}
          missing={attempted ? missing : undefined}
        />
      )}
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
        <Notice
          tone="warning"
          title={statusLabel[receipt.outcome] ?? receipt.outcome}
        >
          <span title={receipt.reason_code}>
            {reasonLabel(receipt.reason_code)}
          </span>
        </Notice>
      )}
    </div>
  );
  if (!onClose) {
    return (
      <div className="space-y-4">
        {fields}
        {submitButton}
      </div>
    );
  }
  const Overlay = parameters.length ? Drawer : Modal;
  return (
    <Overlay
      open
      onClose={onClose}
      pending={pending}
      title={rerun ? "重新运行" : "运行作业"}
      description={`「${job.name}」将使用当前已保存的配置。${parameters.length ? "" : "此作业无需输入参数。"}`}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          {submitButton}
        </>
      }
    >
      {rerun && (parameters.length > 0 || hasChangedInputs) && (
        <p className="mb-4 text-sm text-muted">
          {hasChangedInputs
            ? "已按当前配置处理上次运行中失效的参数或选项，请核对后再运行。"
            : "已带入上次运行中仍适用于当前配置的参数。"}
        </p>
      )}
      {fields}
    </Overlay>
  );
}
export function RunView({
  job,
  base,
  runId,
  embedded = false,
}: {
  job: Job;
  base: string;
  runId: string;
  embedded?: boolean;
}) {
  const [data, setData] = useState<Observation>();
  const [logs, setLogs] = useState<Log[]>([]);
  const [calls, setCalls] = useState<ResourceCall[]>([]);
  const [level, setLevel] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const [seenSeq, setSeenSeq] = useState(0);
  const logPane = useRef<HTMLDivElement>(null);
  const session = useSession();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [rerun, setRerun] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>();
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
  }, [logs, follow, level, kind, search]);
  const term = search.trim().toLocaleLowerCase();
  const visibleLogs = logs.filter(
    (log) =>
      (!level || log.level === level) &&
      (!kind || log.kind === kind) &&
      (!term ||
        `${log.message} ${JSON.stringify(log.fields ?? {})}`
          .toLocaleLowerCase()
          .includes(term)),
  );
  const unseen = follow
    ? 0
    : visibleLogs.filter((log) => log.seq > seenSeq).length;
  const run = data?.run;
  const ended = run ? terminal(run.status) : false;
  const canCancel = data?.can_cancel && run && !ended;

  function changeFollow(next: boolean) {
    setFollow(next);
    setSeenSeq(logs.at(-1)?.seq ?? 0);
  }

  function showErrors() {
    changeFollow(false);
    setLevel("error");
    setKind("");
    setSearch("");
    if (logPane.current) logPane.current.scrollTop = 0;
  }

  async function cancel() {
    if (pending) return;
    setPending(true);
    setCancelError(undefined);
    try {
      await request(`${base}/runs/${runId}/cancel`, {
        method: "POST",
        body: {},
      });
      setConfirmCancel(false);
      setAttempt((a) => a + 1);
    } catch (e) {
      setCancelError(e);
    } finally {
      setPending(false);
    }
  }
  const cancelAction = canCancel && (
    <Button variant="dangerSoft" onClick={() => setConfirmCancel(true)}>
      取消运行
    </Button>
  );
  const status = run && <Status value={runStatus(run)} />;
  const runTitle = embedded ? `调试 #${runId}` : `运行 #${runId}`;

  return (
    <section className="space-y-4">
      {embedded ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 pb-3">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold">{runTitle}</h3>
            {status}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cancelAction}
            <Button
              variant="outline"
              render={<Link to={`${base}/runs/${runId}`} />}
              nativeButton={false}
            >
              <ExternalLink /> 运行详情
            </Button>
          </div>
        </header>
      ) : (
        <PageHeader
          title={runTitle}
          description={
            run && (
              <div className="flex flex-wrap items-center gap-3 tabular-nums">
                {status}
                <span className="font-medium text-foreground">{job.name}</span>
                <span>{triggerLabel(run.trigger_kind)}触发</span>
                <span>{date(run.queued_at)}</span>
                {run.started_at && run.finished_at && (
                  <span>耗时 {duration(run)}</span>
                )}
              </div>
            )
          }
          actions={
            <>
              {run && job.can_run && job.enabled && (
                <Button variant="outline" onClick={() => setRerun(true)}>
                  <Play /> 重新运行
                </Button>
              )}
              {cancelAction}
            </>
          }
        />
      )}
      <ErrorNotice error={error} />
      {!run && !error && <LoadingState label="正在加载运行详情…" />}
      {confirmCancel && canCancel && (
        <ConfirmDialog
          open
          title="取消这次运行？"
          description={`将向运行 #${runId} 提交取消请求。`}
          confirmLabel="确认取消运行"
          danger
          pending={pending}
          onClose={() => setConfirmCancel(false)}
          onConfirm={() => void cancel()}
        >
          <ErrorNotice error={cancelError} />
        </ConfirmDialog>
      )}
      {rerun && run && (
        <StartForm
          job={job}
          base={base}
          rerun={run}
          onClose={() => setRerun(false)}
        />
      )}
      {run?.error_code && (
        <Notice
          tone={run.status === "cancelled" ? "neutral" : "danger"}
          title={run.error_summary || reasonLabel(run.error_code)}
        >
          <code className="text-xs">{run.error_code}</code>
        </Notice>
      )}
      {run && (
        <div
          className={
            embedded
              ? "space-y-4"
              : "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5 max-lg:grid-cols-1"
          }
        >
          <section className="min-w-0 overflow-hidden rounded-xl border border-border">
            <header className="space-y-3 border-b border-border bg-surface-subtle px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">运行日志</h2>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {!ended && (
                    <span
                      className="size-1.5 rounded-full bg-info"
                      aria-hidden
                    />
                  )}
                  {level || kind || term
                    ? `${visibleLogs.length} / ${logs.length}`
                    : logs.length}{" "}
                  条 · {ended ? "已结束" : "实时更新"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-40 flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  />
                  <StandaloneInput
                    className="pl-9"
                    aria-label="搜索日志"
                    placeholder="搜索日志"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <StandaloneSelect
                  aria-label="日志级别"
                  value={level}
                  onValueChange={setLevel}
                >
                  <option value="">全部级别</option>
                  <option value="info">信息</option>
                  <option value="warn">警告</option>
                  <option value="error">错误</option>
                </StandaloneSelect>
                <StandaloneSelect
                  aria-label="日志类别"
                  value={kind}
                  onValueChange={setKind}
                >
                  <option value="">全部类别</option>
                  <option value="script">脚本</option>
                  <option value="execution">执行</option>
                  <option value="resource">资源</option>
                </StandaloneSelect>
                {logs.some((log) => log.level === "error") && (
                  <Button size="sm" variant="outline" onClick={showErrors}>
                    定位首条错误
                  </Button>
                )}
                {!ended && (
                  <label className="flex items-center gap-1.5 px-2 text-xs whitespace-nowrap text-muted">
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => changeFollow(e.target.checked)}
                    />
                    自动跟随
                  </label>
                )}
                {unseen > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => changeFollow(true)}
                  >
                    <ArrowDownToLine /> {unseen} 条新日志
                  </Button>
                )}
              </div>
            </header>
            <div
              ref={logPane}
              aria-label="日志内容"
              tabIndex={0}
              onScroll={(e) => {
                const pane = e.currentTarget;
                if (
                  follow &&
                  pane.scrollHeight - pane.scrollTop - pane.clientHeight > 40
                )
                  changeFollow(false);
              }}
              className={`overflow-auto bg-surface px-4 py-2 font-mono text-xs leading-6 ${embedded ? "max-h-80" : "max-h-[min(65vh,720px)] min-h-40"}`}
            >
              {visibleLogs.map((log) => (
                <div
                  key={log.seq}
                  className="grid grid-cols-[72px_50px_minmax(0,1fr)] gap-3 border-b border-border/70 py-1 last:border-0"
                >
                  <time className="text-muted" dateTime={log.occurred_at}>
                    {new Date(log.occurred_at).toLocaleTimeString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                  <strong
                    className={`font-medium uppercase ${log.level === "error" ? "text-danger" : log.level === "warn" ? "text-warning" : "text-info"}`}
                  >
                    {log.level}
                  </strong>
                  <div className="whitespace-pre-wrap wrap-anywhere">
                    <div>{log.message}</div>
                    {log.fields && Object.keys(log.fields).length > 0 && (
                      <details className="text-muted">
                        <summary className="w-fit cursor-pointer select-none">
                          详细字段
                        </summary>
                        <JSONView value={log.fields} />
                      </details>
                    )}
                  </div>
                </div>
              ))}
              {!visibleLogs.length && (
                <p className="py-4 text-center text-muted">
                  {logs.length
                    ? "没有符合筛选条件的日志"
                    : ended
                      ? "本次运行没有日志"
                      : "等待日志…"}
                </p>
              )}
            </div>
            {run.script_logs_truncated && (
              <p className="border-t border-border px-4 py-3 text-sm text-muted">
                脚本日志已达到配额，执行和资源审计记录仍会保留。
              </p>
            )}
          </section>

          <aside
            className="min-w-0 overflow-hidden rounded-xl border border-border"
            aria-label="运行上下文"
          >
            <h2 className="px-4 pt-4 text-sm font-semibold">运行信息</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm tabular-nums">
              {[
                ["提交时间", date(run.queued_at)],
                ["开始时间", date(run.started_at)],
                ["结束时间", date(run.finished_at)],
                [
                  "状态存储",
                  run.state_mode === "debug" ? "调试状态" : "正式状态",
                ],
                ["运行账号", `账号 #${run.run_as_user_id}`],
                [
                  "发起方",
                  run.actor_user_id
                    ? `用户 #${run.actor_user_id}`
                    : triggerLabel(run.trigger_kind),
                ],
              ].map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <JobSection title="运行结果" initiallyOpen={run.has_result}>
              {run.has_result ? (
                <JSONView value={run.result} />
              ) : (
                <p className="text-sm text-muted">
                  {ended ? "没有返回值" : "等待运行结束"}
                </p>
              )}
            </JobSection>
            <JobSection
              title="输入参数"
              detail={Object.keys(run.inputs).length || "无"}
            >
              {Object.keys(run.inputs).length ? (
                <JSONView value={run.inputs} />
              ) : (
                <p className="text-sm text-muted">本次运行没有输入参数。</p>
              )}
            </JobSection>
            <JobSection title="资源访问" detail={`${calls.length} 条`}>
              {calls.map((call) => (
                <article
                  key={call.id}
                  className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <code>#{call.id}</code>
                    <span>
                      {call.resource_kind === "dingtalk_robot"
                        ? "钉钉机器人"
                        : call.resource_kind}{" "}
                      · {call.operation}
                    </span>
                    <Status
                      value={
                        call.resource_kind === "dingtalk_robot" &&
                        call.outcome === "succeeded"
                          ? "accepted"
                          : call.outcome
                      }
                    />
                  </div>
                  <p className="text-xs wrap-anywhere text-muted">
                    {call.target}
                    {call.error_code && ` · ${call.error_code}`}
                  </p>
                  <details className="text-xs text-muted">
                    <summary className="mb-2 cursor-pointer">资源详情</summary>
                    <JSONView value={job.can_manage ? call : call.resource} />
                  </details>
                </article>
              ))}
              {!calls.length && (
                <p className="text-sm text-muted">本次没有资源访问。</p>
              )}
            </JobSection>
          </aside>
        </div>
      )}
    </section>
  );
}
