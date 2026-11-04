import type { ReactNode } from "react";

export type StatusTone = "neutral" | "success" | "info" | "warning" | "danger";
const tones: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-[var(--success)]",
  info: "text-[var(--info)]",
  warning: "text-[var(--warning)]",
  danger: "text-destructive",
};
export function StatusText({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={"inline-flex items-baseline gap-1.5 " + tones[tone]}>
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 self-center rounded-full bg-current"
      />
      {children}
    </span>
  );
}
export function EnabledStatus({ enabled }: { enabled: boolean }) {
  return (
    <StatusText tone={enabled ? "success" : "neutral"}>
      {enabled ? "已启用" : "已停用"}
    </StatusText>
  );
}

export function CredentialStatus({
  enabled,
  hasSecret,
  available,
}: {
  enabled: boolean;
  hasSecret: boolean;
  available: boolean;
}) {
  if (!enabled) return <StatusText tone="neutral">已停用</StatusText>;
  if (!hasSecret) return <StatusText tone="warning">未配置秘密</StatusText>;
  if (!available) return <StatusText tone="danger">已过期</StatusText>;
  return <StatusText tone="success">可用</StatusText>;
}
