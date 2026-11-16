import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Select } from "@/components/fields";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { CredentialSet, ServiceConnection } from "@/types/integrations";
import type { Job, Schedule } from "./types";
import { date, defaults, Inputs, Status } from "./page";

export function Schedules({ job, base }: { job: Job; base: string }) {
  const q = useApiQuery<{ items: Schedule[] }>(
    ["job-schedules", base],
    `${base}/schedules`,
  );
  const [edit, setEdit] = useState<Schedule | null>();
  const [fires, setFires] = useState<string>();
  return (
    <div className="space-y-6">
      <Panel
        title="定时计划"
        action={
          job.can_manage && (
            <Button disabled={!job.revision_id} onClick={() => setEdit(null)}>
              添加计划
            </Button>
          )
        }
      >
        <p className="mb-5 text-sm text-muted">
          使用五段 Cron 表达式。服务离线期间的执行时间会跳过，不补跑。
        </p>
        <AsyncBoundary
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
        >
          {q.data?.data.items.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-6 border-b border-border py-4 text-sm"
            >
              <div className="flex-1">
                <strong>{s.name}</strong>
                <p className="mt-1 font-mono text-muted">
                  {s.cron} · {s.timezone}
                </p>
              </div>
              <span>{s.enabled ? "启用" : "停用"}</span>
              <span className="text-muted">下次：{date(s.next_fire_at)}</span>
              <Button variant="ghost" onClick={() => setFires(s.id)}>
                触发记录
              </Button>
              {job.can_manage && (
                <Button variant="outline" onClick={() => setEdit(s)}>
                  编辑
                </Button>
              )}
            </div>
          ))}
          {!q.data?.data.items.length && (
            <p className="py-5 text-muted">暂无定时计划</p>
          )}
        </AsyncBoundary>
      </Panel>
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
          }}
        />
      )}
      {fires && <Fires key={fires} base={base} id={fires} />}
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
  const [pending, setPending] = useState(false);
  async function submit(preview: boolean) {
    setPending(true);
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
      setPending(false);
    }
  }
  return (
    <Panel title={schedule ? "编辑定时计划" : "添加定时计划"}>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="计划名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Cron 表达式" hint="分钟 小时 日 月 星期">
            <Input
              value={form.cron}
              onChange={(e) => {
                setForm({ ...form, cron: e.target.value });
                setTimes([]);
              }}
            />
          </Field>
          <Field label="时区">
            <Input
              value={form.timezone}
              placeholder="UTC 或 Asia/Shanghai"
              onChange={(e) => {
                setForm({ ...form, timezone: e.target.value });
                setTimes([]);
              }}
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
          <Button
            variant="outline"
            pending={pending}
            onClick={() => void submit(true)}
          >
            预览未来 5 次
          </Button>
          {times.map((t) => (
            <div key={t} className="text-sm text-muted">
              {date(t)}
            </div>
          ))}
        </div>
        <div>
          <h4 className="mb-4 font-medium">计划运行参数</h4>
          <Inputs
            parameters={job.parameters}
            value={form.inputs}
            onChange={(inputs) => setForm({ ...form, inputs })}
          />
        </div>
      </div>
      <ErrorNotice error={error} />
      <div className="mt-6 flex gap-3">
        <Button pending={pending} onClick={() => void submit(false)}>
          保存计划
        </Button>
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
      </div>
    </Panel>
  );
}
function Fires({ base, id }: { base: string; id: string }) {
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
    ["job-fires", base, id, before],
    `${base}/schedules/${id}/fires?before=${before}`,
  );
  const rows = q.data?.data.items ?? [];
  return (
    <Panel title="计划触发记录">
      <ErrorNotice error={q.error} />
      {rows.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-5 border-b border-border py-3 text-sm"
        >
          <span>{date(f.scheduled_at)}</span>
          <Status value={f.outcome} />
          <span className="flex-1 text-muted">{f.reason_code}</span>
          {f.run_id && (
            <Link className="link" to={`${base}/runs/${f.run_id}`}>
              查看运行
            </Link>
          )}
        </div>
      ))}
      {!q.isPending && !rows.length && (
        <p className="text-sm text-muted">暂无触发记录</p>
      )}
      {before && (
        <Button variant="outline" onClick={() => setBefore("")}>
          返回最新
        </Button>
      )}
      {rows.length === 100 && (
        <Button onClick={() => setBefore(rows.at(-1)!.id)}>更早记录</Button>
      )}
    </Panel>
  );
}
export function Resources({ job, base }: { job: Job; base: string }) {
  const project = base.split("/")[2]!;
  const qc = useQueryClient();
  const connections = useApiQuery<{ items: ServiceConnection[] }>(
    ["service-directory"],
    "/service-connections",
  );
  const [connection, setConnection] = useState("");
  const selected = connections.data?.data.items.find(
    (c) => c.id === connection,
  );
  const [credential, setCredential] = useState("");
  const credentials = useApiQuery<CredentialSet>(
    ["job-credentials", project, connection],
    `/projects/${project}/service-connections/${selected?.service_type}/${connection}/credentials`,
    { enabled: !!selected },
  );
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [clear, setClear] = useState(false);
  const [message, setMessage] = useState("");
  async function act(
    path: string,
    method: "POST" | "DELETE" | "PUT",
    body?: unknown,
  ) {
    setPending(true);
    setError(undefined);
    setMessage("");
    try {
      await request(`${base}${path}`, { method, body });
      await qc.invalidateQueries({ queryKey: ["job"] });
      setMessage("操作已完成");
      setClear(false);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <Notice>
        本次提供服务连接授权、绑定和访问审计。具体服务调用适配尚未开放；项目内钉钉机器人无需单独授权。
      </Notice>
      <ErrorNotice error={error ?? connections.error ?? credentials.error} />
      {message && <Notice>{message}</Notice>}
      <Panel title="服务连接与项目凭证">
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-4">
          <Field label="服务连接">
            <Select
              value={connection}
              onValueChange={(value) => {
                setConnection(value);
                setCredential("");
              }}
            >
              <option value="">请选择连接</option>
              {connections.data?.data.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="项目凭证">
            <Select
              value={credential}
              onValueChange={(value) => setCredential(value)}
            >
              <option value="">请选择凭证</option>
              {credentials.data?.data.items
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Button
            disabled={!credential}
            pending={pending}
            onClick={() =>
              void act("/resource-grants", "POST", {
                connection_id: connection,
                credential_id: credential,
              })
            }
          >
            授予任务
          </Button>
        </div>
        <div className="mt-5 divide-y divide-border">
          {job.resource_grants?.map((g) => (
            <div key={g.id} className="flex items-center gap-4 py-3 text-sm">
              <span className="flex-1">
                {connections.data?.data.items.find(
                  (c) => c.id === g.connection_id,
                )?.name ?? `连接 #${g.connection_id}`}{" "}
                · 凭证 #{g.credential_id}
              </span>
              <span className="text-muted">
                授权 #{g.id} · {g.status === "active" ? "有效" : "已撤销"}
              </span>
              {g.status === "active" && (
                <Button
                  size="sm"
                  variant="dangerSoft"
                  pending={pending}
                  onClick={() => void act(`/resource-grants/${g.id}`, "DELETE")}
                >
                  撤销授权
                </Button>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="脚本资源绑定">
        <p className="text-sm text-muted">
          绑定随脚本配置一起保存，可直接使用编辑中的绑定进行调试。
        </p>
        <Button
          className="mt-4"
          variant="outline"
          render={<Link to={`${base}?edit=1`} />}
          nativeButton={false}
        >
          编辑脚本与绑定
        </Button>
      </Panel>
      <Panel title="调试状态">
        <p className="mb-4 text-sm text-muted">
          独立调试状态会跨次运行保留。只有没有使用调试状态的排队或运行任务时，才能清空。
        </p>
        {clear ? (
          <div className="flex items-center gap-3">
            <span className="text-sm">确认清空此任务的独立调试状态？</span>
            <Button
              variant="danger"
              pending={pending}
              onClick={() => void act("/clear-debug-state", "POST", {})}
            >
              确认清空
            </Button>
            <Button variant="outline" onClick={() => setClear(false)}>
              取消
            </Button>
          </div>
        ) : (
          <Button variant="dangerSoft" onClick={() => setClear(true)}>
            清空调试状态
          </Button>
        )}
      </Panel>
    </div>
  );
}
