import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

export function AccountFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="space-y-6">
      <nav
        aria-label="个人设置分类"
        className="flex flex-wrap gap-1 border-b pb-2"
      >
        {[
          ["/account", "个人资料"],
          ["/account/security", "账号安全"],
          ["/account/integrations", "集成凭证"],
          ["/account/remote-hosts", "SSH 凭证"],
        ].map(([to, label]) => {
          const active =
            pathname === to ||
            (to !== "/account" && pathname.startsWith(to + "/"));
          return (
            <Link
              key={to}
              to={to!}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-muted"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
