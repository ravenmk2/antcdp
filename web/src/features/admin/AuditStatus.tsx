import type { AuditEvent } from "@/shared/audit";
import { labels } from "@/shared/delivery";
import { StatusText } from "@/components/platform/status-text";
import { OperationStatus } from "@/components/platform/operation-status";

export function AuditStatus({ event }: { event: AuditEvent }) {
  const status = event.detail?.status;
  if (
    event.action === "project_branch_creation.item_finished" &&
    typeof status === "string" &&
    Object.hasOwn(labels, status)
  )
    return <OperationStatus value={status}>{labels[status]}</OperationStatus>;
  if (event.action === "auth.login_succeeded")
    return <StatusText tone="success">成功</StatusText>;
  if (
    event.action === "project_branch_creation.started" ||
    [
      "email.profile.test_started",
      "sms.profile.test_started",
      "dingtalk.robot.test_started",
    ].includes(event.action)
  )
    return <StatusText tone="info">已开始</StatusText>;
  return <StatusText tone="neutral">已记录</StatusText>;
}
