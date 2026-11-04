import { AuditStatus } from "./AuditStatus";
import { actionLabels, type AuditEvent } from "@/shared/audit";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { FormDrawer } from "@/components/platform/form-drawer";
import { AsyncState } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
export function AuditDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const query = useQuery<AuditEvent>(`/admin/audit-events/${id}`),
    date = useDate();
  const event = query.data;
  return (
    <FormDrawer
      title="审计详情"
      description="查看事件、来源及允许公开的变更信息。"
      onClose={onClose}
      footer={(close) => (
        <Button variant="outline" onClick={() => close()}>
          关闭
        </Button>
      )}
    >
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        {event && (
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-medium">
                {actionLabels[event.action] || event.action}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {date(event.occurred_at)}
              </p>
            </div>
            <dl className="grid gap-5 text-sm sm:grid-cols-2">
              {(
                [
                  [
                    "操作者",
                    event.actor.display_name +
                      (event.actor.username ? ` @${event.actor.username}` : ""),
                  ],
                  ["操作对象", event.target.label],
                  ["事件类型", event.action],
                  ["状态", <AuditStatus event={event} />],
                  ["来源 IP", event.ip_address || "未记录"],
                  ["请求编号", event.request_id || "未记录"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="mb-1 text-muted-foreground">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <section>
              <h3 className="mb-3 font-medium">变更详情</h3>
              {Object.keys(event.detail).length ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs leading-relaxed">
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  本次操作没有可公开的字段变更。
                </p>
              )}
            </section>
          </div>
        )}
      </AsyncState>
    </FormDrawer>
  );
}
