import { StatusText, type StatusTone } from "@/components/platform/status-text";
import type { ReactNode } from "react";
const tones: Record<string, Exclude<StatusTone, "neutral">> = {
  accepted: "success",
  succeeded: "success",
  valid: "success",
  ready: "success",
  completed: "success",
  created: "success",
  used_existing: "success",
  exists: "success",
  in_progress: "info",
  executing: "info",
  creating: "info",
  rejected: "danger",
  failed_before_submit: "danger",
  failed: "danger",
  error: "danger",
  unknown: "warning",
  partial: "warning",
  interrupted: "warning",
  invalid: "warning",
  outdated: "warning",
};
export function operationTone(value: string) {
  return Object.hasOwn(tones, value) ? tones[value] : undefined;
}
export function OperationStatus({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <StatusText tone={operationTone(value) ?? "neutral"}>{children}</StatusText>
  );
}
