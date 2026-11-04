import type { FeedbackTone } from "./operation-toast";
import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
export function ErrorBox({
  children,
  tone = "danger",
}: {
  children?: ReactNode;
  tone?: Extract<FeedbackTone, "warning" | "danger">;
}) {
  return children ? (
    <div
      role="alert"
      data-feedback-tone={tone}
      className="flex items-start gap-2 rounded-lg border p-3 text-sm"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  ) : null;
}
export function AsyncState({
  loading,
  error,
  empty,
  emptyMessage = "没有符合条件的记录",
  emptyContent,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string;
  empty?: boolean;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div
        role="status"
        className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground"
      >
        <LoaderCircle className="size-4 animate-spin" />
        正在加载…
      </div>
    );
  if (error)
    return (
      <div className="space-y-4 p-6">
        <ErrorBox>{error}</ErrorBox>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            重新加载
          </Button>
        )}
      </div>
    );
  if (empty) return emptyContent ?? <EmptyState title={emptyMessage} />;
  return children;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <div role="status" className="space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <div className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
export function RefreshButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={loading}
      onClick={onClick}
      aria-label="刷新"
    >
      <RefreshCw className={loading ? "animate-spin" : ""} />
    </Button>
  );
}
