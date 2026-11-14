import type { Crumb } from "@/components/layout";
import { Cable, Home, KeyRound, Server, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router";

const items = [
  { to: "/account", label: "个人资料", section: "profile", icon: UserRound },
  {
    to: "/account/security",
    label: "账号安全",
    section: "security",
    icon: KeyRound,
  },
  {
    to: "/account/integrations",
    label: "服务凭证",
    section: "integrations",
    icon: Cable,
  },
  {
    to: "/account/remote-hosts",
    label: "SSH 凭证",
    section: "hosts",
    icon: Server,
  },
];

function sectionFor(path: string, search: string) {
  if (path === "/account/security") return "security";
  if (/^\/account\/integrations(?:\/|$)/.test(path)) return "integrations";
  if (/^\/account\/remote-hosts(?:\/|$)/.test(path)) return "hosts";
  return new URLSearchParams(search).get("section") ?? "profile";
}

export function AccountNavigation({
  compact,
  close,
}: {
  compact: boolean;
  close?: () => void;
}) {
  const location = useLocation();
  const section = sectionFor(location.pathname, location.search);
  return (
    <nav aria-label="个人中心导航">
      {items.map(({ to, label, section: key, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          title={label}
          aria-current={section === key ? "page" : undefined}
          className="nav-link"
          onClick={close}
        >
          <Icon className="size-4 shrink-0" />
          <span className="sidebar-label" aria-hidden={compact}>
            {label}
          </span>
        </Link>
      ))}
      <Link
        to="/home"
        className="nav-link mt-5"
        onClick={close}
        aria-label="返回工作区"
        title="返回工作区"
      >
        <Home className="size-4 shrink-0" />
        <span className="sidebar-label" aria-hidden={compact}>
          返回工作区
        </span>
      </Link>
    </nav>
  );
}

export function accountBreadcrumbs(path: string, search: string): Crumb[] {
  const section = sectionFor(path, search);
  const item = items.find((item) => item.section === section);
  const detail = /^\/account\/(integrations|remote-hosts)\/[1-9]\d*\/?$/.test(
    path,
  );
  return [
    { label: "个人中心", to: "/account" },
    {
      label: item?.label ?? "页面",
      ...(detail && item ? { to: item.to } : {}),
    },
    ...(detail
      ? [{ label: section === "integrations" ? "连接详情" : "主机详情" }]
      : []),
  ];
}
