import type { Crumb } from "@/components/layout";
import { Cable, KeyRound, Server, UserRound } from "lucide-react";
import { Link, matchPath } from "react-router";

export const personalSettingsLabel = "个人设置";

const sections = [
  { to: "/account", label: "个人资料", key: "profile", icon: UserRound },
  {
    to: "/account/security",
    label: "账号安全",
    key: "security",
    icon: KeyRound,
  },
  {
    to: "/account/credentials",
    label: "凭据管理",
    key: "credentials",
    icon: KeyRound,
  },
  {
    to: "/account/integrations",
    label: "服务连接",
    key: "integrations",
    icon: Cable,
    detail: "连接详情",
  },
  {
    to: "/account/remote-hosts",
    label: "远程主机",
    key: "hosts",
    icon: Server,
    detail: "主机详情",
  },
];

export function personalSettingsSection(path: string, search: string) {
  const legacySection = new URLSearchParams(search).get("section");
  return (
    sections.find((section) =>
      section.key === "profile"
        ? false
        : matchPath({ path: section.to, end: !section.detail }, path),
    ) ??
    sections.find((section) => section.key === legacySection) ??
    sections.find((section) => section.key === "profile")!
  );
}

export function PersonalSettingsSidebar({ active }: { active: string }) {
  return (
    <div className="workspace-resource-navigation">
      <h2 className="hidden px-3 py-2 text-sm font-semibold min-[821px]:block">
        {personalSettingsLabel}
      </h2>
      <nav
        aria-label={`${personalSettingsLabel}导航`}
        className="max-[820px]:mt-0 max-[820px]:border-t-0"
      >
        <section>
          {sections.map(({ key, to, label, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              aria-current={key === active ? "page" : undefined}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </section>
      </nav>
    </div>
  );
}

export function personalSettingsBreadcrumbs(
  path: string,
  search: string,
): Crumb[] {
  const section = personalSettingsSection(path, search);
  const detail = section.detail && matchPath(`${section.to}/:id`, path);
  return [
    { label: personalSettingsLabel, to: "/account" },
    { label: section.label, ...(detail ? { to: section.to } : {}) },
    ...(detail && section.detail ? [{ label: section.detail }] : []),
  ];
}
