import { OverlayPresence } from "@/components/overlay-presence";
import { useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Folder,
  Plus,
  Settings,
} from "lucide-react";
import { useAuth } from "@/app/auth";
import { AsyncBoundary } from "@/components/feedback";
import {
  DescriptionList,
  PageHeader,
  Panel,
  SummaryStrip,
} from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import { auditActionLabels, type AuditEvent } from "@/types/audit";
import { AuditDetail } from "@/areas/console/pages/audit-page";

interface Overview {
  users_total: number;
  users_active: number;
  users_disabled: number;
  admins_total: number;
  registration_enabled: boolean;
  session_ttl_days: number;
  recent_events: AuditEvent[];
}
export function OverviewPage() {
  const query = useApiQuery<Overview>(["admin-overview"], "/admin/overview");
  const auth = useAuth();
  const [selected, setSelected] = useState("");
  const stats = query.data
    ? [
        { label: "用户总数", value: query.data.data.users_total },
        {
          label: "正常账号",
          value: query.data.data.users_active,
        },
        {
          label: "已禁用",
          value: query.data.data.users_disabled,
        },
        {
          label: "系统管理员",
          value: query.data.data.admins_total,
        },
      ]
    : [];
  const shortcuts = [
    { to: "/admin/users?create=1", label: "添加用户", icon: Plus },
    { to: "/admin/projects", label: "项目管理", icon: Folder },
    { to: "/admin/settings?tab=access", label: "注册与会话", icon: Settings },
  ];
  return (
    <div className="page page-wide console-overview">
      <PageHeader title="系统概览" />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <div className="grid gap-5">
            <SummaryStrip label="账号统计" items={stats} />
            <div className="console-overview-grid">
              <Panel
                title="最近操作"
                action={
                  <Link className="link text-xs" to="/admin/audit">
                    查看全部 <ArrowRight className="inline size-3" />
                  </Link>
                }
                bodyClassName="p-0"
              >
                {query.data.data.recent_events.length ? (
                  <ul className="divide-y divide-border-subtle">
                    {query.data.data.recent_events.map((event) => (
                      <li key={event.id}>
                        <button
                          type="button"
                          className="console-activity-row"
                          aria-haspopup="dialog"
                          onClick={() => setSelected(event.id)}
                        >
                          <span className="console-activity-icon">
                            <Activity className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <strong className="block text-sm wrap-anywhere">
                              {auditActionLabels[event.action] ?? event.action}
                            </strong>
                            <small className="mt-0.5 block text-xs text-muted wrap-anywhere">
                              {event.actor.display_name}
                              {event.target.label && ` · ${event.target.label}`}
                            </small>
                          </span>
                          <time
                            dateTime={event.occurred_at}
                            className="console-activity-time"
                          >
                            {formatDate(
                              event.occurred_at,
                              auth.settings.timezone,
                            )}
                          </time>
                          <ChevronRight
                            className="size-4 shrink-0 text-faint"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-6 text-sm text-muted">暂无操作记录。</p>
                )}
              </Panel>
              <div className="grid gap-5">
                <Panel title="常用入口" bodyClassName="p-0">
                  <nav
                    aria-label="常用入口"
                    className="divide-y divide-border-subtle"
                  >
                    {shortcuts.map(({ to, label, icon: Icon }) => (
                      <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-table-row-hover focus-visible:-outline-offset-2"
                      >
                        <Icon className="size-4 text-primary" />
                        {label}
                        <ArrowRight className="ml-auto size-4 text-faint" />
                      </Link>
                    ))}
                  </nav>
                </Panel>
                <Panel title="访问策略">
                  <DescriptionList
                    className="console-policy"
                    items={[
                      {
                        label: "自主注册",
                        value: query.data.data.registration_enabled
                          ? "开放"
                          : "关闭",
                      },
                      {
                        label: "会话闲置有效期",
                        value: `${query.data.data.session_ttl_days} 天`,
                      },
                      { label: "系统时区", value: auth.settings.timezone },
                    ]}
                  />
                </Panel>
              </div>
            </div>
          </div>
        )}
      </AsyncBoundary>
      <OverlayPresence>
        {selected && (
          <AuditDetail id={selected} onClose={() => setSelected("")} />
        )}
      </OverlayPresence>
    </div>
  );
}
