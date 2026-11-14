import { useRef, useState, type ComponentProps } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ScrollText,
  Download,
  CircleAlert,
  Info,
  History,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DescriptionPreview } from "@/components/description-preview";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import {
  AsyncBoundary,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { agentAdminRoot, agentQuery } from "@/features/agents/data/agent-api";
import {
  EnabledState,
  useListParams,
} from "@/features/agents/resources/admin-shared";
import { ResourceDelete } from "@/features/agents/resources/resource-actions";
import {
  SkillDeleteDialog,
  SkillEditDrawer,
  SkillMenu,
  type SkillAction,
} from "@/features/agents/resources/skill-actions";
import { SkillUploadDrawer } from "@/features/agents/resources/skill-upload-drawer";
import { SkillPackageView } from "@/features/agents/resources/skill-package-view";
import { useSkillGrid } from "@/features/agents/resources/use-skill-grid";
import type {
  Skill,
  SkillSummary,
  SkillVersion,
  SkillVersionSummary,
} from "@/types/agent-resources";

const skillKeys = ["agent-resources", "skills"];
const bytes = (value: string | number) =>
  `${Number(value).toLocaleString()} 字节`;
const archiveURL = (id: string, version: string) =>
  `/api/v1${agentAdminRoot}/skills/${id}/versions/${version}/archive`;
function SkillIcon({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`skill-icon ${large ? "skill-icon-large" : ""}`}
      aria-hidden
    >
      <ScrollText />
    </span>
  );
}
export function SkillsPage() {
  return <SkillLibrary />;
}
export function SkillCreatePage() {
  return <SkillLibrary creating />;
}
export function SkillUploadPage() {
  const { skillId } = useParams();
  return skillId ? <SkillDetail uploading /> : <SkillLibrary creating />;
}
export function SkillDetailPage() {
  return <SkillDetail />;
}
export function SkillVersionPage() {
  return <SkillDetail />;
}

function SkillLibrary({ creating = false }: { creating?: boolean }) {
  const { params, page, change } = useListParams(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const grid = useSkillGrid(params.get("page_size")),
    size = grid.size;
  const q = params.get("q") ?? "",
    enabled = params.get("enabled") ?? "all";
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = agentQuery({ page, page_size: size, q, enabled });
  const list = useApiQuery<SkillSummary[]>(
    [...skillKeys, "list", query],
    `${agentAdminRoot}/skills?${query}`,
  );
  const action = creating ? "create" : params.get("action"),
    id = params.get("skill") ?? undefined;
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: skillKeys });
  };
  const close = () => {
    if (creating) navigate("/admin/skills", { replace: true });
    else change({ action: "", skill: "", upload: "" });
  };
  return (
    <div className="page skill-library">
      <PageHeader
        title="技能库"
        description="管理可复用的技能、版本与技能包。"
      />
      <TableToolbar
        onRefresh={() => list.refetch()}
        refreshing={list.isFetching}
        onReset={() => {
          search.setValue("");
          change({ q: "", enabled: "", page: "1" });
        }}
        actions={
          <Button
            onClick={() => change({ action: "create", skill: "", upload: "" })}
          >
            <Plus className="size-4" />
            新建技能
          </Button>
        }
      >
        <StandaloneInput
          aria-label="搜索技能库"
          placeholder="搜索名称或描述"
          className="w-80"
          value={search.value}
          onChange={(e) => search.setValue(e.target.value)}
          onCompositionStart={() => {
            search.composing.current = true;
          }}
          onCompositionEnd={search.compositionEnd}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !search.composing.current) search.submit();
          }}
        />
        <StandaloneSelect
          aria-label="启用状态"
          value={enabled}
          onValueChange={(value) => change({ enabled: value, page: "1" })}
        >
          <option value="all">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已停用</option>
        </StandaloneSelect>
      </TableToolbar>
      <div className="skill-grid-area" ref={grid.ref}>
        <AsyncBoundary
          loading={list.isPending}
          error={list.error}
          onRetry={() => list.refetch()}
        >
          {list.data?.data.length ? (
            <ul className="skill-grid" aria-label="技能列表">
              {list.data.data.map((skill) => (
                <li className="skill-card" key={skill.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <SkillIcon />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold">
                        <Link
                          className="skill-card-link line-clamp-2 wrap-anywhere"
                          title={skill.title}
                          to={`/admin/skills/${skill.id}`}
                        >
                          {skill.title}
                        </Link>
                      </h2>
                      <p
                        className="mt-1 truncate font-mono text-xs text-muted"
                        title={skill.name}
                      >
                        {skill.name}
                      </p>
                    </div>
                    <DescriptionPreview
                      name={skill.title}
                      description={skill.description || "暂无描述"}
                      icon={CircleAlert}
                    />
                    <SkillMenu
                      name={skill.title}
                      onAction={(action) =>
                        change({ action, skill: skill.id, upload: "" })
                      }
                    />
                  </div>
                  <div className="skill-card-footer">
                    <EnabledState enabled={skill.enabled} />
                    <span
                      className="ml-auto truncate font-mono text-xs text-muted"
                      title={skill.latest_version_label ?? undefined}
                    >
                      {skill.latest_version_label ?? "尚未发布"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={q || enabled !== "all" ? "没有匹配的技能" : "还没有技能"}
              description="上传包含 SKILL.md 的 ZIP 技能包，创建第一个技能。"
            />
          )}
          <div className="skill-pagination">
            <Pagination
              page={page}
              size={size}
              sizeOptions={grid.sizeOptions}
              total={list.data?.pagination?.total}
              hasNext={list.data?.pagination?.has_more}
              pending={list.isFetching}
              onChange={(page, size) =>
                change({ page: String(page), page_size: String(size) })
              }
            />
          </div>
        </AsyncBoundary>
      </div>
      <SkillOverlay
        action={action}
        id={id}
        uploadId={params.get("upload")}
        onUploaded={(upload) => change({ upload: upload ?? "" })}
        onClose={close}
        onSaved={refresh}
        onDeleted={() => {
          refresh();
          close();
        }}
        onPublished={(v) =>
          navigate(`/admin/skills/${v.skill_id}/versions/${v.id}`)
        }
      />
    </div>
  );
}

function SkillOverlay({
  action,
  id,
  uploadId,
  onUploaded,
  onClose,
  onSaved,
  onDeleted,
  onPublished,
}: {
  action: string | null;
  id?: string;
  uploadId: string | null;
  onUploaded: (id: string | null) => void;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onPublished: (v: SkillVersion) => void;
}) {
  if (action === "create" || (action === "publish" && id))
    return (
      <SkillUploadFlow
        key={id ?? "new"}
        skillId={action === "publish" ? id : undefined}
        uploadId={uploadId}
        onUploaded={onUploaded}
        onClose={onClose}
        onPublished={onPublished}
      />
    );
  if (action === "edit" && id)
    return (
      <SkillEditDrawer key={id} id={id} onClose={onClose} onSaved={onSaved} />
    );
  if (action === "delete" && id)
    return (
      <SkillDeleteDialog
        key={id}
        id={id}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    );
  return null;
}

function SkillUploadFlow(props: ComponentProps<typeof SkillUploadDrawer>) {
  const [restoreFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <SkillUploadDrawer
      {...props}
      key={props.uploadId ?? "choose"}
      restoreFocusTo={restoreFocusTo}
    />
  );
}

function SkillDetail({ uploading = false }: { uploading?: boolean }) {
  const { skillId = "", versionId } = useParams(),
    { params, change } = useListParams(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const query = useApiQuery<Skill>(
      [...skillKeys, skillId],
      `${agentAdminRoot}/skills/${skillId}`,
    ),
    skill = query.data?.data;
  const tab = ["history", "versions"].includes(params.get("tab") ?? "")
    ? "history"
    : "content";
  const currentId = versionId ?? skill?.latest_version_id;
  const versions = useApiQuery<SkillVersionSummary[]>(
    [...skillKeys, skillId, "recent"],
    `${agentAdminRoot}/skills/${skillId}/versions?page=1&page_size=20`,
    { enabled: !uploading },
  );
  const version = useApiQuery<SkillVersion>(
    [...skillKeys, skillId, "version", currentId],
    `${agentAdminRoot}/skills/${skillId}/versions/${currentId}`,
    { enabled: Boolean(currentId) && !uploading },
  );
  const current = version.data?.data;
  const choices = (versions.data?.data ?? []).filter(
    (v) => v.state === "ready" || v.id === currentId,
  );
  const action = uploading
    ? "publish"
    : (params.get("action") ??
      (params.get("tab") === "config" ? "edit" : null));
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: skillKeys });
  };
  const close = () => {
    if (uploading) navigate(`/admin/skills/${skillId}`, { replace: true });
    else
      change({
        action: "",
        upload: "",
        ...(params.get("tab") === "config" ? { tab: "" } : {}),
      });
  };
  return (
    <div className="page skill-detail" data-view={tab}>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {skill && (
          <>
            <header className="skill-detail-header">
              <SkillIcon large />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="break-words text-xl font-semibold">
                    {skill.title}
                  </h1>
                  <EnabledState enabled={skill.enabled} />
                </div>
                <p className="mt-1 font-mono text-xs text-muted">
                  {skill.name}
                </p>
                {skill.description && (
                  <div className="mt-2 flex max-w-4xl items-start gap-2">
                    <p className="line-clamp-2 break-words text-sm leading-6 text-muted">
                      {skill.description}
                    </p>
                    {skill.description && (
                      <DescriptionPreview
                        name={skill.title}
                        description={skill.description}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="skill-detail-actions">
                {tab === "content" && currentId && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">查看版本</span>
                    <StandaloneSelect
                      aria-label="查看版本"
                      value={currentId}
                      onValueChange={(id) =>
                        navigate(`/admin/skills/${skillId}/versions/${id}`)
                      }
                    >
                      {!choices.some((v) => v.id === currentId) && (
                        <option value={currentId}>
                          {current?.version_label ??
                            skill.latest_version_label ??
                            "当前版本"}
                        </option>
                      )}
                      {choices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.version_label}
                          {v.id === skill.latest_version_id ? " · 最新" : ""}
                          {v.state !== "ready" ? " · 已删除" : ""}
                        </option>
                      ))}
                    </StandaloneSelect>
                  </div>
                )}
                {tab === "content" && current && (
                  <SkillVersionInfo version={current} />
                )}
                {tab === "content" && current?.state === "ready" && (
                  <Button
                    variant="outline"
                    render={
                      <a href={archiveURL(skillId, current.id)} download>
                        <Download className="size-4" />
                        下载 ZIP
                      </a>
                    }
                    nativeButton={false}
                    role="link"
                  />
                )}
                <SkillMenu
                  name={skill.title}
                  onAction={(action: SkillAction) =>
                    change({ action, upload: "" })
                  }
                />
              </div>
            </header>
            <div className="skill-detail-toolbar">
              <nav aria-label="技能详情视图" className="flex gap-4">
                <Button
                  variant="ghost"
                  aria-current={tab === "content" ? "page" : undefined}
                  onClick={() => change({ tab: "", page: "1" })}
                >
                  <BookOpen className="size-4" />
                  技能内容
                </Button>
                <Button
                  variant="ghost"
                  aria-current={tab === "history" ? "page" : undefined}
                  onClick={() => change({ tab: "history", page: "1" })}
                >
                  <History className="size-4" />
                  历史版本
                </Button>
              </nav>
            </div>
            {tab === "history" ? (
              <SkillHistory skillId={skillId} onChanged={refresh} />
            ) : currentId ? (
              <>
                {versions.isError && (
                  <Notice tone="warning">
                    版本列表加载失败。
                    <Button variant="link" onClick={() => versions.refetch()}>
                      重新加载
                    </Button>
                  </Notice>
                )}
                <AsyncBoundary
                  loading={version.isPending}
                  error={version.error}
                  onRetry={() => version.refetch()}
                >
                  {current && (
                    <div className="skill-version-content">
                      {current.state === "ready" ? (
                        <SkillPackageView
                          key={current.id}
                          skillId={skillId}
                          versionId={current.id}
                          manifest={current.manifest}
                        />
                      ) : (
                        <Notice>
                          此版本已删除，保留发布记录，技能包内容不再可用。
                        </Notice>
                      )}
                    </div>
                  )}
                </AsyncBoundary>
              </>
            ) : (
              <EmptyState
                title="尚无可用版本"
                description="通过右上角更多操作上传并发布技能包。"
              />
            )}
          </>
        )}
      </AsyncBoundary>
      <SkillOverlay
        action={action}
        id={skillId}
        uploadId={params.get("upload")}
        onUploaded={(upload) => change({ upload: upload ?? "" })}
        onClose={close}
        onSaved={refresh}
        onDeleted={() => {
          refresh();
          navigate("/admin/skills");
        }}
        onPublished={(v) =>
          navigate(`/admin/skills/${v.skill_id}/versions/${v.id}`)
        }
      />
    </div>
  );
}

function SkillHistory({
  skillId,
  onChanged,
}: {
  skillId: string;
  onChanged: () => void;
}) {
  const { page, size, change } = useListParams();
  const list = useApiQuery<SkillVersionSummary[]>(
    [...skillKeys, skillId, "history", page, size],
    `${agentAdminRoot}/skills/${skillId}/versions?${agentQuery({ page, page_size: size })}`,
  );
  return (
    <AsyncBoundary
      loading={list.isPending}
      error={list.error}
      onRetry={() => list.refetch()}
    >
      {list.data?.data.length ? (
        <SimpleTable
          headers={["版本", "变更说明", "发布时间", "状态", "操作"]}
          label="历史版本"
          actions
        >
          {list.data.data.map((v) => (
            <tr key={v.id}>
              <td>
                <Link
                  className="font-mono text-primary hover:underline"
                  to={`/admin/skills/${skillId}/versions/${v.id}`}
                >
                  {v.version_label}
                </Link>
              </td>
              <td>
                <div className="flex max-w-md items-center gap-2">
                  <span className="line-clamp-2 text-sm">
                    {v.change_note || "—"}
                  </span>
                  {v.change_note && (
                    <DescriptionPreview
                      name={`${v.version_label} 变更说明`}
                      description={v.change_note}
                    />
                  )}
                </div>
              </td>
              <td>{new Date(v.created_at).toLocaleString()}</td>
              <td>
                <StatusBadge tone={v.state === "ready" ? "success" : "neutral"}>
                  {v.state === "ready" ? "可用" : "已删除"}
                </StatusBadge>
              </td>
              <td>
                {v.state === "ready" && (
                  <ResourceDelete
                    domain={agentAdminRoot}
                    path={`/skills/${skillId}/versions/${v.id}`}
                    scope={`skill_version:${v.id}`}
                    command="skill_version.delete"
                    etag={JSON.stringify(v.version)}
                    label={`版本 ${v.version_label}`}
                    onDeleted={onChanged}
                    trigger={(open, disabled) => (
                      <VersionMenu
                        skillId={skillId}
                        version={v}
                        onDelete={open}
                        disabled={disabled}
                      />
                    )}
                  />
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
      ) : (
        <EmptyState
          title="尚无历史版本"
          description="发布技能包后，可在这里查看每次发布的记录。"
        />
      )}
      <div className="skill-pagination">
        <Pagination
          page={page}
          size={size}
          total={list.data?.pagination?.total}
          hasNext={list.data?.pagination?.has_more}
          pending={list.isFetching}
          onChange={(page, size) =>
            change({ page: String(page), page_size: String(size) })
          }
        />
      </div>
    </AsyncBoundary>
  );
}
function VersionMenu({
  skillId,
  version,
  onDelete,
  disabled,
}: {
  skillId: string;
  version: SkillVersionSummary;
  onDelete: () => void;
  disabled: boolean;
}) {
  const deleting = useRef(false);
  return (
    <DropdownMenu
      onOpenChangeComplete={(open) => {
        if (!open && deleting.current) {
          deleting.current = false;
          onDelete();
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={`${version.version_label}更多操作`}
          >
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={
            <Link to={`/admin/skills/${skillId}/versions/${version.id}`}>
              查看内容
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <a href={archiveURL(skillId, version.id)} download>
              下载 ZIP
            </a>
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            deleting.current = true;
          }}
        >
          <Trash2 />
          删除版本
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function SkillVersionInfo({ version }: { version: SkillVersion }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="查看版本信息"
            title="查看版本信息"
          >
            <Info className="size-4" />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-96 max-w-[calc(100vw-32px)] max-h-[70vh] overflow-auto"
      >
        <h2 className="mb-4 text-sm font-semibold">
          版本 {version.version_label}
        </h2>
        <dl className="space-y-4 text-xs">
          <div>
            <dt className="text-muted">发布时间</dt>
            <dd className="mt-1">
              {new Date(version.created_at).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted">变更说明</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words leading-6">
              {version.change_note || "未填写"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">包内容</dt>
            <dd className="mt-1">
              {version.manifest.file_count} 个文件 ·{" "}
              {bytes(version.manifest.total_bytes)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">压缩包 SHA-256</dt>
            <dd className="mt-1 break-all font-mono">
              {version.archive_sha256}
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
