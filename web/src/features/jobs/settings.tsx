import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { useAuth } from "@/app/auth";
import { zonedDateTimeInput, zonedDateTimeCandidates } from "@/lib/date-time";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Input, Select } from "@/components/fields";
import { PanelRoot } from "@/components/layout";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { CursorPagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { resourceCodeSchema } from "@/domain/validation";
import { useApiQuery } from "@/hooks/use-api";
import type { Job, Schedule } from "./types";
import { date, defaults, Inputs, reasonLabel, Status } from "./presentation";

export function Schedules({ job, base }: { job: Job; base: string }) {
  const {
    settings: { timezone },
  } = useAuth();
  const q = useApiQuery<{ items: Schedule[] }>(
    ["job-schedules", base, timezone],
    `${base}/schedules`,
  );
  const [edit, setEdit] = useState<Schedule | null>();
  const [fires, setFires] = useState<Schedule>();
  const qc = useQueryClient();
  const schedules = q.data?.data.items ?? [];
  return (
    <div className="space-y-6">
      <PanelRoot>
        <TableToolbar
          onRefresh={() => void q.refetch()}
          refreshing={q.isFetching}
          actions={
            job.can_manage && (
              <Button disabled={!job.revision_id} onClick={() => setEdit(null)}>
                <Plus /> 添加计划
              </Button>
            )
          }
        >
          <p className="text-sm text-muted">
            {job.revision_id
              ? "按计划触发作业，服务离线期间错过的执行会跳过。"
              : "保存作业脚本后可添加定时计划。"}
          </p>
        </TableToolbar>
        <AsyncBoundary
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          empty={!schedules.length}
          emptyTitle="暂无定时计划"
          emptyIcon={CalendarClock}
          emptyDescription={
            job.can_manage && job.revision_id
              ? "添加计划后，可预览接下来五次的触发时间。"
              : undefined
          }
        >
          <SimpleTable
            actions
            label="定时计划"
            headers={[
              "计划",
              `触发时间（${timezone}）`,
              "已触发 / 上限",
              "状态",
              `下次运行（${timezone}）`,
              "操作",
            ]}
          >
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td className="font-medium">
                  <div>{schedule.name}</div>
                  <code className="text-xs text-muted">{schedule.code}</code>
                </td>
                <td>{scheduleTiming(schedule, timezone)}</td>
                <td>
                  {schedule.fire_count} / {schedule.max_fires ?? "不限"}
                </td>
                <td>
                  <StatusBadge tone={schedule.enabled ? "success" : "neutral"}>
                    {schedule.enabled ? "已启用" : "已停用"}
                  </StatusBadge>
                </td>
                <td className="tabular-nums whitespace-nowrap">
                  {date(schedule.next_fire_at, timezone)}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setFires(schedule)}>
                      触发记录
                    </Button>
                    {job.can_manage && (
                      <Button
                        variant="outline"
                        onClick={() => setEdit(schedule)}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </SimpleTable>
        </AsyncBoundary>
      </PanelRoot>
      {edit !== undefined && (
        <ScheduleForm
          key={edit?.id ?? "new"}
          base={base}
          job={job}
          schedule={edit}
          close={() => setEdit(undefined)}
          saved={async () => {
            await q.refetch();
            setEdit(undefined);
            void qc.invalidateQueries({ queryKey: ["jobs"] });
          }}
        />
      )}
      {fires && (
        <Fires
          key={fires.id}
          base={base}
          schedule={fires}
          close={() => setFires(undefined)}
        />
      )}
    </div>
  );
}
function scheduleTiming(schedule: Schedule, timezone: string) {
  return schedule.schedule_kind === "once"
    ? `一次 · ${date(schedule.run_at, timezone)}`
    : schedule.cron;
}

function ScheduleForm({
  base,
  job,
  schedule,
  close,
  saved,
}: {
  base: string;
  job: Job;
  schedule: Schedule | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const {
    settings: { timezone },
  } = useAuth();
  const [form, setForm] = useState({
    name: schedule?.name ?? "",
    code: schedule?.code ?? "",
    kind: schedule?.schedule_kind ?? "cron",
    runAt: schedule?.run_at
      ? zonedDateTimeInput(schedule.run_at, timezone)
      : "",
    limit: schedule?.max_fires?.toString() ?? "",
    cron: schedule?.cron ?? "0 9 * * 1-5",
    enteredZone: timezone,
    occurrence: schedule?.run_at ? new Date(schedule.run_at).toISOString() : "",
    enabled: schedule?.enabled ?? true,
    inputs: schedule?.inputs ?? defaults(job.parameters),
  });
  const [preview, setPreview] = useState<{ times: string[]; zone: string }>();
  const times = preview?.zone === timezone ? preview.times : [];
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<"preview" | "save">();
  const runAt =
    form.enteredZone === timezone
      ? form.runAt
      : form.occurrence
        ? zonedDateTimeInput(form.occurrence, timezone)
        : "";
  const candidates =
    form.kind === "once" ? zonedDateTimeCandidates(runAt, timezone) : [];
  const instant =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((v) => v === form.occurrence);
  const changes = JSON.stringify(form);
  const initial = useRef(changes);
  async function submit(preview: boolean) {
    if (pending) return;
    setPending(preview ? "preview" : "save");
    setError(undefined);
    try {
      if (preview) {
        const r = await request<{ times: string[] }>(
          `${base}/schedule-preview`,
          {
            method: "POST",
            body: { cron: form.cron },
          },
        );
        setPreview({ times: r.data.times, zone: timezone });
      } else {
        const code = resourceCodeSchema.safeParse(form.code);
        if (!code.success) throw new Error(code.error.issues[0].message);
        if (form.kind === "once" && runAt && !instant)
          throw new Error(
            candidates.length
              ? "请选择执行时刻。"
              : "该时间在系统时区中不存在，请重新选择。",
          );
        if (form.kind === "once" && !runAt) throw new Error("请选择执行时间。");
        if (
          form.kind === "cron" &&
          form.limit &&
          (!Number.isInteger(Number(form.limit)) ||
            Number(form.limit) < 1 ||
            Number(form.limit) > 4294967295)
        ) {
          throw new Error("最多触发次数应为 1 至 4294967295 之间的整数。");
        }
        await request(`${base}/schedules${schedule ? `/${schedule.id}` : ""}`, {
          method: schedule ? "PUT" : "POST",
          body: {
            name: form.name,
            code: form.code,
            schedule_kind: form.kind,
            enabled: form.enabled,
            inputs: form.inputs,
            version: schedule?.version ?? "0",
            cron: form.kind === "cron" ? form.cron : "",
            run_at: form.kind === "once" ? instant : null,
            max_fires:
              form.kind === "once" ? 1 : form.limit ? Number(form.limit) : null,
          },
        });
        await saved();
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(undefined);
    }
  }
  return (
    <Drawer
      open
      wide
      title={schedule ? "编辑定时计划" : "添加定时计划"}
      description="设置触发时间和作业参数。"
      onClose={close}
      pending={Boolean(pending)}
      dirty={changes !== initial.current}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            pending={pending === "save"}
            disabled={pending === "preview"}
            onClick={() => void submit(false)}
          >
            保存计划
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNotice error={error} />
        <div inert={Boolean(pending)} className="space-y-4">
          <Field label="计划名称" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field
            label="计划编码"
            required
            hint="同一作业内唯一，创建后固定。使用小写字母、数字、下划线或连字符。"
          >
            <Input
              value={form.code}
              disabled={!!schedule}
              maxLength={64}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
          <Field label="触发方式">
            <Select
              value={form.kind}
              onValueChange={(value) => {
                setForm({ ...form, kind: value === "once" ? "once" : "cron" });
                setPreview(undefined);
              }}
            >
              <option value="cron">Cron 周期运行</option>
              <option value="once">指定时间运行一次</option>
            </Select>
          </Field>
          {form.kind === "once" ? (
            <Field label={`执行时间（${timezone}）`} required>
              <Input
                type="datetime-local"
                step="0.001"
                value={runAt}
                onChange={(e) => {
                  const text = e.target.value;
                  const options = zonedDateTimeCandidates(text, timezone);
                  setForm({
                    ...form,
                    runAt: text,
                    enteredZone: timezone,
                    occurrence: options.length === 1 ? options[0]! : "",
                  });
                }}
              />
            </Field>
          ) : (
            <Field
              label="Cron 表达式"
              hint={`分钟 · 小时 · 日 · 月 · 星期，系统时区 ${timezone}`}
              required
            >
              <Input
                value={form.cron}
                className="font-mono"
                onChange={(e) => {
                  setForm({ ...form, cron: e.target.value });
                  setPreview(undefined);
                }}
              />
            </Field>
          )}
          {candidates.length > 1 && (
            <Field
              label="执行时刻"
              required
              hint="系统时区在这一天出现两次相同的本地时间。"
            >
              <Select
                value={instant ?? ""}
                onValueChange={(occurrence) =>
                  setForm({ ...form, runAt, enteredZone: timezone, occurrence })
                }
              >
                {candidates.map((v) => (
                  <option key={v} value={v}>
                    {v.replace("T", " ").replace("Z", " UTC")}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="最多触发次数"
            hint="到达上限时自动停用。重新启用计划会清零计数。"
          >
            <Input
              type="number"
              min={1}
              max={4294967295}
              step={1}
              placeholder="不限"
              disabled={form.kind === "once"}
              value={form.kind === "once" ? "1" : form.limit}
              onChange={(e) => setForm({ ...form, limit: e.target.value })}
            />
          </Field>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用此计划
          </label>
        </div>
        {form.kind === "cron" && (
          <section className="space-y-3 rounded-lg border border-border bg-surface-subtle p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">触发时间预览</h3>
              <Button
                size="sm"
                variant="outline"
                pending={pending === "preview"}
                disabled={pending === "save"}
                onClick={() => void submit(true)}
              >
                预览未来 5 次
              </Button>
            </div>
            {times.length > 0 ? (
              <ol className="space-y-1 text-sm tabular-nums" aria-live="polite">
                {times.map((t) => (
                  <li key={t}>
                    <time dateTime={t}>{date(t, timezone)}</time>
                  </li>
                ))}
                <li className="text-xs text-muted">{timezone}</li>
              </ol>
            ) : (
              <p className="text-xs text-muted">
                预览按系统时区 {timezone} 计算。
              </p>
            )}
          </section>
        )}
        <div
          inert={Boolean(pending)}
          className="space-y-3 border-t border-border pt-4"
        >
          <h3 className="text-sm font-semibold">计划运行参数</h3>
          {job.parameters.length > 0 ? (
            <Inputs
              parameters={job.parameters}
              value={form.inputs}
              onChange={(inputs) => setForm({ ...form, inputs })}
            />
          ) : (
            <p className="text-sm text-muted">此作业无需输入参数。</p>
          )}
        </div>
      </div>
    </Drawer>
  );
}
function Fires({
  base,
  schedule,
  close,
}: {
  base: string;
  schedule: Schedule;
  close: () => void;
}) {
  const {
    settings: { timezone },
  } = useAuth();
  const [before, setBefore] = useState("");
  const q = useApiQuery<{
    items: {
      id: string;
      scheduled_at: string;
      outcome: string;
      reason_code: string;
      run_id: string | null;
    }[];
  }>(
    ["job-fires", base, schedule.id, before],
    `${base}/schedules/${schedule.id}/fires?before=${before}`,
  );
  const rows = q.data?.data.items ?? [];
  return (
    <Drawer
      open
      wide
      onClose={close}
      title="计划触发记录"
      description={schedule.name}
    >
      <PanelRoot variant="plain">
        <TableToolbar
          onRefresh={() => void q.refetch()}
          refreshing={q.isFetching}
        >
          <span className="text-xs text-muted">
            {scheduleTiming(schedule, timezone)}
          </span>
        </TableToolbar>
        <AsyncBoundary
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          empty={!rows.length}
          emptyTitle="暂无触发记录"
        >
          <SimpleTable
            label="计划触发记录"
            headers={[`计划时间（${timezone}）`, "状态", "原因", "运行"]}
          >
            {rows.map((fire) => (
              <tr key={fire.id}>
                <td className="tabular-nums whitespace-nowrap">
                  {date(fire.scheduled_at, timezone)}
                </td>
                <td>
                  <Status value={fire.outcome} />
                </td>
                <td title={fire.reason_code || undefined}>
                  {reasonLabel(fire.reason_code)}
                </td>
                <td>
                  {fire.run_id ? (
                    <Link className="link" to={`${base}/runs/${fire.run_id}`}>
                      查看运行
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
    </Drawer>
  );
}
