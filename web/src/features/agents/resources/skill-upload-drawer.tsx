import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArchive, UploadCloud, X } from "lucide-react";
import { isVersionConflict, request, type ApiResponse } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { Field, Input, Textarea } from "@/components/fields";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { agentAdminRoot, agentRoot } from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import type { Skill, SkillUpload, SkillVersion } from "@/types/agent-resources";
import type { CapabilityCatalog, Operation } from "@/types/agents";
import {
  SkillVersionField,
  incrementSkillVersion,
} from "./skill-version-field";
import { skillUploadIssue } from "./skill-upload-issues";

export function SkillUploadDrawer({
  skillId,
  uploadId,
  onUploaded,
  onClose,
  onPublished,
  restoreFocusTo,
}: {
  skillId?: string;
  uploadId?: string | null;
  onUploaded: (id: string | null) => void;
  onClose: () => void;
  onPublished: (version: SkillVersion) => void;
  restoreFocusTo?: HTMLElement | null;
}) {
  const caps = useApiQuery<CapabilityCatalog>(
    ["agent-capabilities"],
    `${agentRoot}/capabilities`,
  );
  const skill = useApiQuery<Skill>(
    ["agent-resources", "skills", skillId],
    `${agentAdminRoot}/skills/${skillId}`,
    { enabled: Boolean(skillId) },
  );
  const upload = useQuery({
    queryKey: ["agent-resources", "skills", "upload", uploadId],
    enabled: Boolean(uploadId),
    retry: false,
    queryFn: ({ signal }) =>
      request<SkillUpload>(`${agentAdminRoot}/skills/uploads/${uploadId}`, {
        signal,
      }),
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.data.validation_status ?? "")
        ? 1500
        : false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0),
    picker = useRef<HTMLInputElement>(null);
  const formId = useId();
  const action = useAgentCommand<Operation>(`skill:${skillId ?? ""}:upload`);
  const busy = action.pending || action.uncertain;
  const release = useUnsaved(Boolean(file), busy);
  useCommandResult(action.state, (result) => {
    release();
    setFile(null);
    action.command.reset();
    onUploaded(result.id);
  });
  const value = upload.data?.data;
  const max = caps.data?.data.limits.skill_zip_bytes;
  const title = skillId ? "发布新版" : "新建技能";
  const close = () => {
    release();
    onClose();
  };
  function choose(files: FileList | File[] | null) {
    if (busy || !max) return;
    setError(undefined);
    if (!files?.length) return;
    if (files.length !== 1) {
      setError("每次请选择一个 ZIP 技能包。");
      return;
    }
    const chosen = files[0];
    if (!chosen.name.toLowerCase().endsWith(".zip")) {
      setError("请选择 ZIP 格式的技能包。");
      return;
    }
    if (chosen.size === 0 || chosen.size > max) {
      setError(
        `文件不能为空，且不能超过 ${Math.round(max / 1024 / 1024)} MiB。`,
      );
      return;
    }
    setFile(chosen);
  }
  if (
    value?.validation_status === "passed" &&
    !value.published_skill_version_id &&
    value.frontmatter &&
    (!skillId || skill.data)
  ) {
    return (
      <PublishDrawer
        key={uploadId}
        upload={value}
        skill={skill.data}
        onClose={close}
        onPublished={onPublished}
        onReplace={() => onUploaded(null)}
        restoreFocusTo={restoreFocusTo}
      />
    );
  }
  const validating =
    value && ["queued", "running"].includes(value.validation_status);
  return (
    <Drawer
      open
      title={title}
      restoreFocusTo={restoreFocusTo}
      description={
        skillId ? skill.data?.data.title : "上传技能包，自动读取名称与描述。"
      }
      onClose={close}
      dirty={Boolean(file)}
      pending={busy}
      wide
      footer={
        <>
          <OverlayCancelButton>
            {uploadId ? "关闭" : "取消"}
          </OverlayCancelButton>
          {!uploadId && (
            <Button
              type="submit"
              form={formId}
              pending={action.pending}
              disabled={
                !file || !max || busy || (Boolean(skillId) && !skill.data)
              }
            >
              上传并校验
            </Button>
          )}
          {value?.validation_status === "failed" && (
            <Button onClick={() => onUploaded(null)}>重新选择文件</Button>
          )}
        </>
      }
    >
      <div className="mb-6 flex items-center gap-3 text-sm">
        <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
          1 · 上传技能包
        </span>
        <span className="text-muted">2 · 确认并发布</span>
      </div>
      {action.recovery}
      <AsyncBoundary
        loading={
          caps.isPending ||
          (Boolean(skillId) && skill.isPending) ||
          (Boolean(uploadId) && upload.isPending)
        }
        error={caps.error || skill.error || upload.error}
        onRetry={() => {
          void caps.refetch();
          if (skillId) void skill.refetch();
          if (uploadId) void upload.refetch();
        }}
      >
        {uploadId ? (
          <div className="space-y-5">
            <div className="flex gap-3 rounded-lg bg-surface-subtle p-4">
              <FileArchive className="size-8 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="break-all font-medium">{value?.filename}</p>
                <p className="mt-1 text-xs text-muted">
                  {value
                    ? `${Number(value.size_bytes).toLocaleString()} 字节`
                    : ""}
                </p>
              </div>
            </div>
            {validating && (
              <p role="status" className="text-sm text-muted">
                正在校验文件结构与 SKILL.md… 离开后服务端仍会继续校验。
              </p>
            )}
            {value?.validation_status === "failed" && (
              <Notice tone="danger" title="技能包校验失败">
                <ul className="space-y-2">
                  {value.issues.map((issue, i) => (
                    <li key={i}>
                      {skillUploadIssue(issue.code)}
                      {issue.path && (
                        <span className="ml-2 break-all font-mono text-xs">
                          {issue.path}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {value?.published_skill_version_id && (
              <Notice>技能包已发布。请关闭抽屉查看技能版本。</Notice>
            )}
          </div>
        ) : (
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              if (!file || busy) return;
              const body = new FormData();
              body.set("file", file);
              if (skillId) body.set("skill_id", skillId);
              void action.command.run({
                domain: agentAdminRoot,
                path: "/skills/uploads",
                command: "skill_upload.create",
                scope: "skill_uploads",
                options: { method: "POST", body },
              });
            }}
            className="space-y-5"
          >
            <ErrorNotice error={error} />
            <div
              className={`skill-dropzone ${dragging ? "is-dragging" : ""}`}
              data-testid="skill-dropzone"
              onDragEnter={(e) => {
                e.preventDefault();
                if (!busy) {
                  depth.current++;
                  setDragging(true);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = busy ? "none" : "copy";
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                depth.current = Math.max(0, depth.current - 1);
                if (!depth.current) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                depth.current = 0;
                setDragging(false);
                choose(e.dataTransfer.files);
              }}
            >
              <UploadCloud
                className="mx-auto mb-5 size-10 text-primary"
                aria-hidden
              />
              <p className="text-base font-medium">将 ZIP 技能包拖到这里</p>
              <p className="mt-2 text-sm text-muted">或从电脑中选择文件</p>
              <input
                ref={picker}
                type="file"
                accept=".zip,application/zip"
                aria-label="技能 ZIP 文件"
                className="sr-only"
                tabIndex={-1}
                disabled={busy || !max}
                onChange={(e) => {
                  choose(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                className="mt-5"
                variant="outline"
                disabled={busy || !max}
                onClick={() => picker.current?.click()}
              >
                选择文件
              </Button>
              <p className="mt-5 text-xs text-muted">
                单个 ZIP，最大{" "}
                {max ? `${Math.round(max / 1024 / 1024)} MiB` : "读取中"}
              </p>
            </div>
            {file && (
              <div className="flex items-center gap-3 rounded-lg border border-border p-4">
                <FileArchive className="size-6 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium">{file.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {file.size.toLocaleString()} 字节
                  </p>
                </div>
                <IconButton
                  label="移除已选文件"
                  disabled={busy}
                  onClick={() => setFile(null)}
                >
                  <X />
                </IconButton>
              </div>
            )}
            <p className="text-sm leading-6 text-muted">
              {skillId ? (
                <>
                  SKILL.md 中的名称须为 <code>{skill.data?.data.name}</code>。
                </>
              ) : (
                "ZIP 中需要包含 SKILL.md，可位于根目录或同名顶层目录。"
              )}{" "}
              上传只做静态校验，不执行脚本。
            </p>
          </form>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}

function PublishDrawer({
  upload,
  skill,
  onClose,
  onPublished,
  onReplace,
  restoreFocusTo,
}: {
  upload: SkillUpload;
  skill?: ApiResponse<Skill>;
  onClose: () => void;
  onPublished: (v: SkillVersion) => void;
  onReplace: () => void;
  restoreFocusTo?: HTMLElement | null;
}) {
  const metadata = upload.frontmatter!;
  const [current, setCurrent] = useState(skill);
  const [title, setTitle] = useState(metadata.name),
    [description, setDescription] = useState(metadata.description);
  const [label, setLabel] = useState(
      skill?.data.latest_version_label
        ? (incrementSkillVersion(skill.data.latest_version_label, 2) ?? "")
        : "0.1.0",
    ),
    [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false),
    [refreshError, setRefreshError] = useState<unknown>();
  const formId = useId(),
    errors = useFormErrors(),
    cache = useQueryClient();
  const action = useAgentCommand<SkillVersion>(
    `skill-upload:${upload.operation_id}:${skill ? "publish" : "create"}`,
  );
  const busy = action.pending || action.uncertain || refreshing;
  const dirty =
    title !== metadata.name ||
    description !== metadata.description ||
    note !== "" ||
    label !==
      (skill?.data.latest_version_label
        ? (incrementSkillVersion(skill.data.latest_version_label, 2) ?? "")
        : "0.1.0");
  const release = useUnsaved(dirty, busy);
  const conflict = isVersionConflict(action.state.error);
  useCommandResult(action.state, (version) => {
    release();
    action.command.reset();
    void cache.invalidateQueries({ queryKey: ["agent-resources", "skills"] });
    onPublished(version);
  });
  return (
    <Drawer
      open
      wide
      title={skill ? "发布新版" : "新建技能"}
      restoreFocusTo={restoreFocusTo}
      description={skill?.data.title ?? "确认技能信息后，创建并发布首个版本。"}
      pending={busy}
      dirty={dirty}
      onClose={() => {
        release();
        onClose();
      }}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            form={formId}
            type="submit"
            pending={action.pending}
            disabled={busy || conflict}
          >
            {skill ? "发布版本" : "创建并发布"}
          </Button>
        </>
      }
    >
      <div className="mb-6 flex items-center gap-3 text-sm">
        <span className="text-muted">1 · 上传技能包</span>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
          2 · 确认并发布
        </span>
      </div>
      <div className="mb-6 flex items-center gap-3 rounded-lg bg-surface-subtle p-4">
        <FileArchive className="size-7 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-medium">{upload.filename}</p>
          <p className="mt-1 text-xs text-muted">
            {upload.manifest?.file_count} 个文件
          </p>
        </div>
        <StatusBadge tone="success">校验通过</StatusBadge>
      </div>
      <form
        id={formId}
        ref={errors.formRef}
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || conflict) return;
          errors.clear();
          const body = {
            upload_operation_id: upload.operation_id,
            version_label: label,
            change_note: note,
          };
          await action.command.run({
            domain: agentAdminRoot,
            path: skill
              ? `/skills/${skill.data.id}/versions`
              : "/skills/from-upload",
            command: skill
              ? "skill_version.publish"
              : "skill.create_from_upload",
            scope: skill ? `skill:${skill.data.id}` : "skills",
            options: {
              method: "POST",
              etag: current?.etag,
              body: skill ? body : { ...body, title, description },
            },
          });
          const result = action.command.getSnapshot();
          if (result.phase === "failed")
            errors.show(result.error, [
              "title",
              "description",
              "version_label",
              "change_note",
            ]);
        }}
      >
        {action.recovery}
        <ErrorNotice error={refreshError} />
        {conflict && (
          <Notice tone="warning">
            技能已被修改，草稿仍保留。
            <Button
              className="mt-3"
              variant="outline"
              pending={refreshing}
              onClick={async () => {
                if (!skill) return;
                setRefreshing(true);
                setRefreshError(undefined);
                try {
                  setCurrent(
                    await request<Skill>(
                      `${agentAdminRoot}/skills/${skill.data.id}`,
                    ),
                  );
                  action.command.reset();
                } catch (e) {
                  setRefreshError(e);
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              读取最新信息后重新核对
            </Button>
          </Notice>
        )}
        <fieldset disabled={busy} className="space-y-5">
          {!skill && (
            <>
              <Field
                label="技能名称"
                hint="来自 SKILL.md，作为不可修改的规范名称。"
              >
                <Input
                  name="name"
                  readOnly
                  value={metadata.name}
                  className="font-mono"
                />
              </Field>
              <Field label="展示名称" error={errors.fields.title}>
                <Input
                  name="title"
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field
                label="描述"
                error={errors.fields.description}
                hint="用于技能管理，不会改写技能包内容。"
              >
                <Textarea
                  name="description"
                  maxLength={1024}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </>
          )}
          <SkillVersionField
            base={current?.data.latest_version_label}
            value={label}
            onChange={setLabel}
            error={errors.fields.version_label}
          />
          <Field
            label={skill ? "变更说明" : "版本说明"}
            error={errors.fields.change_note}
          >
            <Textarea
              name="change_note"
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </fieldset>
        <p className="text-xs leading-6 text-muted">
          发布后的技能包不可修改。需要更新内容时，再上传新的版本。
        </p>
        <Button variant="link" disabled={busy || dirty} onClick={onReplace}>
          重新选择技能包
        </Button>
      </form>
    </Drawer>
  );
}
