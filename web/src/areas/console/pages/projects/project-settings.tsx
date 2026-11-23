import { Link, useSearchParams } from "react-router";
import { ArrowRight, Cable, KeyRound, Server } from "lucide-react";
import { Button } from "@/components/button";
import { Panel } from "@/components/layout";
import type { Resource } from "@/types/collaboration";

const sections = ["integrations", "hosts", "credentials"] as const;
export type ProjectSettingSection = (typeof sections)[number];

export function normalizeProjectSetting(value: string | null) {
  return sections.includes(value as ProjectSettingSection)
    ? (value as ProjectSettingSection)
    : "integrations";
}

export function ProjectSettings({
  project,
  section,
}: {
  project: Resource;
  section: ProjectSettingSection;
}) {
  const [, setParams] = useSearchParams();
  const links = [
    { key: "integrations", label: "服务连接", icon: Cable },
    { key: "hosts", label: "远程主机", icon: Server },
    { key: "credentials", label: "凭据管理", icon: KeyRound },
  ] as const;
  function select(key: ProjectSettingSection) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", "settings");
      next.set("section", key);
      return next;
    });
  }
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="项目设置分类">
        {links.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => select(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {section === "integrations" && (
          <Panel
            title="项目服务连接"
            action={
              <Button
                render={
                  <Link to={`/admin/projects/${project.id}/integrations`}>
                    管理服务连接 <ArrowRight />
                  </Link>
                }
                nativeButton={false}
                role="link"
                size="sm"
              />
            }
          >
            <p className="text-sm text-muted">
              管理连接参数，并为每个连接选择首选凭据。
            </p>
          </Panel>
        )}
        {section === "credentials" && (
          <Panel title="项目凭据">
            <Link
              className="text-primary"
              to={`/admin/projects/${project.id}/credentials`}
            >
              管理项目凭据 →
            </Link>
          </Panel>
        )}
        {section === "hosts" && (
          <Panel
            title="项目远程主机"
            action={
              <Button
                render={
                  <Link to={`/admin/projects/${project.id}/remote-hosts`}>
                    配置远程主机首选凭据 <ArrowRight />
                  </Link>
                }
                nativeButton={false}
                role="link"
                size="sm"
              />
            }
          >
            <p className="text-sm text-muted">
              选择主机访问项目资源时使用的凭据。
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
