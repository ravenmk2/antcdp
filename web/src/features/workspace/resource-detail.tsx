import { OverlayPresence } from "@/components/overlay-presence";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Pencil,
  RotateCcw,
  Trash2,
  UserMinus,
} from "lucide-react";
import { request } from "@/api/client";
import { useAuth, useSession } from "@/app/auth";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { MarkdownView } from "@/components/markdown";
import { ConfirmDialog } from "@/components/overlays";
import { ResourceIcon } from "@/components/resource-icon";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { recordRecent } from "@/lib/recent";
import type { Resource, ResourceKind } from "@/types/collaboration";
import { MembersPanel, ProjectTeams } from "./members";
import { ResourceEditor } from "./resource-editor";
import { ProjectOverview } from "./project-overview";
import { ProjectDescription } from "./project-description";
import { ProjectRepositories } from "../repositories/repositories";
import { ReleaseCenter } from "../delivery/release-center";
import { BranchModelPanel } from "../delivery/branch-model";

export function ResourceDetail({ kind }: { kind: ResourceKind }) {
  const params = useParams();
  const id = kind === "projects" ? params.projectId : params.teamId;
  const location = useLocation();
  const admin = location.pathname.startsWith("/admin");
  const query = useApiQuery<Resource>(
    [kind === "projects" ? "project" : "team", id],
    `/${kind}/${id ?? ""}`,
    { enabled: Boolean(id && /^[1-9]\d*$/.test(id)) },
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <DetailContent
          key={`${admin}-${query.data.data.id}`}
          kind={kind}
          resource={query.data.data}
          admin={admin}
        />
      )}
    </AsyncBoundary>
  );
}

function DetailContent({
  kind,
  resource,
  admin,
}: {
  kind: ResourceKind;
  resource: Resource;
  admin: boolean;
}) {
  const session = useSession();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [life, setLife] = useState<
    "archive" | "restore" | "dissolve" | "leave" | null
  >(null);
  const [confirmation, setConfirmation] = useState("");
  const submission = useSubmission();
  const project = kind === "projects";
  const tab = params.get("tab") ?? (admin ? "settings" : "overview");
  useEffect(() => {
    if (!admin)
      recordRecent(session.user.id, {
        id: resource.id,
        name: resource.name,
        kind: project ? "project" : "team",
        to: `/${kind}/${resource.id}`,
      });
  }, [admin, kind, project, resource.id, resource.name, session.user.id]);
  const tabs = project
    ? admin
      ? [
          { value: "settings", label: "基本资料" },
          { value: "members", label: "成员与团队" },
          { value: "repositories", label: "Git 仓库" },
        ]
      : [
          { value: "overview", label: "项目总览" },
          { value: "releases", label: "发布管理" },
          { value: "repositories", label: "Git 仓库" },
          { value: "members", label: "成员与团队" },
          { value: "description", label: "项目介绍" },
          { value: "settings", label: "项目设置" },
        ]
    : [
        { value: "overview", label: "团队概览" },
        { value: "members", label: "直接成员" },
        { value: "projects", label: "加入项目" },
      ];
  function changeTab(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "overview") next.delete("tab");
      else next.set("tab", value);
      next.delete("release");
      return next;
    });
  }
  async function lifecycle() {
    if (!life) return;
    const action = life;
    if (
      action === "dissolve" &&
      confirmation.toLowerCase() !== resource.code.toLowerCase()
    ) {
      submission.setError(
        new Error("请输入完全一致的团队编码（忽略大小写）。"),
      );
      return;
    }
    const ok = await submission.run(async () => {
      const path = `/${kind}/${resource.id}/${action === "leave" ? "leave" : action}`;
      await request(path, {
        method: "POST",
        ...(action === "leave"
          ? {}
          : {
              etag:
                action === "dissolve" ? resource.dissolve_etag : resource.etag,
            }),
        body: {},
      });
      await queryClient.invalidateQueries();
      if (action === "leave") navigate(`/${kind}`);
      else setLife(null);
    });
    if (!ok) return;
  }
  const showResourceHeader =
    !project || admin || tab === "overview" || tab === "settings";
  return (
    <div className="page">
      {showResourceHeader && (
        <>
          <PageHeader
            title={
              <span className="flex items-center gap-3">
                <ResourceIcon resource={resource} className="size-11" />
                {resource.name}
              </span>
            }
            description={<span className="mono">{resource.code}</span>}
            actions={
              <>
                {resource.can_manage && (
                  <Button variant="outline" onClick={() => setEdit(true)}>
                    <Pencil />
                    编辑资料
                  </Button>
                )}
                {admin &&
                  session.user.role === "admin" &&
                  (project ? (
                    <Button
                      variant={
                        resource.status === "active" ? "dangerSoft" : "outline"
                      }
                      onClick={() =>
                        setLife(
                          resource.status === "active" ? "archive" : "restore",
                        )
                      }
                    >
                      {resource.status === "active" ? (
                        <Archive />
                      ) : (
                        <RotateCcw />
                      )}
                      {resource.status === "active" ? "归档项目" : "恢复项目"}
                    </Button>
                  ) : (
                    <Button
                      variant="dangerSoft"
                      disabled={resource.status === "dissolved"}
                      onClick={() => setLife("dissolve")}
                    >
                      <Trash2 />
                      解散团队
                    </Button>
                  ))}
                {!admin && resource.direct_role && (
                  <Button variant="ghost" onClick={() => setLife("leave")}>
                    <UserMinus />
                    退出{project ? "项目" : "团队"}
                  </Button>
                )}
              </>
            }
          />
          {resource.summary && (
            <p className="-mt-3 mb-5 max-w-4xl text-sm leading-6 text-muted">
              {resource.summary}
            </p>
          )}
          <div className="mb-5 flex items-center gap-3">
            <StatusBadge
              tone={resource.status === "active" ? "success" : "neutral"}
            >
              {resource.status === "active"
                ? "正常"
                : resource.status === "archived"
                  ? "已归档"
                  : "已解散"}
            </StatusBadge>
            <span className="text-xs text-muted">
              {resource.member_count} 位成员 ·{" "}
              {resource.can_manage ? "可管理资料" : "只读或成员权限"}
            </span>
          </div>
        </>
      )}
      {(!project || admin) && (
        <Tabs
          label={`${resource.name}功能`}
          items={tabs}
          value={
            tabs.some((item) => item.value === tab)
              ? tab
              : (tabs[0]?.value ?? "overview")
          }
          onChange={changeTab}
        />
      )}
      <div className="mt-5">
        {project && tab === "overview" && !admin && (
          <ProjectOverview project={resource} />
        )}
        {project && tab === "releases" && (
          <ReleaseCenter project={resource} admin={admin} />
        )}
        {project && tab === "repositories" && (
          <>
            {!admin && (
              <PageHeader
                title="Git 仓库"
                description="查看本地快照、默认分支与同步结果，不代表远端实时健康。"
              />
            )}
            <ProjectRepositories
              project={resource}
              admin={session.user.role === "admin"}
            />
          </>
        )}
        {tab === "members" && (
          <div className="grid items-start gap-5">
            {project && !admin && (
              <PageHeader
                title="成员与团队"
                description="查看有效角色、直接成员来源和团队授权。"
              />
            )}
            <MembersPanel kind={kind} resource={resource} />
            {project && <ProjectTeams resource={resource} />}
          </div>
        )}
        {project && tab === "description" && (
          <ProjectDescription project={resource} />
        )}
        {project && tab === "settings" && (
          <ProjectSettings
            project={resource}
            admin={admin}
            onEdit={() => setEdit(true)}
          />
        )}
        {!project && tab === "overview" && (
          <TeamOverview team={resource} timezone={auth.settings.timezone} />
        )}
        {!project && tab === "projects" && <TeamProjects team={resource} />}
      </div>
      <OverlayPresence>
        {edit && (
          <ResourceEditor
            kind={kind}
            resource={resource}
            onClose={() => setEdit(false)}
            onSaved={() => {
              setEdit(false);
              void queryClient.invalidateQueries({
                queryKey: [project ? "project" : "team", resource.id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={Boolean(life)}
        danger={life === "dissolve" || life === "archive"}
        title={
          life === "archive"
            ? "归档项目"
            : life === "restore"
              ? "恢复项目"
              : life === "dissolve"
                ? "解散团队"
                : `退出${project ? "项目" : "团队"}`
        }
        description={resource.name}
        confirmLabel={
          life === "archive"
            ? "确认归档"
            : life === "restore"
              ? "确认恢复"
              : life === "dissolve"
                ? "确认解散"
                : "确认退出"
        }
        pending={submission.pending}
        onClose={() => setLife(null)}
        onConfirm={() => void lifecycle()}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm leading-6 text-muted">
          {life === "archive"
            ? "归档后资料与业务配置只读，历史发布和仓库快照保留。"
            : life === "restore"
              ? "恢复后可继续维护项目，既有成员关系保持不变。"
              : life === "dissolve"
                ? "解散不可恢复，将清除团队关系、项目授权和固定入口。名称与编码仍保留。"
                : "只移除你的直接关系；团队继承来源可能仍然保留。"}
        </p>
        {life === "dissolve" && (
          <Field label={`输入团队编码 ${resource.code} 确认`} required>
            <Input
              name="confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}

function TeamOverview({
  team,
  timezone,
}: {
  team: Resource;
  timezone: string;
}) {
  return (
    <div className="split-workspace">
      <Panel title="团队简介">
        <MarkdownView source={team.description} />
      </Panel>
      <Panel title="基本信息">
        <DescriptionList
          items={[
            {
              label: "团队编码",
              value: <span className="mono">{team.code}</span>,
            },
            { label: "直接成员", value: `${team.member_count} 人` },
            { label: "创建时间", value: team.created_at },
            { label: "最近更新", value: team.updated_at },
          ].map((item) => ({
            ...item,
            value: item.label.includes("时间")
              ? new Intl.DateTimeFormat("zh-CN", {
                  timeZone: timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(String(item.value)))
              : item.value,
          }))}
        />
      </Panel>
    </div>
  );
}

function TeamProjects({ team }: { team: Resource }) {
  const query = useApiQuery<Resource[]>(
    ["team-projects", team.id],
    `/teams/${team.id}/projects`,
  );
  return (
    <Panel title="加入项目" bodyClassName="p-0">
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.length}
        emptyTitle="尚未加入项目"
      >
        <ul className="divide-y">
          {query.data?.data.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="flex items-center gap-3 px-5 py-4 hover:bg-surface-hover"
              >
                <ResourceIcon resource={project} />
                <div className="min-w-0 flex-1">
                  <strong>{project.name}</strong>
                  <small className="mono block text-muted">
                    {project.code}
                  </small>
                </div>
                <ArrowRight className="size-4 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      </AsyncBoundary>
    </Panel>
  );
}

function ProjectSettings({
  project,
  onEdit,
}: {
  project: Resource;
  admin: boolean;
  onEdit: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const section = params.get("section") ?? "profile";
  const links = [
    { key: "profile", label: "基本资料" },
    { key: "members", label: "成员管理" },
    { key: "teams", label: "团队授权" },
    { key: "branch-model", label: "Git 分支规则" },
    { key: "integrations", label: "服务凭证" },
    { key: "hosts", label: "SSH 凭证" },
  ];
  function select(key: string) {
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
        {links.map((link) => (
          <button
            key={link.key}
            aria-pressed={section === link.key}
            onClick={() => select(link.key)}
          >
            {link.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {section === "profile" && (
          <Panel
            title="项目资料"
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={!project.can_manage}
                onClick={onEdit}
              >
                <Pencil />
                编辑资料
              </Button>
            }
          >
            <DescriptionList
              items={[
                { label: "项目名称", value: project.name },
                {
                  label: "项目编码",
                  value: <span className="mono">{project.code}</span>,
                },
                { label: "摘要", value: project.summary || "—", full: true },
                {
                  label: "项目介绍",
                  value: project.description
                    ? `${new TextEncoder().encode(project.description).length} 字节`
                    : "尚未填写",
                  full: true,
                },
              ]}
            />
            <div className="mt-5 border-t pt-4">
              <Link
                className="link"
                to={`/projects/${project.id}?tab=description`}
              >
                阅读项目介绍 <ArrowRight className="inline size-4" />
              </Link>
            </div>
          </Panel>
        )}
        {section === "members" && (
          <MembersPanel kind="projects" resource={project} />
        )}
        {section === "teams" && <ProjectTeams resource={project} />}
        {section === "branch-model" && <BranchModelPanel project={project} />}
        {section === "integrations" && (
          <Panel
            title="项目服务凭证"
            action={
              <Button asChild size="sm">
                <Link to={`/projects/${project.id}/integrations`}>
                  管理服务凭证 <ArrowRight />
                </Link>
              </Button>
            }
          >
            <p className="text-sm text-muted">
              维护当前项目归属的访问凭证；连接配置与系统秘密仍由系统管理员管理。
            </p>
          </Panel>
        )}
        {section === "hosts" && (
          <Panel
            title="项目 SSH 凭证"
            action={
              <Button asChild size="sm">
                <Link to={`/projects/${project.id}/remote-hosts`}>
                  管理 SSH 凭证 <ArrowRight />
                </Link>
              </Button>
            }
          >
            <p className="text-sm text-muted">
              主机地址与公钥信任由系统管理员维护；此处只维护项目归属凭证。
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
