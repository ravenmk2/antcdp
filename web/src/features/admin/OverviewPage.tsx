import {
  ArrowRight,
  Plus,
  Settings,
  Monitor,
  Activity,
  Folder,
  Cable,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { adminLoader } from "@/lib/loaders";
import { useIdentity } from "@/app/identity";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { actionLabels, type AuditEvent } from "@/shared/audit";
import { AsyncState } from "@/components/platform/feedback";
import { AuditDetail } from "./AuditDetail";
export const loader = adminLoader;
interface Overview {
  registration_enabled: boolean;
  session_ttl_days: number;
  recent_events: AuditEvent[];
}
export function Component() {
  const query = useQuery<Overview>("/admin/overview"),
    [selected, setSelected] = useState(""),
    identity = useIdentity(),
    date = useDate();
  const data = query.data;
  return (
    <section
      aria-label="系统概览"
      className="max-w-[var(--overview-max-width)] space-y-6"
    >
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
      >
        {data && (
          <>
            <nav aria-label="管理入口" className="grid gap-4 lg:grid-cols-3">
              {[
                {
                  to: "/admin/projects",
                  label: "组织项目协作",
                  description: "管理项目、团队与成员访问。",
                  Icon: Folder,
                },
                {
                  to: "/admin/integrations",
                  label: "连接外部服务",
                  description: "维护服务连接、访问凭证与远程主机。",
                  Icon: Cable,
                },
                {
                  to: "/admin/settings",
                  label: "维护平台",
                  description: "调整注册策略、系统设置与运行配置。",
                  Icon: Settings,
                },
              ].map(({ to, label, description, Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="group rounded-xl border bg-card p-5 transition-colors hover:border-input"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-muted-foreground" />
                    <h2 className="font-semibold">{label}</h2>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </Link>
              ))}
            </nav>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
              <section className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                  <h2 className="font-medium">最近操作</h2>
                  <Link
                    to="/admin/audit"
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    查看全部
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
                <div className="divide-y">
                  {data.recent_events.map((event) => (
                    <button
                      key={event.id}
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/40"
                      onClick={() => setSelected(event.id)}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Activity className="size-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-medium">
                            {actionLabels[event.action] || event.action}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {event.actor.display_name} · {event.target.label}
                          </span>
                        </span>
                      </span>
                      <time className="text-xs text-muted-foreground">
                        {date(event.occurred_at)}
                      </time>
                    </button>
                  ))}
                  {!data.recent_events.length && (
                    <p className="px-5 py-10 text-sm text-muted-foreground">
                      暂无操作记录。
                    </p>
                  )}
                </div>
              </section>
              <aside className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <nav
                  aria-label="常用操作"
                  className="divide-y overflow-hidden rounded-xl border bg-card"
                >
                  {[
                    {
                      to: "/admin/users?create=1",
                      label: "添加用户",
                      Icon: Plus,
                    },
                    {
                      to: "/admin/settings?tab=access",
                      label: "注册与会话",
                      Icon: Settings,
                    },
                    {
                      to: "/admin/settings?tab=system",
                      label: "运行信息",
                      Icon: Monitor,
                    },
                  ].map(({ to, label, Icon }) => (
                    <Link
                      key={to}
                      className="flex items-center gap-3 px-4 py-4 text-sm hover:bg-muted/60"
                      to={to!}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      {label}
                      <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Link>
                  ))}
                </nav>
                <section className="rounded-xl border bg-card p-5">
                  <h2 className="mb-4 font-medium">访问策略</h2>
                  <dl className="space-y-3 text-sm">
                    {[
                      ["自主注册", data.registration_enabled ? "开放" : "关闭"],
                      ["会话闲置有效期", `${data.session_ttl_days} 天`],
                      ["系统时区", identity.settings.timezone],
                    ].map(([label, value]) => (
                      <div
                        className="flex flex-wrap justify-between gap-2"
                        key={label}
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </aside>
            </div>
          </>
        )}
      </AsyncState>
      {selected && (
        <AuditDetail id={selected} onClose={() => setSelected("")} />
      )}
    </section>
  );
}
