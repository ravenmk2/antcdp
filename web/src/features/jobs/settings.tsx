import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarClock,
  Plus,
  Shield,
  Unplug,
} from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  EmptyState,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Field, Input, Select } from "@/components/fields";
import { Panel, PanelRoot } from "@/components/layout";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { CursorPagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import type { Job, ResourceGrant, Schedule } from "./types";
import { date, defaults, Inputs, reasonLabel, Status } from "./presentation";
import { useJobResourceDirectory } from "./resource-directory";

export function Schedules({ job, base }: { job: Job; base: string }) {
  const q = useApiQuery<{ items: Schedule[] }>(
    ["job-schedules", base],
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
              "Cron 表达式",
              "时区",
              "状态",
              "下次运行",
              "操作",
            ]}
          >
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td className="font-medium">{schedule.name}</td>
                <td className="font-mono">{schedule.cron}</td>
                <td>{schedule.timezone}</td>
                <td>
                  <StatusBadge tone={schedule.enabled ? "success" : "neutral"}>
                    {schedule.enabled ? "已启用" : "已停用"}
                  </StatusBadge>
                </td>
                <td className="tabular-nums whitespace-nowrap">
                  {date(schedule.next_fire_at)}
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
          saved={() => {
            setEdit(undefined);
            void q.refetch();
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
  saved: () => void;
}) {
  const [form, setForm] = useState({
    name: schedule?.name ?? "",
    cron: schedule?.cron ?? "0 9 * * 1-5",
    timezone: schedule?.timezone ?? "UTC",
    enabled: schedule?.enabled ?? true,
    inputs: schedule?.inputs ?? defaults(job.parameters),
  });
  const [times, setTimes] = useState<string[]>([]);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<"preview" | "save">();
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
            body: { cron: form.cron, timezone: form.timezone },
          },
        );
        setTimes(r.data.times);
      } else {
        await request(`${base}/schedules${schedule ? `/${schedule.id}` : ""}`, {
          method: schedule ? "PUT" : "POST",
          body: { ...form, version: schedule?.version ?? "0" },
        });
        saved();
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(undefined);
    }
  }
  let formatter: Intl.DateTimeFormat | undefined;
  if (times.length) {
    try {
      formatter = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: form.timezone.trim(),
      });
    } catch {
      formatter = undefined;
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
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Cron 表达式"
              hint="分钟 · 小时 · 日 · 月 · 星期"
              required
            >
              <Input
                value={form.cron}
                className="font-mono"
                onChange={(e) => {
                  setForm({ ...form, cron: e.target.value });
                  setTimes([]);
                }}
              />
            </Field>
            <Field label="时区" required hint="计算触发时间所用的时区">
              <Input
                value={form.timezone}
                className="font-mono"
                placeholder="UTC 或 Asia/Shanghai"
                onChange={(e) => {
                  setForm({ ...form, timezone: e.target.value });
                  setTimes([]);
                }}
              />
            </Field>
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用此计划
          </label>
        </div>
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
                  <time dateTime={t}>
                    {formatter?.format(new Date(t)) ?? date(t)}
                  </time>
                </li>
              ))}
              <li className="text-xs text-muted">
                {formatter ? form.timezone : "浏览器时区"}
              </li>
            </ol>
          ) : (
            <p className="text-xs text-muted">
              预览按上方 Cron 表达式和时区计算。
            </p>
          )}
        </section>
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
            {schedule.cron} · {schedule.timezone}
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
            headers={["计划时间", "状态", "原因", "运行"]}
          >
            {rows.map((fire) => (
              <tr key={fire.id}>
                <td className="tabular-nums whitespace-nowrap">
                  {date(fire.scheduled_at)}
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
export function Resources({ job, base }: { job: Job; base: string }) {
  const project = base.split("/")[2]!;
  const qc = useQueryClient();
  const grants = job.resource_grants ?? [];
  const [connection, setConnection] = useState("");
  const [credential, setCredential] = useState("");
  const directory = useJobResourceDirectory(project, grants, connection);
  const credentials = directory.selectedCredentials.filter(
    (item) => item.enabled,
  );
  const [dialog, setDialog] = useState<"grant" | "clear" | ResourceGrant>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  function open(next: "grant" | "clear" | ResourceGrant) {
    setError(undefined);
    setDialog(next);
  }

  async function act(
    path: string,
    method: "POST" | "DELETE",
    message: string,
    body?: unknown,
  ) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setMessage("");
    try {
      await request(`${base}${path}`, { method, body });
      await qc.invalidateQueries({ queryKey: ["job"] });
      setMessage(message);
      setDialog(undefined);
      if (dialog === "grant") {
        setConnection("");
        setCredential("");
      }
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone="success">{message}</Notice>}
      <div className="grid grid-cols-[minmax(0,1fr)_330px] items-start gap-5 max-lg:grid-cols-1">
        <PanelRoot>
          <TableToolbar
            actions={
              <Button onClick={() => open("grant")}>
                <Plus /> 新增授权
              </Button>
            }
          >
            <span className="text-sm font-semibold">服务连接授权</span>
          </TableToolbar>
          {grants.length ? (
            <SimpleTable
              actions
              label="服务连接授权"
              headers={["服务连接", "项目凭证", "状态", "操作"]}
            >
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    <span className="font-medium">
                      {directory.connectionName(grant.connection_id)}
                    </span>
                    <small className="mt-0.5 block text-muted">
                      授权 #{grant.id}
                    </small>
                  </td>
                  <td>
                    {directory.credentialName(
                      grant.connection_id,
                      grant.credential_id,
                    )}
                  </td>
                  <td>
                    <StatusBadge
                      tone={grant.status === "active" ? "success" : "neutral"}
                    >
                      {grant.status === "active" ? "有效" : "已撤销"}
                    </StatusBadge>
                  </td>
                  <td>
                    {grant.status === "active" && (
                      <Button
                        size="sm"
                        variant="dangerSoft"
                        onClick={() => open(grant)}
                      >
                        撤销授权
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </SimpleTable>
          ) : (
            <EmptyState
              title="暂无资源授权"
              description="新增授权后，可在脚本编辑器里选择该授权建立绑定。"
              icon={Shield}
            />
          )}
        </PanelRoot>
        <aside className="space-y-4">
          <Panel title="脚本资源绑定">
            <p className="text-sm leading-6 text-muted">
              脚本通过绑定名引用已授权的服务连接。服务连接调用暂只检查授权并记录审计。
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              render={<Link to={`${base}?edit=1&section=resources`} />}
              nativeButton={false}
            >
              编辑脚本与绑定 <ArrowUpRight />
            </Button>
          </Panel>
          <Panel title="通知">
            <p className="text-sm leading-6 text-muted">
              项目内钉钉机器人可在脚本中按编码调用。
            </p>
            <Link
              className="link mt-3 inline-flex items-center gap-1 text-sm"
              to={`/projects/${project}/dingtalk`}
            >
              管理项目钉钉机器人 <ArrowUpRight className="size-3.5" />
            </Link>
          </Panel>
          <Panel title="调试状态">
            <p className="text-sm leading-6 text-muted">
              独立调试状态会跨次运行保留。相关调试结束后可清空。
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="dangerSoft"
              onClick={() => open("clear")}
            >
              清空调试状态
            </Button>
          </Panel>
        </aside>
      </div>

      {dialog === "grant" && (
        <Drawer
          open
          title="新增资源授权"
          description="选择服务连接及该连接下的项目凭证。"
          onClose={() => setDialog(undefined)}
          pending={pending}
          footer={
            <>
              <OverlayCancelButton />
              <Button
                pending={pending}
                disabled={!connection || !credential}
                onClick={() =>
                  void act(
                    "/resource-grants",
                    "POST",
                    "已授予作业，可在编辑器里添加资源绑定。",
                    { connection_id: connection, credential_id: credential },
                  )
                }
              >
                授予作业
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <ErrorNotice
              error={
                error ??
                directory.directory.error ??
                directory.selectedQuery?.error
              }
            />
            <div inert={pending} className="space-y-4">
              <Field label="服务连接" required>
                <Select
                  value={connection}
                  onValueChange={(value) => {
                    setConnection(value);
                    setCredential("");
                  }}
                >
                  <option value="">请选择连接</option>
                  {directory.connections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="项目凭证"
                required
                hint={
                  !connection
                    ? "请先选择服务连接。"
                    : directory.selectedQuery?.isPending
                      ? "正在读取项目凭证…"
                      : !directory.selectedQuery?.error && !credentials.length
                        ? "该连接没有启用的项目凭证。"
                        : undefined
                }
              >
                <Select
                  disabled={!credentials.length}
                  value={credential}
                  onValueChange={setCredential}
                >
                  <option value="">请选择凭证</option>
                  {credentials.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!directory.directory.isPending &&
              !directory.directory.error &&
              !directory.connections.length && (
                <EmptyState compact title="暂无服务连接" icon={Unplug} />
              )}
          </div>
        </Drawer>
      )}
      {dialog === "clear" && (
        <ConfirmDialog
          open
          title="清空独立调试状态？"
          description="清空后，后续调试将从空状态开始。请等待使用该状态的运行结束。"
          confirmLabel="清空调试状态"
          danger
          pending={pending}
          onClose={() => setDialog(undefined)}
          onConfirm={() =>
            void act("/clear-debug-state", "POST", "独立调试状态已清空。", {})
          }
        >
          <ErrorNotice error={error} />
        </ConfirmDialog>
      )}
      {dialog && typeof dialog === "object" && (
        <ConfirmDialog
          open
          title="撤销资源授权？"
          description={`使用 ${directory.connectionName(dialog.connection_id)} / ${directory.credentialName(dialog.connection_id, dialog.credential_id)} 的绑定将失去访问权限。`}
          confirmLabel="撤销授权"
          danger
          pending={pending}
          onClose={() => setDialog(undefined)}
          onConfirm={() =>
            void act(
              `/resource-grants/${dialog.id}`,
              "DELETE",
              "已撤销资源授权。",
            )
          }
        >
          <ErrorNotice error={error} />
        </ConfirmDialog>
      )}
    </div>
  );
}
