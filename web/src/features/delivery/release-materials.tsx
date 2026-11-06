import { OverlayPresence } from "@/components/overlay-presence";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileClock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { isUncertain, isVersionConflict, request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Panel } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatBytes } from "@/lib/utils";
import type { Material, MaterialKind, Page } from "@/types/delivery";
import { releaseBase, type ReleaseViewProps } from "./release-types";

const groups: Record<MaterialKind, string> = {
  sql: "数据库脚本",
  object: "对象存储文件",
  config: "配置文件",
  attachment: "附件",
};

export function ReleaseMaterials(props: ReleaseViewProps) {
  const [editor, setEditor] = useState<Material | "new" | null>(null);
  const [remove, setRemove] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material | null>(null);
  const [removed, setRemoved] = useState(false);
  const [sqlOrder, setSqlOrder] = useState<string[]>(
    props.materials.items
      .filter((item) => item.kind === "sql")
      .sort((a, b) => a.sql_position - b.sql_position)
      .map((item) => item.id),
  );
  const submission = useSubmission();
  const base = releaseBase(props);
  const editable =
    props.materials.can_edit &&
    ["draft", "integrating"].includes(props.release.status);
  function move(id: string, direction: -1 | 1) {
    const index = sqlOrder.indexOf(id);
    const target = index + direction;
    const current = sqlOrder[index];
    const swap = sqlOrder[target];
    if (current === undefined || swap === undefined) return;
    const next = [...sqlOrder];
    next[index] = swap;
    next[target] = current;
    setSqlOrder(next);
  }
  return (
    <div className="grid gap-5">
      <Panel title="交付材料">
        <TableToolbar
          onRefresh={props.onChanged}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemoved(true)}
              >
                <FileClock />
                已移出材料
              </Button>
              <Button
                size="sm"
                disabled={!editable}
                onClick={() => setEditor("new")}
              >
                <Plus />
                添加材料
              </Button>
            </div>
          }
        />

        {(["sql", "object", "config", "attachment"] as MaterialKind[]).map(
          (kind) => {
            const items = props.materials.items.filter(
              (item) => item.kind === kind,
            );
            if (!items.length) return null;
            return (
              <section key={kind} className="mb-5 last:mb-0">
                <h3 className="mb-3 text-sm font-medium">
                  {groups[kind]} · {items.length}
                </h3>
                <SimpleTable
                  actions
                  label={groups[kind]}
                  headers={[
                    ...(kind === "sql" ? ["顺序"] : []),
                    "材料",
                    "交付目标 / 用途",
                    "修订",
                    "大小",
                    "操作",
                  ]}
                >
                  {items.map((item) => (
                    <tr key={item.id}>
                      {kind === "sql" && (
                        <td>
                          <div className="flex">
                            <IconButton
                              size="iconSm"
                              label={`上移 ${item.filename}`}
                              disabled={!editable}
                              onClick={() => move(item.id, -1)}
                            >
                              <ArrowUp />
                            </IconButton>
                            <IconButton
                              size="iconSm"
                              label={`下移 ${item.filename}`}
                              disabled={!editable}
                              onClick={() => move(item.id, 1)}
                            >
                              <ArrowDown />
                            </IconButton>
                          </div>
                        </td>
                      )}
                      <td>
                        <strong className="break-all text-foreground">
                          {item.filename}
                        </strong>
                        {item.description_md && (
                          <small className="mt-1 block max-w-md whitespace-normal text-muted">
                            {item.description_md}
                          </small>
                        )}
                      </td>
                      <td className="max-w-sm whitespace-normal text-xs">
                        {item.kind === "sql"
                          ? item.database_name || "未指定数据库"
                          : item.kind === "object"
                            ? `${item.bucket_name || "未指定 Bucket"} · ${item.target_path}`
                            : item.kind === "config"
                              ? `${item.target_path} · ${item.config_format} · ${item.config_mode}`
                              : "附件"}
                      </td>
                      <td className="mono">r{item.revision_no}</td>
                      <td className="text-xs">
                        {formatBytes(item.size_bytes)}
                      </td>
                      <td>
                        <RowActions label={item.filename}>
                          <RowAction
                            icon={<Download />}
                            href={`/api/v1${base}/items/${item.id}/revisions/${item.revision_id}/file`}
                          >
                            下载文件
                          </RowAction>
                          <RowAction
                            icon={<FileClock />}
                            onSelect={() => setHistory(item)}
                          >
                            修订历史
                          </RowAction>
                          {editable && (
                            <>
                              <RowAction
                                icon={<Pencil />}
                                onSelect={() => setEditor(item)}
                              >
                                编辑材料
                              </RowAction>
                              <RowActionSeparator />
                              <RowAction
                                icon={<Trash2 />}
                                variant="destructive"
                                onSelect={() => setRemove(item)}
                              >
                                移出材料
                              </RowAction>
                            </>
                          )}
                        </RowActions>
                      </td>
                    </tr>
                  ))}
                </SimpleTable>
              </section>
            );
          },
        )}
        {!props.materials.items.length && (
          <p className="p-8 text-center text-sm text-muted">
            暂无交付材料；可只交付 MR 与直接提交。
          </p>
        )}
        {sqlOrder.length > 1 && editable && (
          <div className="form-actions">
            <Button
              variant="outline"
              pending={submission.pending}
              onClick={() =>
                void submission.run(async () => {
                  await request(`${base}/sql-order`, {
                    method: "PUT",
                    etag: props.releaseEtag,
                    body: { item_ids: sqlOrder },
                  });
                  await props.onChanged();
                })
              }
            >
              保存 SQL 顺序
            </Button>
            <ErrorNotice error={submission.error} />
          </div>
        )}
      </Panel>
      <OverlayPresence>
        {editor && (
          <MaterialEditor
            {...props}
            material={editor === "new" ? undefined : editor}
            onClose={() => setEditor(null)}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {history && (
          <MaterialHistory
            {...props}
            material={history}
            onClose={() => setHistory(null)}
          />
        )}
      </OverlayPresence>
      {removed && (
        <RemovedMaterials {...props} onClose={() => setRemoved(false)} />
      )}
      {remove && (
        <ConfirmDialog
          open
          danger
          title="移出材料"
          description={remove.filename}
          confirmLabel="移出当前清单"
          pending={submission.pending}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            void submission.run(async () => {
              await request(`${base}/items/${remove.id}`, {
                method: "DELETE",
                etag: props.releaseEtag,
              });
              await props.onChanged();
              setRemove(null);
            })
          }
        >
          <ErrorNotice error={submission.error} />
          <p className="text-sm text-muted">
            历史修订与文件仍可读取，不会物理删除。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function MaterialEditor(
  props: ReleaseViewProps & { material?: Material; onClose: () => void },
) {
  const material = props.material;
  const [form, setForm] = useState({
    kind: material?.kind ?? ("attachment" as MaterialKind),
    filename: material?.filename ?? "",
    description_md: material?.description_md ?? "",
    repository_id: material?.repository_id ?? "",
    database_name: material?.database_name ?? "",
    bucket_name: material?.bucket_name ?? "",
    target_path: material?.target_path ?? "",
    config_format: material?.config_format ?? "yaml",
    config_mode: material?.config_mode ?? "delta",
  });
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const [recovery, setRecovery] = useState<"conflict" | "unknown" | null>(null);
  const dirty = true;
  useUnsaved(dirty, submission.pending);
  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    errors.change(key);
    setRecovery(null);
  }
  async function save() {
    const fields: Record<string, string> = {};
    if (!form.filename.trim()) fields.filename = "请输入文件名";
    if (form.kind === "object" && !form.target_path.trim())
      fields.target_path = "请输入目标对象路径";
    if (form.kind === "config" && !form.target_path.trim())
      fields.target_path = "请输入目标相对路径";
    if (!material && form.kind !== "config" && !file)
      fields.file = "请选择上传文件";
    if (!material && form.kind === "config" && !content)
      fields.content = "请输入配置原文";
    if (file && file.size > 100 * 1024 * 1024)
      fields.file = "单个文件不能超过 100 MiB";
    if (
      form.kind === "config" &&
      new TextEncoder().encode(content).length > 1024 * 1024
    )
      fields.content = "在线配置不能超过 1 MiB";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        const body = new FormData();
        body.append("metadata", JSON.stringify(form));
        let upload = file;
        if (form.kind === "config" && content)
          upload = new File([content], form.filename, {
            type: "text/plain;charset=utf-8",
          });
        if (upload) body.append("file", upload, form.filename);
        await request(
          `${releaseBase(props)}/items${material ? `/${material.id}` : ""}`,
          {
            method: material ? "PATCH" : "POST",
            etag: props.releaseEtag,
            body,
          },
        );
        await props.onChanged();
        props.onClose();
      },
      (error) => {
        errors.show(error, Object.keys(form), {
          "metadata.description_md": "description_md",
        });
        if (isVersionConflict(error)) setRecovery("conflict");
        if (isUncertain(error)) setRecovery("unknown");
      },
    );
  }
  return (
    <Drawer
      open
      wide
      title={
        material ? `编辑材料 · r${material.revision_no + 1}` : "添加交付材料"
      }
      description="每次保存生成不可变修订；失败保留文字和文件选择"
      dirty={dirty}
      pending={submission.pending}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          <Button
            pending={submission.pending}
            disabled={Boolean(recovery)}
            onClick={() => void save()}
          >
            保存材料修订
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {recovery && (
          <Notice
            tone="warning"
            title={recovery === "conflict" ? "版本已变化" : "保存结果未知"}
          >
            {recovery === "conflict"
              ? "当前草稿与文件仍保留。请读取最新材料并对照后重新打开编辑，不会自动覆盖。"
              : "请先读取当前材料清单与修订，确认上次请求是否已保存；不要直接重试。"}
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void props.onChanged()}
            >
              只读刷新最新材料
            </Button>
          </Notice>
        )}
        <div className="form-grid">
          <Field label="材料类型" required>
            <Select
              disabled={Boolean(material)}
              value={form.kind}
              onValueChange={(value) => update("kind", value)}
            >
              {Object.entries(groups).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="文件名" required error={errors.fields.filename}>
            <Input
              name="filename"
              value={form.filename}
              onChange={(event) => update("filename", event.target.value)}
            />
          </Field>
          <Field label="关联仓库（可选）" className="form-full">
            <Select
              value={form.repository_id}
              onValueChange={(value) => update("repository_id", value)}
            >
              <option value="">不关联仓库</option>
              {props.materials.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.full_path}
                </option>
              ))}
            </Select>
          </Field>
          {form.kind === "sql" && (
            <Field
              label="目标数据库（可选）"
              className="form-full"
              error={errors.fields.database_name}
            >
              <Input
                name="database_name"
                value={form.database_name}
                onChange={(event) =>
                  update("database_name", event.target.value)
                }
              />
            </Field>
          )}
          {form.kind === "object" && (
            <>
              <Field label="Bucket（可选）" error={errors.fields.bucket_name}>
                <Input
                  name="bucket_name"
                  value={form.bucket_name}
                  onChange={(event) =>
                    update("bucket_name", event.target.value)
                  }
                />
              </Field>
              <Field
                label="目标对象路径"
                required
                error={errors.fields.target_path}
              >
                <Input
                  name="target_path"
                  className="mono"
                  value={form.target_path}
                  onChange={(event) =>
                    update("target_path", event.target.value)
                  }
                />
              </Field>
            </>
          )}
          {form.kind === "config" && (
            <>
              <Field label="配置格式" required>
                <Select
                  value={form.config_format}
                  onValueChange={(value) => update("config_format", value)}
                >
                  {["yaml", "toml", "json", "ini", "properties"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </Select>
              </Field>
              <Field label="内容模式" required>
                <Select
                  value={form.config_mode}
                  onValueChange={(value) => update("config_mode", value)}
                >
                  <option value="delta">增量</option>
                  <option value="full">完整文件</option>
                </Select>
              </Field>
              <Field
                label="目标相对路径"
                required
                className="form-full"
                error={errors.fields.target_path}
              >
                <Input
                  name="target_path"
                  className="mono"
                  value={form.target_path}
                  onChange={(event) =>
                    update("target_path", event.target.value)
                  }
                />
              </Field>
            </>
          )}
          <Field
            label="材料说明（Markdown）"
            className="form-full"
            error={errors.fields.description_md}
          >
            <Textarea
              name="description_md"
              value={form.description_md}
              onChange={(event) => update("description_md", event.target.value)}
            />
          </Field>
        </div>
        {form.kind === "config" ? (
          <Field
            label="配置原文"
            required={!material}
            hint={material ? "填写后替换文件；仅修改元数据可留空" : undefined}
            error={errors.fields.content}
          >
            <Textarea
              name="content"
              className="min-h-56 font-mono"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={material ? "替换文件（可选）" : "上传文件"}
            required={!material}
            hint="单文件最多 100 MiB"
            error={errors.fields.file}
          >
            <Input
              name="file"
              type="file"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected && !form.filename)
                  update("filename", selected.name);
              }}
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}

function MaterialHistory(
  props: ReleaseViewProps & { material: Material; onClose: () => void },
) {
  const [page, setPage] = useState(1);
  const query = useApiQuery<Page<Material>>(
    ["material-history", props.release.id, props.material.id, page],
    `${releaseBase(props)}/items/${props.material.id}/revisions?page=${page}&page_size=20`,
  );
  return (
    <Drawer
      open
      title="材料修订历史"
      description={props.material.filename}
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>关闭</Button>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <>
            <SimpleTable
              actions
              label="材料修订"
              headers={["修订", "文件", "大小", "SHA-256", "下载"]}
            >
              {query.data.data.items.map((item) => (
                <tr key={item.revision_id}>
                  <td className="mono">r{item.revision_no}</td>
                  <td>{item.filename}</td>
                  <td>{formatBytes(item.size_bytes)}</td>
                  <td className="mono break-all text-xs">{item.sha256}</td>
                  <td>
                    <a
                      className="link"
                      href={`/api/v1${releaseBase(props)}/items/${item.id}/revisions/${item.revision_id}/file`}
                    >
                      <Download className="size-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </SimpleTable>
            <Pagination
              page={page}
              size={20}
              total={query.data.data.total}
              onChange={(nextPage) => setPage(nextPage)}
            />
          </>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}

function RemovedMaterials(props: ReleaseViewProps & { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const query = useApiQuery<Page<Material>>(
    ["removed-materials", props.release.id, page],
    `${releaseBase(props)}/removed-items?page=${page}&page_size=20`,
  );
  return (
    <Modal
      open
      wide
      title="已移出材料"
      description="历史修订保留，可继续核对与下载"
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>关闭</Button>}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.items.length}
        emptyTitle="没有已移出材料"
      >
        {query.data && (
          <>
            <SimpleTable
              actions
              label="已移出材料"
              headers={["类型", "文件", "修订", "下载"]}
            >
              {query.data.data.items.map((item) => (
                <tr key={item.id}>
                  <td>{groups[item.kind]}</td>
                  <td>{item.filename}</td>
                  <td>r{item.revision_no}</td>
                  <td>
                    <a
                      className="link"
                      href={`/api/v1${releaseBase(props)}/items/${item.id}/revisions/${item.revision_id}/file`}
                    >
                      <Download className="size-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </SimpleTable>
            <Pagination
              page={page}
              size={20}
              total={query.data.data.total}
              onChange={(nextPage) => setPage(nextPage)}
            />
          </>
        )}
      </AsyncBoundary>
    </Modal>
  );
}
