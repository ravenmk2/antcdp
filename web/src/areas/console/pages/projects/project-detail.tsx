import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams, useSearchParams } from "react-router";
import {
  Archive,
  FileText,
  FolderGit2,
  Pencil,
  RotateCcw,
  Settings2,
  Users,
  UsersRound,
} from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { ResourceDetailShell, ResourceHeader, Tabs } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { ResourceIcon } from "@/components/resource-icon";
import {
  RowAction,
  RowActionSeparator,
  RowActions,
} from "@/components/row-actions";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Resource } from "@/types/collaboration";
import { ResourceMetadata } from "@/features/collaboration/resource-detail";
import { ProjectInformation } from "@/areas/console/pages/projects/project-information";
import { ProjectMembers } from "@/areas/console/pages/projects/project-members";
import { ProjectTeams } from "@/areas/console/pages/projects/project-teams";
import { AdminProjectRepositories } from "@/areas/console/pages/projects/project-repositories";
import {
  normalizeProjectSetting,
  ProjectSettings,
} from "@/areas/console/pages/projects/project-settings";
import { ProjectProfileEditor } from "@/areas/console/pages/projects/project-profile-editor";

import { isRemovedProjectView } from "@/features/collaboration/project-navigation";

type ProjectTab =
  "overview" | "members" | "teams" | "repositories" | "settings";

export function AdminProjectDetail() {
  const { projectId } = useParams();
  const query = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId && /^[1-9]\d*$/.test(projectId)) },
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <DetailContent
          key={query.data.data.id}
          project={query.data.data}
          onReload={async () => {
            const result = await query.refetch();
            return !result.error;
          }}
        />
      )}
    </AsyncBoundary>
  );
}

function requestedTab(tab: string | null, section: string | null): ProjectTab {
  if (tab === "settings") {
    if (section === "members" || section === "teams") return section;
    if (!section || section === "profile") return "overview";
    return "settings";
  }
  if (["overview", "members", "teams", "repositories"].includes(tab ?? ""))
    return tab as ProjectTab;
  return "overview";
}

function DetailContent({
  project,
  onReload,
}: {
  project: Resource;
  onReload: () => Promise<boolean>;
}) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [life, setLife] = useState<"archive" | "restore" | null>(null);
  const [recovering, setRecovering] = useState(false);
  const submission = useSubmission();
  const section = params.get("section");
  const tab = requestedTab(params.get("tab"), section);
  const settingSection = normalizeProjectSetting(section);
  const tabs = [
    {
      value: "overview",
      label: (
        <span className="inline-flex items-center gap-2">
          <FileText className="size-4" />
          项目介绍
        </span>
      ),
    },
    {
      value: "members",
      label: (
        <span className="inline-flex items-center gap-2">
          <Users className="size-4" />
          成员管理
        </span>
      ),
    },
    {
      value: "teams",
      label: (
        <span className="inline-flex items-center gap-2">
          <UsersRound className="size-4" />
          团队授权
        </span>
      ),
    },
    {
      value: "repositories",
      label: (
        <span className="inline-flex items-center gap-2">
          <FolderGit2 className="size-4" />
          Git 仓库
        </span>
      ),
    },
    {
      value: "settings",
      label: (
        <span className="inline-flex items-center gap-2">
          <Settings2 className="size-4" />
          项目设置
        </span>
      ),
    },
  ];
  function changeTab(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "overview") next.delete("tab");
      else next.set("tab", value);
      for (const key of [
        "section",
        "release",
        "variant_id",
        "rq",
        "rstatus",
        "rpage",
        "rsize",
      ])
        next.delete(key);
      if (value === "settings") next.set("section", settingSection);
      return next;
    });
  }
  async function lifecycle() {
    if (!life || submission.pending || submission.uncertain) return;
    const action = life;
    await submission.run(async () => {
      await request(`/projects/${project.id}/${action}`, {
        method: "POST",
        etag: project.etag,
        body: {},
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      setLife(null);
    });
  }
  async function recover() {
    if (recovering) return;
    setRecovering(true);
    try {
      if (await onReload()) {
        submission.setError(null);
        setLife(null);
      }
    } finally {
      setRecovering(false);
    }
  }
  const recoverable =
    submission.uncertain ||
    (submission.error instanceof ApiError &&
      ["VERSION_CONFLICT", "PRECONDITION_REQUIRED"].includes(
        submission.error.code,
      ));
  if (isRemovedProjectView(params))
    return <Navigate replace to={`/admin/projects/${project.id}`} />;
  return (
    <ResourceDetailShell
      header={
        <ResourceHeader
          icon={<ResourceIcon resource={project} className="size-11" />}
          title={project.name}
          badge={
            <StatusBadge
              tone={project.status === "active" ? "success" : "neutral"}
            >
              {project.status === "active" ? "正常" : "已归档"}
            </StatusBadge>
          }
          meta={<ResourceMetadata resource={project} kind="projects" />}
          summary={project.summary}
          actions={
            <RowActions label={project.name} disabled={submission.pending}>
              <RowAction
                icon={<Pencil />}
                disabled={!project.can_manage}
                onSelect={() => setEdit(true)}
              >
                编辑资料
              </RowAction>
              <RowAction
                icon={<FileText />}
                disabled={!project.can_manage}
                to={
                  project.can_manage
                    ? `/admin/projects/${project.id}/description/edit`
                    : undefined
                }
              >
                编辑介绍
              </RowAction>
              <RowActionSeparator />
              <RowAction
                icon={project.status === "active" ? <Archive /> : <RotateCcw />}
                variant={
                  project.status === "active" ? "destructive" : undefined
                }
                onSelect={() => {
                  submission.setError(null);
                  setLife(project.status === "active" ? "archive" : "restore");
                }}
              >
                {project.status === "active" ? "归档项目" : "恢复项目"}
              </RowAction>
            </RowActions>
          }
        />
      }
      navigation={
        <Tabs
          label={`${project.name}功能`}
          items={tabs}
          value={tab}
          onChange={changeTab}
        />
      }
    >
      <div className="min-w-0">
        {tab === "overview" && <ProjectInformation project={project} />}
        {tab === "members" && <ProjectMembers project={project} />}
        {tab === "teams" && <ProjectTeams project={project} />}

        {tab === "repositories" && (
          <AdminProjectRepositories project={project} />
        )}
        {tab === "settings" && (
          <ProjectSettings project={project} section={settingSection} />
        )}
      </div>
      <OverlayPresence>
        {edit && (
          <ProjectProfileEditor
            project={project}
            onClose={() => setEdit(false)}
            onSaved={() => setEdit(false)}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={Boolean(life)}
        danger={life === "archive"}
        title={life === "archive" ? "归档项目" : "恢复项目"}
        description={project.name}
        confirmLabel={life === "archive" ? "确认归档" : "确认恢复"}
        pending={submission.pending}
        confirmDisabled={submission.uncertain || recovering}
        onClose={() => setLife(null)}
        onConfirm={() => void lifecycle()}
      >
        {recoverable ? (
          <Notice tone="warning">
            <p>
              {submission.uncertain
                ? "操作结果未知。请重新读取项目状态，核实后再决定下一步；不会自动重复提交。"
                : "项目资料版本已变化。请重新读取项目状态，核对后再操作。"}
            </p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              pending={recovering}
              onClick={() => void recover()}
            >
              重新读取项目状态
            </Button>
          </Notice>
        ) : (
          <ErrorNotice error={submission.error} />
        )}
        <p className="mt-3 text-sm leading-6 text-muted">
          {life === "archive"
            ? "归档后项目资料与仓库标签只读，成员关系和仓库快照保留。"
            : "恢复后可继续维护项目，既有成员关系保持不变。"}
        </p>
      </ConfirmDialog>
    </ResourceDetailShell>
  );
}
