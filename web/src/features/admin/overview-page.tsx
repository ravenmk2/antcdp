import { OverlayPresence } from "@/components/overlay-presence";
import { useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  Folder,
  Plus,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { useAuth } from "@/app/auth";
import { AsyncBoundary } from "@/components/feedback";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import { auditActionLabels, type AuditEvent } from "@/types/audit";
import { AuditDetail } from "./audit-page";

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
        { label: "用户总数", value: query.data.data.users_total, icon: Users },
        {
          label: "正常账号",
          value: query.data.data.users_active,
          icon: Activity,
        },
        {
          label: "已禁用",
          value: query.data.data.users_disabled,
          icon: Shield,
        },
        {
          label: "系统管理员",
          value: query.data.data.admins_total,
          icon: Settings,
        },
      ]
    : [];
  const shortcuts = [
    { to: "/admin/users?create=1", label: "添加用户", icon: Plus },
    { to: "/admin/projects", label: "项目管理", icon: Folder },
    { to: "/admin/settings?tab=access", label: "注册与会话", icon: Settings },
  ];
  return (
    <div className="page">
      <PageHeader
        title="系统概览"
        description="查看真实账号统计、访问策略与最近操作。"
      />
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map(({ label, value, icon: Icon }) => (
                <div key={label} className="panel flex items-center gap-4 p-5">
                  <span className="resource-icon">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-xs text-muted">{label}</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="split-workspace">
              <Panel
                title="最近操作"
                action={
                  <Link className="link text-xs" to="/admin/audit">
                    查看全部 <ArrowRight className="inline size-3" />
                  </Link>
                }
                bodyClassName="p-0"
              >
                <ul className="divide-y">
                  {query.data.data.recent_events.map((event) => (
                    <li key={event.id}>
                      <button
                        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-surface-hover"
                        onClick={() => setSelected(event.id)}
                      >
                        <Activity className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <strong className="block text-sm">
                            {auditActionLabels[event.action] ?? event.action}
                          </strong>
                          <small className="text-muted">
                            {event.actor.display_name} · {event.target.label}
                          </small>
                        </span>
                        <time className="text-xs text-muted">
                          {formatDate(
                            event.occurred_at,
                            auth.settings.timezone,
                          )}
                        </time>
                      </button>
                    </li>
                  ))}
                  {!query.data.data.recent_events.length && (
                    <p className="p-6 text-sm text-muted">暂无操作记录。</p>
                  )}
                </ul>
              </Panel>
              <div className="grid gap-5">
                <Panel title="快捷入口" bodyClassName="p-0">
                  <nav className="divide-y">
                    {shortcuts.map(({ to, label, icon: Icon }) => (
                      <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-3 px-5 py-4 text-sm hover:bg-surface-hover"
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
