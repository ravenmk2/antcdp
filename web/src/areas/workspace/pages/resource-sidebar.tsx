import {
  Bot,
  Cable,
  FileText,
  FolderGit2,
  LayoutDashboard,
  Play,
  Radio,
  Server,
  Settings,
  Shield,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { ReactNode } from "react";
import type { Resource } from "@/types/collaboration";
import { ResourceSwitcher } from "./resource-switcher";
import {
  normalizeWorkspaceTeamTab,
  projectSectionRoutes,
  projectSectionLabels,
  workspaceTeamTabLabels,
  type WorkspaceProjectView,
} from "./workspace-navigation";

interface Destination {
  key: string;
  label: string;
  icon: LucideIcon;
  suffix: string;
}

const projectLinks: Destination[] = [
  { key: "overview", label: "项目总览", icon: LayoutDashboard, suffix: "" },
  {
    key: "description",
    label: "项目介绍",
    icon: FileText,
    suffix: "?tab=description",
  },
  {
    key: "repositories",
    label: "Git 仓库",
    icon: FolderGit2,
    suffix: "?tab=repositories",
  },
  { key: "jobs", label: "项目作业", icon: Play, suffix: "/jobs" },
  { key: "events", label: "事件订阅", icon: Radio, suffix: "/events" },
];
function sectionLink(
  key: keyof typeof projectSectionLabels,
  icon: LucideIcon,
): Destination {
  const route = projectSectionRoutes[key];
  return {
    key,
    label: projectSectionLabels[key],
    icon,
    suffix: route ? "/" + route : "?tab=settings&section=" + key,
  };
}
const collaborationLinks = [
  sectionLink("members", Users),
  sectionLink("roles", Shield),
  sectionLink("teams", UsersRound),
];
const settingsLinks = [
  sectionLink("profile", Settings),
  sectionLink("integrations", Cable),
  sectionLink("hosts", Server),
];
const robotLink = sectionLink("dingtalk", Bot);

function ResourceNavigation({
  header,
  name,
  base,
  active,
  groups,
}: {
  header: ReactNode;
  name: string;
  base: string;
  active: string;
  groups: { label: string; links: Destination[] }[];
}) {
  return (
    <div className="workspace-resource-navigation">
      {header}
      <nav aria-label={`${name}功能`}>
        {groups.map(({ label, links }) => (
          <section key={label} aria-label={label}>
            <h2>{label}</h2>
            {links.map(({ key, label, icon: Icon, suffix }) => (
              <Link
                key={key}
                to={base + suffix}
                aria-current={key === active ? "page" : undefined}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            ))}
          </section>
        ))}
      </nav>
    </div>
  );
}

export function ProjectSidebar({
  project,
  view,
}: {
  project: Resource;
  view: WorkspaceProjectView;
}) {
  return (
    <ResourceNavigation
      header={<ResourceSwitcher kind="projects" resource={project} />}
      name={project.name}
      base={`/projects/${project.id}`}
      active={view.page === "settings" ? view.section : view.page}
      groups={[
        { label: "项目", links: projectLinks },
        { label: "协作", links: collaborationLinks },
        {
          label: "设置",
          links: project.can_manage
            ? [...settingsLinks, robotLink]
            : settingsLinks,
        },
      ]}
    />
  );
}

export function TeamSidebar({ team }: { team: Resource }) {
  const [params] = useSearchParams();
  const active = normalizeWorkspaceTeamTab(params.get("tab"));
  const links = [
    { key: "overview", icon: FileText },
    { key: "members", icon: Users },
    { key: "projects", icon: FolderGit2 },
  ] as const;
  const destinations = links.map((link) => {
    const next = new URLSearchParams(params);
    if (link.key === "overview") next.delete("tab");
    else next.set("tab", link.key);
    return {
      ...link,
      label: workspaceTeamTabLabels[link.key],
      suffix: next.size ? `?${next}` : "",
    };
  });
  return (
    <ResourceNavigation
      header={<ResourceSwitcher kind="teams" resource={team} />}
      name={team.name}
      base={`/teams/${team.id}`}
      active={active}
      groups={[{ label: "团队", links: destinations }]}
    />
  );
}
