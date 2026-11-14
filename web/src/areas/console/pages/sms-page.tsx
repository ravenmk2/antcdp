import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Plus,
  Send,
  Trash2,
  Server,
  FileText,
  History,
  KeyRound,
  Power,
} from "lucide-react";
import { isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Field,
  Input,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { SheetClose } from "@/components/ui/sheet";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatDate } from "@/lib/utils";
import {
  messageStatusLabels,
  type SmsProfile,
  type SmsTemplate,
} from "@/types/messages";
import {
  SmsTemplateEditor,
  SmsTest,
  useSmsOptions,
} from "@/features/sms/sms-editors";
import { CopyButton } from "@/components/copy-button";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { MessageLogDetail, MessageLogList } from "@/features/messages/log-list";

const base = "/admin/sms";
const sections = [
  {
    value: "profiles",
    label: (
      <span className="inline-flex items-center gap-2">
        <Server className="size-4" />
        短信配置
      </span>
    ),
  },
  {
    value: "templates",
    label: (
      <span className="inline-flex items-center gap-2">
        <FileText className="size-4" />
        短信模板
      </span>
    ),
  },
  {
    value: "send-logs",
    label: (
      <span className="inline-flex items-center gap-2">
        <History className="size-4" />
        发送日志
      </span>
    ),
  },
];
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export function SmsPage() {
  const { section = "profiles", id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  if (!sections.some((item) => item.value === section))
    return <Notice tone="danger">页面不存在。</Notice>;
  return (
    <div className="page">
      {(!id || section === "send-logs") && (
        <PageHeader
          title="短信管理"
          description="管理短信配置与模板，进行发送测试并查询发送记录。"
          actions={
            <Button
              variant="outline"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("test", "1");
                setParams(next);
              }}
            >
              <Send />
              发送测试
            </Button>
          }
        />
      )}
      {(!id || section === "send-logs") && (
        <Tabs
          label="短信功能"
          value={section}
          onChange={(value) => navigate(`${base}/${value}`)}
          items={sections}
        />
      )}
      <div className="mt-5">
        {section === "send-logs" && <SmsLogList />}
        <OverlayPresence>
          {section === "send-logs" && id && (
            <MessageLogDetail
              module="sms"
              id={id}
              onClose={() => navigate(`${base}/send-logs?${params}`)}
            />
          )}
        </OverlayPresence>
        {section === "profiles" &&
          (id ? <ProfileDetail id={id} /> : <ProfileList />)}
        {section === "templates" &&
          (id ? <SmsTemplateEditor key={id} id={id} /> : <TemplateList />)}
      </div>
      <OverlayPresence>
        {params.get("test") === "1" && (
          <SmsTest
            initialProfileId={section === "profiles" ? id : undefined}
            initialTemplateId={
              section === "templates" && id !== "new" ? id : undefined
            }
            onClose={() => {
              const next = new URLSearchParams(params);
              next.delete("test");
              setParams(next, { replace: true });
            }}
          />
        )}
      </OverlayPresence>
    </div>
  );
}

function ProfileList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 20;
  const [create, setCreate] = useState(false);
  const queryClient = useQueryClient();
  const query = useApiQuery<Page<SmsProfile>>(
    ["sms-profiles", q, status, page, size],
    `${base}/profiles?${new URLSearchParams({ q, status, page: String(page), page_size: String(size) })}`,
  );
  return (
    <>
      <Panel bodyClassName="p-0">
        <TableToolbar
          onReset={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("q");
              next.delete("status");
              next.set("page", "1");
              return next;
            })
          }
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
          actions={
            <Button
              className="flex items-center gap-2"
              onClick={() => setCreate(true)}
            >
              <Plus />
              新增配置
            </Button>
          }
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set(
                  "q",
                  String(new FormData(event.currentTarget).get("q") ?? ""),
                );
                next.set("page", "1");
                return next;
              });
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索短信配置"
              defaultValue={q}
              placeholder="搜索名称或编码"
            />
          </form>
          <StandaloneSelect
            aria-label="短信配置状态"
            value={status}
            onValueChange={(value) =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("status", value);
                next.set("page", "1");
                return next;
              })
            }
          >
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={!query.data?.data.items.length}
          emptyTitle={q || status ? "没有符合条件的短信配置" : "还没有短信配置"}
        >
          {query.data && (
            <SimpleTable
              actions
              label="短信配置"
              headers={[
                "配置",
                "供应商",
                "AccessKey ID",
                "状态",
                "最近发送",
                "操作",
              ]}
            >
              {query.data.data.items.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <Link
                      className="break-all font-medium text-foreground hover:text-primary"
                      to={`${base}/profiles/${profile.id}`}
                    >
                      {profile.name}
                    </Link>
                    <small className="mono block break-all text-muted">
                      {profile.code}
                    </small>
                  </td>
                  <td>阿里云</td>
                  <td>
                    <span className="mono break-all">
                      {profile.access_key_id}
                    </span>
                    <small className="block text-muted">
                      {profile.has_secret ? "认证已配置" : "缺少认证秘密"}
                    </small>
                  </td>
                  <td>
                    <StatusBadge tone={profile.enabled ? "success" : "neutral"}>
                      {profile.enabled ? "已启用" : "已停用"}
                    </StatusBadge>
                  </td>
                  <td>
                    {profile.latest
                      ? messageStatusLabels[profile.latest.status]
                      : "尚无记录"}
                  </td>
                  <td>
                    <Link
                      className="link"
                      to={`${base}/profiles/${profile.id}`}
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </AsyncBoundary>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={query.data.data.total}
            onChange={(nextPage, nextSize) => {
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("page", String(nextPage));
                next.set("page_size", String(nextSize));
                return next;
              });
            }}
          />
        )}
      </Panel>
      <OverlayPresence>
        {create && (
          <ProfileEditor
            onClose={() => setCreate(false)}
            onSaved={async (id) => {
              setCreate(false);
              await queryClient.invalidateQueries({
                queryKey: ["sms-profiles"],
              });
              navigate(`${base}/profiles/${id}`);
            }}
          />
        )}
      </OverlayPresence>
    </>
  );
}

function ProfileDetail({ id }: { id: string }) {
  const query = useApiQuery<SmsProfile>(
    ["sms-profile", id],
    `${base}/profiles/${id}`,
  );
  const [mode, setMode] = useState<"edit" | "auth" | null>(null);
  const [remove, setRemove] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submission = useSubmission();
  if (query.isPending || query.error)
    return (
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const profile = query.data.data;
  return (
    <section className="grid gap-5">
      <PageHeader
        title={profile.name}
        description="阿里云 · 中国站国内短信"
        actions={
          <RowActions label={profile.name} disabled={submission.pending}>
            <RowAction
              icon={<Send />}
              disabled={!profile.enabled || !profile.has_secret}
              onSelect={() => navigate(`${base}/profiles/${id}?test=1`)}
            >
              发送测试
            </RowAction>
            <RowAction icon={<Pencil />} onSelect={() => setMode("edit")}>
              编辑资料
            </RowAction>
            <RowAction icon={<KeyRound />} onSelect={() => setMode("auth")}>
              替换认证
            </RowAction>
            <RowAction
              icon={<Power />}
              onSelect={() =>
                void submission.run(async () => {
                  await request(`${base}/profiles/${id}`, {
                    method: "PATCH",
                    etag: query.data.etag,
                    body: { enabled: !profile.enabled },
                  });
                  await query.refetch();
                  await queryClient.invalidateQueries({
                    queryKey: ["sms-profiles"],
                  });
                })
              }
            >
              {profile.enabled ? "停用配置" : "启用配置"}
            </RowAction>
            <RowActionSeparator />
            <RowAction
              icon={<Trash2 />}
              variant="destructive"
              onSelect={() => setRemove(true)}
            >
              删除配置
            </RowAction>
          </RowActions>
        }
      />
      <Panel title="阿里云短信配置">
        <DescriptionList
          items={[
            {
              label: "编码",
              value: (
                <span className="inline-flex items-center gap-2">
                  <code>{profile.code}</code>
                  <CopyButton value={profile.code} label="复制配置编码" />
                </span>
              ),
            },
            { label: "供应商", value: "阿里云 · 中国站国内短信" },
            { label: "AccessKey ID", value: profile.access_key_id },
            {
              label: "认证秘密",
              value: profile.has_secret ? "已加密保存" : "未配置",
            },
            { label: "状态", value: profile.enabled ? "已启用" : "已停用" },
            { label: "说明", value: profile.description || "—", full: true },
          ]}
        />
        <ErrorNotice error={submission.error} />
        {isVersionConflict(submission.error) && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新加载配置
          </Button>
        )}
      </Panel>
      <Panel title="最近真实发送">
        {profile.latest ? (
          <Notice
            tone={profile.latest.status === "accepted" ? "success" : "warning"}
          >
            {messageStatusLabels[profile.latest.status]} ·{" "}
            {formatDate(profile.latest.started_at)}
            <Link
              className="link ml-3"
              to={`${base}/send-logs/${profile.latest.id}`}
            >
              查看记录
            </Link>
          </Notice>
        ) : (
          <p className="text-sm text-muted">尚无发送记录。</p>
        )}
      </Panel>
      <OverlayPresence>
        {mode && (
          <ProfileEditor
            profile={profile}
            etag={query.data.etag}
            authOnly={mode === "auth"}
            onClose={() => setMode(null)}
            onSaved={async () => {
              setMode(null);
              await queryClient.invalidateQueries({
                queryKey: ["sms-profile", id],
              });
              await queryClient.invalidateQueries({
                queryKey: ["sms-profiles"],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={remove}
        danger
        title="删除短信配置"
        description={profile.name}
        confirmLabel="删除配置"
        pending={submission.pending}
        onClose={() => setRemove(false)}
        onConfirm={() =>
          void submission.run(async () => {
            await request(`${base}/profiles/${id}`, {
              method: "DELETE",
              etag: query.data.etag,
            });
            navigate(`${base}/profiles`);
            await queryClient.invalidateQueries({ queryKey: ["sms-profiles"] });
          })
        }
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">
          被任何远端模板引用时不可删除；既有日志保留至到期。
        </p>
      </ConfirmDialog>
    </section>
  );
}

function ProfileEditor({
  profile,
  etag,
  authOnly = false,
  onClose,
  onSaved,
}: {
  profile?: SmsProfile;
  etag?: string;
  authOnly?: boolean;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: profile?.code ?? "",
    name: profile?.name ?? "",
    description: profile?.description ?? "",
    enabled: profile?.enabled ?? true,
    access_key_id: profile?.access_key_id ?? "",
    access_key_secret: "",
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const [editTag, setEditTag] = useState(etag);
  const [latestProfile, setLatestProfile] = useState<SmsProfile | null>(null);
  const recovery = useSubmission();
  const client = useQueryClient();
  const [baseline] = useState({
    code: profile?.code ?? "",
    name: profile?.name ?? "",
    description: profile?.description ?? "",
    enabled: profile?.enabled ?? true,
    access_key_id: profile?.access_key_id ?? "",
    access_key_secret: "",
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const markSaved = useUnsaved(dirty, submission.pending);
  async function save() {
    if (submission.pending || submission.uncertain || latestProfile) return;
    errors.clear();
    if (
      !form.name.trim() ||
      ((!profile || authOnly) && !form.access_key_id.trim()) ||
      ((!profile || authOnly) && !form.access_key_secret)
    ) {
      errors.validate({
        name: !form.name.trim() ? "请输入配置名称" : "",
        access_key_id: !form.access_key_id.trim() ? "请输入 AccessKey ID" : "",
        access_key_secret:
          (!profile || authOnly) && !form.access_key_secret
            ? "请输入 AccessKey Secret"
            : "",
      });
      return;
    }
    await submission.run(
      async () => {
        const response =
          authOnly && profile
            ? await request<SmsProfile>(
                `${base}/profiles/${profile.id}/authentication`,
                {
                  method: "PUT",
                  etag: editTag,
                  body: {
                    access_key_id: form.access_key_id,
                    access_key_secret: form.access_key_secret,
                  },
                },
              )
            : await request<SmsProfile>(
                profile ? `${base}/profiles/${profile.id}` : `${base}/profiles`,
                {
                  method: profile ? "PATCH" : "POST",
                  etag: profile ? editTag : undefined,
                  body: {
                    ...(profile ? {} : { code: form.code.trim() }),
                    name: form.name.trim(),
                    description: form.description,
                    enabled: form.enabled,
                    config: { provider: "aliyun_sms" },
                    ...(profile
                      ? {}
                      : {
                          authentication: {
                            access_key_id: form.access_key_id,
                            access_key_secret: form.access_key_secret,
                          },
                        }),
                  },
                },
              );
        await client.invalidateQueries({ queryKey: ["sms-options"] });
        markSaved();
        await onSaved(response.data.id);
      },
      (error) =>
        errors.show(error, [
          "name",
          "code",
          "access_key_id",
          "access_key_secret",
        ]),
    );
  }
  return (
    <Drawer
      open
      title={
        authOnly ? "替换阿里云认证" : profile ? "编辑短信配置" : "新增短信配置"
      }
      description="固定阿里云中国站；秘密保存后不可读取"
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <SheetClose
            render={
              <Button variant="outline" disabled={submission.pending}>
                取消
              </Button>
            }
          />
          <Button
            disabled={!dirty || submission.uncertain || !!latestProfile}
            pending={submission.pending}
            onClick={() => void save()}
          >
            保存
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error || submission.error} />
        <ErrorNotice error={recovery.error} />
        {(isVersionConflict(submission.error) || submission.uncertain) && (
          <Notice tone="warning">
            请核对最新资料；草稿会保留，认证秘密不会回显。
            {profile ? (
              <Button
                variant="outline"
                size="sm"
                pending={recovery.pending}
                onClick={() =>
                  void recovery.run(async () => {
                    const response = await request<SmsProfile>(
                      `${base}/profiles/${profile.id}`,
                    );
                    setLatestProfile(response.data);
                    setEditTag(response.etag);
                  })
                }
              >
                读取最新资料
              </Button>
            ) : (
              <p>创建结果未知，请先关闭窗口并刷新配置列表核实。</p>
            )}
          </Notice>
        )}
        {latestProfile && (
          <Notice tone="info">
            <p className="break-all">
              当前资料：{latestProfile.name} · {latestProfile.access_key_id} ·{" "}
              {latestProfile.enabled ? "已启用" : "已停用"}
            </p>
            <p className="whitespace-pre-wrap break-all">
              {latestProfile.description || "无说明"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLatestProfile(null);
                submission.setError(null);
                errors.clear();
              }}
            >
              已核对，保留草稿继续编辑
            </Button>
          </Notice>
        )}
        {!authOnly && (
          <>
            <Field label="配置名称" required error={errors.fields.name}>
              <Input
                name="name"
                maxLength={100}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="编码（可选）">
              <Input
                className="mono"
                readOnly={Boolean(profile)}
                name="code"
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="说明">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
          </>
        )}
        {(!profile || authOnly) && (
          <>
            <Field
              label="AccessKey ID"
              required
              error={errors.fields.access_key_id}
            >
              <Input
                name="access_key_id"
                autoComplete="off"
                value={form.access_key_id}
                onChange={(event) =>
                  setForm({ ...form, access_key_id: event.target.value })
                }
              />
            </Field>
            <Field
              label="AccessKey Secret"
              required={!profile || authOnly}
              error={errors.fields.access_key_secret}
            >
              <Input
                name="access_key_secret"
                type="password"
                autoComplete="off"
                value={form.access_key_secret}
                onChange={(event) =>
                  setForm({ ...form, access_key_secret: event.target.value })
                }
              />
            </Field>
          </>
        )}
      </form>
    </Drawer>
  );
}

function TemplateList() {
  const profiles = useSmsOptions<SmsProfile>("profiles");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 20;
  const query = useApiQuery<Page<SmsTemplate>>(
    ["sms-templates", q, status, page, size],
    `${base}/templates?${new URLSearchParams({ q, status, page: String(page), page_size: String(size) })}`,
  );
  return (
    <Panel bodyClassName="p-0">
      <TableToolbar
        onReset={() =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.delete("q");
            next.delete("status");
            next.set("page", "1");
            return next;
          })
        }
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button
            render={
              <Link to={`${base}/templates/new`}>
                <Plus />
                创建模板
              </Link>
            }
            nativeButton={false}
            role="link"
            className="flex items-center gap-2"
          />
        }
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set(
                "q",
                String(new FormData(event.currentTarget).get("q") ?? ""),
              );
              next.set("page", "1");
              return next;
            });
          }}
        >
          <StandaloneInput
            name="q"
            aria-label="搜索短信模板"
            defaultValue={q}
            placeholder="搜索名称或编码"
          />
        </form>
        <StandaloneSelect
          aria-label="短信模板状态"
          value={status}
          onValueChange={(value) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("status", value);
              next.set("page", "1");
              return next;
            })
          }
        >
          <option value="">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </StandaloneSelect>
      </TableToolbar>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={!query.data?.data.items.length}
        emptyTitle={q || status ? "没有符合条件的短信模板" : "还没有短信模板"}
      >
        {query.data && (
          <SimpleTable
            actions
            label="短信模板"
            headers={["模板", "模式", "配置与模板", "状态", "更新时间", "操作"]}
          >
            {query.data.data.items.map((template) => (
              <tr key={template.id}>
                <td>
                  <Link
                    className="break-all font-medium text-foreground hover:text-primary"
                    to={`${base}/templates/${template.id}`}
                  >
                    {template.name}
                  </Link>
                  <small className="mono block break-all text-muted">
                    {template.code}
                  </small>
                </td>
                <td>{template.mode === "remote" ? "远端模板" : "本地模拟"}</td>
                <td className="max-w-80 break-all">
                  <span className="block">
                    {template.mode === "remote"
                      ? (profiles.data?.find(
                          (p) => p.id === template.profile_id,
                        )?.name ?? `配置 ${template.profile_id}`)
                      : "Go 模板 · 仅本地模拟"}
                  </span>
                  <small className="text-muted">
                    {template.mode === "remote"
                      ? `签名：${template.sign_name} · `
                      : ""}
                  </small>
                  {template.mode === "remote"
                    ? template.remote_template_id
                    : `${template.engine_id} · v${template.engine_version}`}
                </td>
                <td>
                  <StatusBadge tone={template.enabled ? "success" : "neutral"}>
                    {template.enabled ? "已启用" : "已停用"}
                  </StatusBadge>
                </td>
                <td className="text-xs text-muted">
                  {formatDate(template.updated_at)}
                </td>
                <td>
                  <Link
                    className="link"
                    to={`${base}/templates/${template.id}`}
                  >
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </AsyncBoundary>
      {query.data && (
        <Pagination
          page={page}
          size={size}
          total={query.data.data.total}
          onChange={(nextPage, nextSize) => {
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("page", String(nextPage));
              next.set("page_size", String(nextSize));
              return next;
            });
          }}
        />
      )}
    </Panel>
  );
}

function SmsLogList() {
  const profiles = useSmsOptions<SmsProfile>("profiles");
  const templates = useSmsOptions<SmsTemplate>("templates");
  return (
    <>
      <ErrorNotice error={profiles.error ?? templates.error} />
      <MessageLogList
        module="sms"
        profileOptions={profiles.data}
        templateOptions={templates.data}
      />
    </>
  );
}
