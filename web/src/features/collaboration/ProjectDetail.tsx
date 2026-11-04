import { lazy, Suspense, useState } from "react";
import { Link, useRevalidator, useSearchParams } from "react-router";
import { Archive, Pencil, BookOpen, KeyRound } from "lucide-react";
import type { Resource } from "@/shared/collaboration";
import { useOperationToast } from "@/components/platform/operation-toast";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { Button } from "@/components/ui/button";
import { projectRoot, type ProjectSection } from "./ProjectNavigation";
import { ProjectOverview, ProjectReleases } from "./ProjectWorkspace";
import { ProjectDescription } from "./ProjectDescription";
import { ResourceEditor } from "./ResourceEditor";
import { ResourceCommand, type Command } from "./ResourceCommand";
import { Members } from "./Members";
import { Relations } from "./Relations";
import { useShortcuts } from "./Shortcuts";
import "./project-workspace.css";

const Repositories = lazy(() =>
  import("@/features/repositories/Repositories").then((m) => ({
    default: m.Repositories,
  })),
);
const BranchModelPanel = lazy(() =>
  import("@/features/delivery/BranchModelPanel").then((m) => ({
    default: m.BranchModelPanel,
  })),
);

export function ProjectDetail({
  project,
  admin,
}: {
  project: Resource;
  admin: boolean;
}) {
  const [params] = useSearchParams(),
    rv = useRevalidator(),
    notify = useOperationToast(),
    shortcuts = useShortcuts(),
    afterSave = useNavigateAfterSave();
  const [editor, setEditor] = useState(false),
    [command, setCommand] = useState<Command>();
  const root = projectRoot(project, admin),
    tab = params.get("tab") || "overview";
  const active: ProjectSection = [
    "description",
    "releases",
    "repositories",
  ].includes(tab)
    ? (tab as ProjectSection)
    : ["settings", "members", "teams", "branch-model"].includes(tab)
      ? "settings"
      : "overview";
  const requestedSetting =
    tab === "members"
      ? "members"
      : tab === "teams"
        ? "teams"
        : tab === "branch-model"
          ? "branches"
          : params.get("section") || "general";
  const setting = [
    "general",
    "members",
    "teams",
    "branches",
    "credentials",
  ].includes(requestedSetting)
    ? requestedSetting
    : "general";
  const writable = project.can_manage && project.status === "active";
  function saved() {
    setEditor(false);
    setCommand(undefined);
    notify("项目已更新。");
    shortcuts.refresh();
    void rv.revalidate();
  }
  return (
    <section className="min-w-0">
      {project.status !== "active" && (
        <p className="mb-6 rounded-lg bg-muted p-4 text-sm">
          项目已归档，资料与配置只读，已有交付记录仍可查阅。
        </p>
      )}
      {active === "overview" ? (
        <ProjectOverview project={project} admin={admin} />
      ) : active === "description" ? (
        <ProjectDescription
          key={project.id + ":" + (params.get("edit") === "1")}
          project={project}
          edit={params.get("edit") === "1"}
          onSaved={saved}
        />
      ) : active === "releases" ? (
        <ProjectReleases project={project} admin={admin} />
      ) : active === "repositories" ? (
        <Suspense fallback={<p role="status">正在读取仓库…</p>}>
          <Repositories
            projectId={project.id}
            canManage={admin && project.status === "active"}
          />
        </Suspense>
      ) : (
        <div className="project-settings-layout">
          <h1 className="sr-only">项目设置</h1>
          <nav className="project-settings-nav" aria-label="项目设置分类">
            {(
              [
                ["general", "基本资料"],
                ["members", "成员"],
                ["teams", "团队授权"],
                ["branches", "Git 分支规则"],
                ["credentials", "访问凭证"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                to={`${root}?tab=settings&section=${key}`}
                aria-current={setting === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="min-w-0">
            {setting === "members" ? (
              <Members
                kind="projects"
                resource={project}
                onCommand={setCommand}
              />
            ) : setting === "teams" ? (
              <Relations
                kind="projects"
                resource={project}
                admin={admin}
                onCommand={setCommand}
              />
            ) : setting === "branches" ? (
              <Suspense fallback={<p role="status">正在读取 Git 分支规则…</p>}>
                <BranchModelPanel projectId={project.id} canManage={writable} />
              </Suspense>
            ) : setting === "credentials" ? (
              <section className="max-w-3xl space-y-5">
                <h2 className="text-lg font-semibold">项目访问凭证</h2>
                <p className="text-sm text-muted-foreground">
                  用于项目范围的服务访问与 SSH 认证。系统和个人凭证分别维护。
                </p>
                {admin ||
                project.can_manage ||
                project.direct_role === "admin" ? (
                  <div className="divide-y rounded-lg border">
                    <Link
                      className="flex items-center gap-3 p-5 hover:bg-muted"
                      to={`/projects/${project.id}/integrations`}
                    >
                      <KeyRound className="size-5" />
                      <span>
                        集成凭证
                        <span className="mt-1 block text-sm text-muted-foreground">
                          管理项目对外部服务的访问
                        </span>
                      </span>
                    </Link>
                    <Link
                      className="flex items-center gap-3 p-5 hover:bg-muted"
                      to={`/projects/${project.id}/remote-hosts`}
                    >
                      <KeyRound className="size-5" />
                      <span>
                        SSH 凭证
                        <span className="mt-1 block text-sm text-muted-foreground">
                          管理项目对远程主机的认证
                        </span>
                      </span>
                    </Link>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    凭证由项目管理员维护。
                  </p>
                )}
              </section>
            ) : (
              <section className="max-w-3xl space-y-7">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">基本资料</h2>
                  {writable && (
                    <Button variant="outline" onClick={() => setEditor(true)}>
                      <Pencil />
                      编辑资料
                    </Button>
                  )}
                </div>
                <dl className="grid gap-5 rounded-xl border bg-card p-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">项目名称</dt>
                    <dd className="mt-1 break-words">{project.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">项目编码</dt>
                    <dd className="mt-1 break-all font-mono">{project.code}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">摘要</dt>
                    <dd className="mt-1 break-words">
                      {project.summary || "尚未填写摘要"}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
                  <div>
                    <h3 className="font-medium">项目介绍</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      在独立阅读页维护完整 Markdown 文档。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline">
                      <Link to={root + "?tab=description"}>
                        <BookOpen />
                        阅读介绍
                      </Link>
                    </Button>
                    {writable && (
                      <Button asChild variant="outline">
                        <Link to={root + "?tab=description&edit=1"}>
                          <Pencil />
                          编辑介绍
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="font-medium">我的访问权限</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {project.direct_role === "admin"
                      ? "项目管理员"
                      : project.is_member
                        ? "项目成员"
                        : "系统管理员访问"}{" "}
                    · {writable ? "可管理项目资料和配置" : "只读"}
                  </p>
                </div>
                {admin && (
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5">
                    <div>
                      <h3 className="font-medium">
                        {project.status === "active" ? "归档项目" : "恢复项目"}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {project.status === "active"
                          ? "归档后保留资料和记录，停止项目配置变更。"
                          : "恢复后可以继续管理项目。"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setCommand({
                          action:
                            project.status === "active" ? "archive" : "restore",
                        })
                      }
                    >
                      <Archive />
                      {project.status === "active" ? "归档" : "恢复"}
                    </Button>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}
      {editor && (
        <ResourceEditor
          kind="projects"
          resource={project}
          onClose={() => setEditor(false)}
          onSaved={saved}
        />
      )}
      {command && (
        <ResourceCommand
          kind="projects"
          resource={project}
          command={command}
          consoleMode={admin}
          onClose={() => setCommand(undefined)}
          onSaved={() => {
            if (command.action === "leave")
              afterSave(`${admin ? "/admin" : ""}/projects`);
            else saved();
          }}
        />
      )}
    </section>
  );
}
