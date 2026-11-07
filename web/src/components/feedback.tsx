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
  action,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = toneIcon[tone];
  return (
    <div
      className={cn("notice", action && "items-center", className)}
      data-tone={tone}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
    >
      <Icon
        className={cn("size-4 shrink-0", !action && "mt-0.5")}
        aria-hidden
      />
      <div className={cn("min-w-0", action && "flex-1")}>
        {title && <strong className="mb-1 block">{title}</strong>}
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Notice tone="danger">
      {typeof error === "string" ? error : errorMessage(error)}
    </Notice>
  );
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
    <IconButton
      label="刷新"
      variant="outline"
      className="size-10"
      aria-busy={loading || undefined}
      disabled={loading}
      onClick={onClick}
    >
      <RotateCw className={loading ? "animate-spin" : undefined} aria-hidden />
    </IconButton>
  );
}
