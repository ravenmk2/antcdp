import { useState } from "react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import {
  Field,
  Input,
  StandaloneInput,
  StandaloneSelect,
} from "@/components/fields";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type {
  ProjectRepository,
  RepositoryLabel,
  RepositoryLabelDefinition,
} from "@/types/integrations";

type LabelList = {
  items: RepositoryLabelDefinition[];
  mutation_version: string;
};
export function useRepositoryLabels(projectId: string) {
  return useApiQuery<LabelList>(
    ["repository-labels", projectId],
    `/projects/${projectId}/repository-labels`,
  );
}
export function RepositoryLabelBadges({
  labels = [],
}: {
  labels?: RepositoryLabel[];
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label.id}
          title={label.code}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs text-foreground"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: label.color }}
          />
          <span className="break-all">{label.name}</span>
        </span>
      ))}
    </span>
  );
}
export function RepositoryLabelFilter({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const query = useRepositoryLabels(projectId);
  return (
    <div>
      <StandaloneSelect
        className="w-50"
        aria-label="标签筛选"
        value={value}
        onValueChange={onChange}
      >
        <option value="">全部标签</option>
        {query.data?.data.items.map((label) => (
          <option key={label.id} value={label.code}>
            {label.name} · {label.code}
          </option>
        ))}
      </StandaloneSelect>
      {query.error && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          重新加载标签
        </Button>
      )}
    </div>
  );
}
function needsReload(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.uncertain ||
      ["VERSION_CONFLICT", "PRECONDITION_REQUIRED"].includes(error.code))
  );
}

export function RepositoryLabelManager({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const query = useRepositoryLabels(projectId);
  const [edit, setEdit] = useState<RepositoryLabelDefinition | "new" | null>(
    null,
  );
  const [remove, setRemove] = useState<
    (RepositoryLabelDefinition & { version: string }) | null
  >(null);
  const submission = useSubmission();
  async function refresh() {
    await onSaved();
    await query.refetch();
  }
  async function deleteLabel() {
    if (!remove || !query.data || submission.pending || submission.uncertain)
      return;
    const ok = await submission.run(async () => {
      await request(`/projects/${projectId}/repository-labels/${remove.id}`, {
        method: "DELETE",
        etag: remove.version,
      });
    });
    if (ok) {
      setRemove(null);
      await refresh();
    }
  }
  return (
    <>
      <Drawer
        open
        wide
        title="管理仓库标签"
        description="标签在当前项目内共享，编码供程序读取。"
        onClose={onClose}
        footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
      >
        <Button onClick={() => setEdit("new")} disabled={!query.data}>
          新建标签
        </Button>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          <ul className="mt-4 divide-y divide-border-subtle">
            {query.data?.data.items.map((label) => (
              <li
                key={label.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <RepositoryLabelBadges labels={[label]} />
                  <p className="mt-1 break-all text-xs text-muted">
                    {label.code} · {label.repository_count} 个仓库
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`编辑标签 ${label.name}`}
                    onClick={() => setEdit(label)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`删除标签 ${label.name}`}
                    onClick={() => {
                      submission.setError(null);
                      setRemove({
                        ...label,
                        version: query.data!.data.mutation_version,
                      });
                    }}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {query.data?.data.items.length === 0 && (
            <p className="py-6 text-sm text-muted">
              暂无标签，可按仓库用途创建。
            </p>
          )}
        </AsyncBoundary>
      </Drawer>
      <OverlayPresence>
        {edit && (
          <RepositoryLabelEditor
            projectId={projectId}
            label={edit === "new" ? null : edit}
            version={query.data?.data.mutation_version ?? ""}
            onClose={() => setEdit(null)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={!!remove}
        danger
        title="删除仓库标签"
        description={remove?.name}
        pending={submission.pending}
        confirmDisabled={needsReload(submission.error)}
        onClose={() => setRemove(null)}
        onConfirm={() => void deleteLabel()}
        confirmLabel="删除标签"
      >
        <p>
          将从 {remove?.repository_count ?? 0} 个仓库移除此标签，仓库关联保留。
        </p>
        <ErrorNotice error={submission.error} />
        {needsReload(submission.error) && (
          <Button
            variant="outline"
            onClick={async () => {
              const result = await query.refetch();
              if (!result.error) {
                setRemove(null);
                submission.setError(null);
              }
            }}
          >
            重新加载并核实
          </Button>
        )}
      </ConfirmDialog>
    </>
  );
}

function RepositoryLabelEditor({
  projectId,
  label,
  version,
  onClose,
  onSaved,
}: {
  projectId: string;
  label: RepositoryLabelDefinition | null;
  version: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState(label?.code ?? "");
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState(label?.color ?? "#3B82F6");
  const [etag, setEtag] = useState(version);
  const [reloading, setReloading] = useState(false);
  const form = useFormErrors();
  const submission = useSubmission();
  const dirty =
    code !== (label?.code ?? "") ||
    name !== (label?.name ?? "") ||
    color !== (label?.color ?? "#3B82F6");
  const release = useUnsaved(dirty, submission.pending);
  async function save() {
    if (submission.pending || needsReload(submission.error)) return;
    if (
      !form.validate({
        code: /^[a-z][a-z0-9_-]{0,63}$/.test(code)
          ? ""
          : "以小写字母开头，最多 64 位，允许数字、下划线和连字符",
        name:
          name.trim() && [...name.trim()].length <= 100
            ? ""
            : "请输入 1–100 字符的名称",
        color: /^#[0-9a-fA-F]{6}$/.test(color) ? "" : "请输入 #RRGGBB 颜色",
      })
    )
      return;
    const ok = await submission.run(
      async () => {
        await request(
          `/projects/${projectId}/repository-labels${label ? `/${label.id}` : ""}`,
          {
            method: label ? "PATCH" : "POST",
            etag,
            body: { ...(label ? {} : { code }), name, color },
          },
        );
      },
      (error) => form.show(error, ["code", "name", "color"]),
    );
    if (ok) {
      release();
      onClose();
      await onSaved();
    }
  }
  async function reload() {
    setReloading(true);
    try {
      const current = await request<LabelList>(
        `/projects/${projectId}/repository-labels`,
      );
      setEtag(current.data.mutation_version);
      submission.setError(null);
      form.clear();
      if (label) {
        const fresh = current.data.items.find((item) => item.id === label.id);
        if (!fresh) {
          release();
          onClose();
        } else {
          setName(fresh.name);
          setColor(fresh.color);
        }
      }
    } catch (error) {
      submission.setError(error);
    } finally {
      setReloading(false);
    }
  }
  return (
    <Drawer
      open
      title={label ? "编辑仓库标签" : "新建仓库标签"}
      onClose={onClose}
      dirty={dirty}
      pending={submission.pending || reloading}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form="repository-label-form"
            disabled={
              submission.pending || reloading || needsReload(submission.error)
            }
          >
            保存
          </Button>
        </>
      }
    >
      <form
        id="repository-label-form"
        ref={form.formRef}
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="编码"
          error={form.fields.code}
          hint="创建后不可修改，用于程序识别标签。"
        >
          <Input
            name="code"
            value={code}
            readOnly={!!label}
            maxLength={64}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="名称" error={form.fields.name}>
          <Input
            name="name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="颜色" error={form.fields.color}>
          <Input
            name="color"
            value={color}
            maxLength={7}
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="预设颜色"
        >
          {[
            "#3B82F6",
            "#10B981",
            "#F59E0B",
            "#EF4444",
            "#8B5CF6",
            "#64748B",
          ].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`选择颜色 ${value}`}
              aria-pressed={color.toUpperCase() === value}
              className="size-8 rounded-md border-2 border-border aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              style={{ backgroundColor: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
        <RepositoryLabelBadges
          labels={[
            {
              id: "preview",
              code,
              name: name || "标签预览",
              color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#64748B",
            },
          ]}
        />
        <ErrorNotice error={form.error || submission.error} />
        {needsReload(submission.error) && (
          <Button variant="outline" onClick={() => void reload()}>
            重新加载并核实当前标签定义
          </Button>
        )}
      </form>
    </Drawer>
  );
}

export function RepositoryLabelPicker({
  projectId,
  repository,
  onClose,
  onSaved,
}: {
  projectId: string;
  repository: ProjectRepository;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const labels = useRepositoryLabels(projectId);
  const detail = useApiQuery<ProjectRepository>(
    ["repository", projectId, repository.id],
    `/projects/${projectId}/repositories/${repository.id}`,
  );
  const [draft, setDraft] = useState<{
    ids: string[];
    original: string[];
    etag: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [reloading, setReloading] = useState(false);
  const submission = useSubmission();
  const current = detail.data?.data;
  const original =
    draft?.original ?? (current?.labels ?? []).map((item) => item.id);
  const selected = draft?.ids ?? original;
  const dirty =
    [...selected].sort().join(",") !== [...original].sort().join(",");
  const release = useUnsaved(dirty, submission.pending);
  async function save() {
    if (!current || submission.pending || needsReload(submission.error)) return;
    const ok = await submission.run(async () => {
      await request(
        `/projects/${projectId}/repositories/${repository.id}/labels`,
        {
          method: "PUT",
          etag: draft?.etag || detail.data?.etag || current.etag,
          body: { label_ids: selected },
        },
      );
    });
    if (ok) {
      release();
      onClose();
      await onSaved();
    }
  }
  async function reload() {
    setReloading(true);
    try {
      const [a, b] = await Promise.all([detail.refetch(), labels.refetch()]);
      if (!a.error && !b.error) {
        setDraft(null);
        submission.setError(null);
      }
    } finally {
      setReloading(false);
    }
  }
  return (
    <Drawer
      open
      title="设置仓库标签"
      description={repository.full_path}
      onClose={onClose}
      dirty={dirty}
      pending={submission.pending || reloading}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            disabled={
              !current ||
              !labels.data ||
              !!detail.error ||
              !!labels.error ||
              submission.pending ||
              reloading ||
              needsReload(submission.error)
            }
            onClick={() => void save()}
          >
            保存
          </Button>
        </>
      }
    >
      <AsyncBoundary
        loading={detail.isPending || labels.isPending}
        error={detail.error || labels.error}
        onRetry={() => void reload()}
      >
        <StandaloneInput
          aria-label="搜索标签"
          placeholder="搜索名称或编码"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-4 grid gap-3">
          {labels.data?.data.items
            .filter((label) =>
              `${label.name} ${label.code}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((label) => (
              <label
                key={label.id}
                className="flex items-center gap-3 rounded-md border border-border-subtle p-3"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.includes(label.id)}
                  onChange={(event) =>
                    setDraft({
                      ids: event.target.checked
                        ? [...selected, label.id]
                        : selected.filter((id) => id !== label.id),
                      original,
                      etag: draft?.etag || detail.data?.etag || current!.etag,
                    })
                  }
                />
                <span className="min-w-0">
                  <RepositoryLabelBadges labels={[label]} />
                  <span className="mt-1 block break-all text-xs text-muted">
                    {label.code}
                  </span>
                </span>
              </label>
            ))}
        </div>
        {labels.data?.data.items.length === 0 && (
          <p className="mt-4 text-sm text-muted">
            暂无标签，请先在“管理标签”中新建。
          </p>
        )}
        <p className="mt-4 text-xs text-muted">
          已选 {selected.length} 个标签；取消全部选择可清空。
        </p>
        <ErrorNotice error={submission.error} />
        {needsReload(submission.error) && (
          <Button variant="outline" onClick={() => void reload()}>
            重新加载并核实当前标签
          </Button>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}
