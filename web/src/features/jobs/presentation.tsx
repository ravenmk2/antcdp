import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Field, Input, Select } from "@/components/fields";
import { StatusBadge } from "@/components/feedback";
import { statusLabel, type Job, type Parameter, type Run } from "./types";

export const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export function duration(run: Run) {
  if (!run.started_at || !run.finished_at) return "—";
  const ms =
    new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} 毫秒`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${Number((ms / 1000).toFixed(1))} 秒`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

const triggerLabels: Record<string, string> = {
  manual: "手动",
  debug: "调试",
  schedule: "定时",
  event: "项目事件",
};

const reasonLabels: Record<string, string> = {
  JOB_DISABLED: "作业已停用",
  NO_CONFIGURATION: "作业尚无已保存的脚本配置",
  INVALID_INPUTS: "参数与作业配置不匹配",
  JOB_BUSY: "作业并发已满",
};

export function triggerLabel(value: string) {
  return triggerLabels[value] ?? value;
}

export function reasonLabel(value: string) {
  return reasonLabels[value] ?? (value || "—");
}

export function JobStatus({ job }: { job: Job }) {
  return (
    <StatusBadge tone={job.enabled ? "success" : "neutral"}>
      {!job.revision_id ? "草稿" : job.enabled ? "已启用" : "已停用"}
    </StatusBadge>
  );
}

export function JobSection({
  title,
  detail,
  initiallyOpen,
  children,
}: {
  title: string;
  detail?: ReactNode;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={initiallyOpen || undefined}
      className="group border-t border-border"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        {title}
        <span className="flex items-center gap-2 text-xs font-normal text-muted">
          {detail}
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="space-y-4 px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}

export function Status({ value }: { value: string }) {
  return (
    <StatusBadge
      tone={
        value === "succeeded" || value === "accepted"
          ? "success"
          : ["failed", "timed_out", "denied", "rejected"].includes(value)
            ? "danger"
            : [
                  "queued",
                  "cancelling",
                  "stopping",
                  "timeout_stopping",
                  "failure_stopping",
                  "skipped",
                  "unknown",
                ].includes(value)
              ? "warning"
              : value === "running" || value === "pending"
                ? "info"
                : "neutral"
      }
    >
      {statusLabel[value] ?? value}
    </StatusBadge>
  );
}
export function runStatus(run: Run) {
  return run.status === "stopping"
    ? run.stop_reason === "RUN_TIMEOUT"
      ? "timeout_stopping"
      : "failure_stopping"
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
  missing,
}: {
  parameters: Parameter[];
  value: Record<string, string | string[]>;
  onChange: (value: Record<string, string | string[]>) => void;
  missing?: ReadonlySet<string>;
}) {
  return (
    <div className="space-y-4">
      {parameters.map((p) => (
        <Field
          key={p.name}
          label={p.label}
          required={p.required}
          hint={p.name}
          error={
            missing?.has(p.name)
              ? p.type === "text"
                ? "请填写此参数"
                : "请选择此参数"
              : undefined
          }
        >
          {p.type === "multiselect" ? (
            <div
              role="group"
              aria-label={p.required ? `${p.label}（必填）` : p.label}
              className="flex flex-wrap gap-3"
            >
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
              <option value="">
                {typeof p.default === "string" && p.default
                  ? `使用默认值（${p.default}）`
                  : "请选择"}
              </option>
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
