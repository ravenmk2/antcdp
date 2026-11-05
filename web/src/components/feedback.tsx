import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  RotateCw,
} from "lucide-react";
import { errorMessage } from "@/api/client";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-surface-subtle text-muted",
  info: "border-info/25 bg-info-soft text-info",
  success: "border-success/25 bg-success-soft text-success",
  warning: "border-warning/25 bg-warning-soft text-warning",
  danger: "border-danger/25 bg-danger-soft text-danger",
};
const toneIcon = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const Icon = toneIcon[tone];
  return (
    <div
      className={cn("notice", className)}
      data-tone={tone}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <strong className="mb-1 block">{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice tone="danger">{errorMessage(error)}</Notice>;
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div
      className="grid min-h-44 place-items-center gap-3 p-8 text-muted"
      role="status"
    >
      <span className="flex items-center gap-2">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        {label}
      </span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Info className="size-8 text-faint" aria-hidden />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function AsyncBoundary({
  loading,
  error,
  empty,
  emptyTitle = "暂无数据",
  emptyDescription,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (loading) return <LoadingState />;
  if (error) {
    return (
      <div className="grid justify-items-center gap-4 p-8">
        <ErrorNotice error={error} />
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            重新加载
          </Button>
        )}
      </div>
    );
  }
  if (empty)
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return children;
}

export function RefreshButton({
  loading,
  onClick,
}: {
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton label="刷新" disabled={loading} onClick={onClick}>
      <RotateCw className={loading ? "animate-spin" : undefined} aria-hidden />
    </IconButton>
  );
}
