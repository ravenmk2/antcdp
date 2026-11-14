import { Link, useSearchParams } from "react-router";
import { ArrowRight, Cable, Server } from "lucide-react";
import { Button } from "@/components/button";
import { Panel } from "@/components/layout";
import type { Resource } from "@/types/collaboration";

const sections = ["integrations", "hosts"] as const;
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
    { key: "integrations", label: "服务凭证", icon: Cable },
    { key: "hosts", label: "SSH 凭证", icon: Server },
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
            title="项目服务凭证"
            action={
              <Button
                render={
                  <Link to={`/admin/projects/${project.id}/integrations`}>
                    管理服务凭证 <ArrowRight />
                  </Link>
                }
                nativeButton={false}
                role="link"
                size="sm"
              />
            }
          >
            <p className="text-sm text-muted">
              维护当前项目归属的访问凭证；连接配置与系统秘密仍由系统级服务集成管理。
            </p>
          </Panel>
        )}
        {section === "hosts" && (
          <Panel
            title="项目 SSH 凭证"
            action={
              <Button
                render={
                  <Link to={`/admin/projects/${project.id}/remote-hosts`}>
                    管理 SSH 凭证 <ArrowRight />
                  </Link>
                }
                nativeButton={false}
                role="link"
                size="sm"
              />
            }
          >
            <p className="text-sm text-muted">
              主机地址与公钥信任由系统级远程主机管理；此处只维护项目归属凭证。
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
