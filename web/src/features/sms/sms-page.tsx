import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FlaskConical,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { request } from "@/api/client";
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
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatDate } from "@/lib/utils";
import {
  messageReasons,
  messageStatusLabels,
  type MessageLog,
  type SmsProfile,
  type SmsTemplate,
} from "@/types/messages";
import { MessageLogDetail, MessageLogList } from "../messages/log-list";

const base = "/admin/sms";
const sections = [
  { value: "profiles", label: "供应商配置" },
  { value: "templates", label: "短信模板" },
  { value: "send-logs", label: "发送日志" },
];
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export function SmsPage() {
  const { section = "profiles", id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  if (!sections.some((item) => item.value === section))
    return <Notice tone="danger">页面不存在。</Notice>;
  return (
    <div className="page">
      <PageHeader
        title="短信管理"
        description="独立维护阿里云配置、模板参数映射、本地模拟、真实测试和日志。"
        actions={
          <Button
            variant="outline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("test", "1");
              window.history.pushState(
                null,
                "",
                `${location.pathname}?${next}`,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            <Send />
            发送测试
          </Button>
        }
      />
      {!id && (
        <Tabs
          label="短信功能"
          value={section}
          onChange={(value) => navigate(`${base}/${value}`)}
          items={sections}
        />
      )}
      <div className="mt-5">
        <OverlayPresence>
          {section === "send-logs" &&
            (id ? (
              <MessageLogDetail
                module="sms"
                id={id}
                onClose={() => navigate(`${base}/send-logs`)}
              />
            ) : (
              <MessageLogList module="sms" />
            ))}
        </OverlayPresence>
        {section === "profiles" &&
          (id ? <ProfileDetail id={id} /> : <ProfileList />)}
        {section === "templates" &&
          (id ? <TemplateEditor id={id} /> : <TemplateList />)}
      </div>
      <OverlayPresence>
        {params.get("test") === "1" && (
          <SmsTest
            onClose={() => {
              const next = new URLSearchParams(params);
              next.delete("test");
              window.history.replaceState(
                null,
                "",
                `${location.pathname}?${next}`,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          />
        )}
      </OverlayPresence>
    </div>
  );
}

function ProfileList() {
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
          emptyTitle="还没有短信配置"
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
                      className="font-medium text-foreground hover:text-primary"
                      to={`${base}/profiles/${profile.id}`}
                    >
                      {profile.name}
                    </Link>
                    <small className="mono block text-muted">
                      {profile.code}
                    </small>
                  </td>
                  <td>阿里云</td>
                  <td>{profile.access_key_id}</td>
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
              window.history.pushState(
                null,
                "",
                `${location.pathname}?page=${nextPage}&page_size=${nextSize}`,
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
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
              window.location.assign(`${base}/profiles/${id}`);
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
    <section>
      <PageHeader
        title={profile.name}
        description={profile.code}
        actions={
          <>
            <Button variant="outline" onClick={() => setMode("edit")}>
              <Pencil />
              编辑配置
            </Button>
            <Button variant="dangerSoft" onClick={() => setRemove(true)}>
              <Trash2 />
              删除配置
            </Button>
          </>
        }
      />
      <Panel title="阿里云短信配置">
        <DescriptionList
          items={[
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
        <div className="mt-5 flex gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => setMode("auth")}>
            替换 AccessKey
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void submission.run(async () => {
                await request(`${base}/profiles/${id}`, {
                  method: "PATCH",
                  etag: query.data.etag,
                  body: { enabled: !profile.enabled },
                });
                await query.refetch();
              })
            }
          >
            {profile.enabled ? "停用配置" : "启用配置"}
          </Button>
        </div>
        <ErrorNotice error={submission.error} />
      </Panel>
      <Panel title="最近真实发送">
        {profile.latest ? (
          <LogSummary log={profile.latest} />
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
  const markSaved = useUnsaved(true, submission.pending);
  async function save() {
    if (
      !form.name.trim() ||
      !form.access_key_id.trim() ||
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
                  etag,
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
                  etag: profile ? etag : undefined,
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
      dirty
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
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
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {!authOnly && (
          <>
            <Field label="配置名称" required error={errors.fields.name}>
              <Input
                name="name"
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
        <Field
          label="AccessKey ID"
          required
          error={errors.fields.access_key_id}
        >
          <Input
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
            type="password"
            autoComplete="off"
            value={form.access_key_secret}
            onChange={(event) =>
              setForm({ ...form, access_key_secret: event.target.value })
            }
          />
        </Field>
      </form>
    </Drawer>
  );
}

function TemplateList() {
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
          <Button asChild className="flex items-center gap-2">
            <Link to={`${base}/templates/new`}>
              <Plus />
              创建模板
            </Link>
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
        emptyTitle="还没有短信模板"
      >
        {query.data && (
          <SimpleTable
            actions
            label="短信模板"
            headers={[
              "模板",
              "模式",
              "远端模板 / 引擎",
              "状态",
              "更新时间",
              "操作",
            ]}
          >
            {query.data.data.items.map((template) => (
              <tr key={template.id}>
                <td>
                  <Link
                    className="font-medium text-foreground hover:text-primary"
                    to={`${base}/templates/${template.id}`}
                  >
                    {template.name}
                  </Link>
                  <small className="mono block text-muted">
                    {template.code}
                  </small>
                </td>
                <td>{template.mode === "remote" ? "远端模板" : "本地模拟"}</td>
                <td>
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
          size={20}
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

function TemplateEditor({ id }: { id: string }) {
  const create = id === "new";
  const query = useApiQuery<SmsTemplate>(
    ["sms-template", id],
    `${base}/templates/${id}`,
    { enabled: !create },
  );
  const profiles = useApiQuery<Page<SmsProfile>>(
    ["sms-profiles", "template"],
    `${base}/profiles?page=1&page_size=100`,
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!create && query.isPending) return <AsyncBoundary loading />;
  if (query.error)
    return (
      <AsyncBoundary error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <TemplateForm
      key={query.data?.data.version ?? "new"}
      create={create}
      initial={query.data?.data}
      profiles={profiles.data?.data.items ?? []}
      etag={query.data?.etag ?? ""}
      onCancel={() => navigate(`${base}/templates`)}
      onSaved={async (saved) => {
        await queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
        if (create) navigate(`${base}/templates/${saved.id}`);
        else await query.refetch();
      }}
    />
  );
}

function TemplateForm({
  create,
  initial,
  profiles,
  etag,
  onSaved,
  onCancel,
}: {
  create: boolean;
  initial?: SmsTemplate;
  profiles: SmsProfile[];
  etag: string;
  onSaved: (template: SmsTemplate) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SmsTemplate>(
    initial ?? {
      id: "0",
      code: "",
      name: "",
      description: "",
      enabled: true,
      version: "",
      mode: "remote",
      profile_id: "",
      sign_name: "",
      remote_template_id: "",
      provider_parameters: {},
      engine_id: "",
      engine_version: 0,
      body_template: "",
      parameter_schema: {},
      sample_data: {},
      created_at: "",
      updated_at: "",
    },
  );
  const [schema, setSchema] = useState(
    JSON.stringify(form.parameter_schema, null, 2),
  );
  const [sample, setSample] = useState(
    JSON.stringify(form.sample_data, null, 2),
  );
  const [mapping, setMapping] = useState(
    JSON.stringify(form.provider_parameters, null, 2),
  );
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [simulate, setSimulate] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const markSaved = useUnsaved(true, submission.pending);
  function update<K extends keyof SmsTemplate>(key: K, value: SmsTemplate[K]) {
    setForm({ ...form, [key]: value });
    setPreview(null);
  }
  function draft(): SmsTemplate {
    return {
      ...form,
      profile_id: form.mode === "local" ? "0" : form.profile_id,
      engine_id: form.mode === "local" ? "go_template" : "",
      engine_version: form.mode === "local" ? 1 : 0,
      body_template: form.mode === "remote" ? "" : form.body_template,
      sign_name: form.mode === "local" ? "" : form.sign_name,
      remote_template_id: form.mode === "local" ? "" : form.remote_template_id,
      parameter_schema: parseObject(schema) as SmsTemplate["parameter_schema"],
      sample_data: parseObject(sample),
      provider_parameters:
        form.mode === "remote"
          ? Object.fromEntries(
              Object.entries(parseObject(mapping)).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {},
    };
  }
  async function showPreview() {
    await submission.run(
      async () => {
        const response = await request<Record<string, unknown>>(
          `${base}/templates/preview`,
          { method: "POST", body: { draft: draft() } },
        );
        setPreview(response.data);
      },
      (error) =>
        errors.show(error, [
          "parameter_schema",
          "sample_data",
          "provider_parameters",
          "body_template",
        ]),
    );
  }
  async function save() {
    if (
      !form.name.trim() ||
      !form.code.trim() ||
      (form.mode === "remote" &&
        (!form.profile_id || !form.sign_name || !form.remote_template_id))
    ) {
      errors.setError("请填写名称、编码及当前模式的必填字段。");
      return;
    }
    await submission.run(
      async () => {
        const response = await request<SmsTemplate>(
          create ? `${base}/templates` : `${base}/templates/${form.id}`,
          {
            method: create ? "POST" : "PATCH",
            etag: create ? undefined : etag,
            body: draft(),
          },
        );
        markSaved();
        await onSaved(response.data);
      },
      (error) =>
        errors.show(error, [
          "name",
          "code",
          "parameter_schema",
          "sample_data",
          "provider_parameters",
          "body_template",
        ]),
    );
  }
  return (
    <div>
      <PageHeader
        title={create ? "创建短信模板" : form.name}
        description="远端参数映射与本地模拟使用不同流程"
        actions={
          <>
            <Button variant="outline" onClick={onCancel}>
              <ArrowLeft />
              返回列表
            </Button>
            {!create && form.mode === "local" && form.enabled && (
              <Button variant="outline" onClick={() => setSimulate(true)}>
                <FlaskConical />
                模拟渲染
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={errors.error} />
      <ErrorNotice error={submission.error} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="模板配置">
          <div className="form-grid">
            <Field label="模板名称" required>
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field label="编码" required>
              <Input
                className="mono"
                readOnly={!create}
                value={form.code}
                onChange={(event) => update("code", event.target.value)}
              />
            </Field>
            <Field label="模板模式">
              <Select
                disabled={!create}
                value={form.mode}
                onValueChange={(value) =>
                  update("mode", value as "remote" | "local")
                }
              >
                <option value="remote">远端模板</option>
                <option value="local">本地正文模拟</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
              />
              启用
            </label>
            <Field label="说明" className="form-full">
              <Textarea
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
            {form.mode === "remote" ? (
              <>
                <Field label="短信配置" required className="form-full">
                  <Select
                    disabled={!create}
                    value={form.profile_id}
                    onValueChange={(value) => update("profile_id", value)}
                  >
                    <option value="">请选择</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="签名" required>
                  <Input
                    value={form.sign_name}
                    onChange={(event) =>
                      update("sign_name", event.target.value)
                    }
                  />
                </Field>
                <Field label="远端模板 ID" required>
                  <Input
                    className="mono"
                    value={form.remote_template_id}
                    onChange={(event) =>
                      update("remote_template_id", event.target.value)
                    }
                  />
                </Field>
                <Field label="供应商参数映射（JSON）" className="form-full">
                  <Textarea
                    className="font-mono"
                    value={mapping}
                    onChange={(event) => setMapping(event.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field label="本地正文（Go 模板）" required className="form-full">
                <Textarea
                  className="min-h-48 font-mono"
                  value={form.body_template}
                  onChange={(event) =>
                    update("body_template", event.target.value)
                  }
                />
              </Field>
            )}
            <Field label="抽象参数 Schema（JSON）" className="form-full">
              <Textarea
                className="min-h-40 font-mono"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
              />
            </Field>
            <Field label="样例数据（JSON）" className="form-full">
              <Textarea
                className="min-h-40 font-mono"
                value={sample}
                onChange={(event) => setSample(event.target.value)}
              />
            </Field>
          </div>
          <div className="form-actions">
            <Button
              variant="outline"
              pending={submission.pending}
              onClick={() => void showPreview()}
            >
              {form.mode === "remote" ? "预览参数映射" : "渲染草稿预览"}
            </Button>
            <Button pending={submission.pending} onClick={() => void save()}>
              {create ? "创建模板" : "保存模板"}
            </Button>
            {!create && (
              <Button
                variant="dangerSoft"
                onClick={() =>
                  void submission.run(async () => {
                    await request(`${base}/templates/${form.id}`, {
                      method: "DELETE",
                      etag,
                    });
                    onCancel();
                  })
                }
              >
                删除模板
              </Button>
            )}
          </div>
        </Panel>
        <Panel title="预览结果">
          {preview ? (
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-surface-subtle p-4 text-sm">
              {JSON.stringify(preview, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted">
              预览不发送短信、不产生真实发送日志。
            </p>
          )}
        </Panel>
      </div>
      {simulate && (
        <Simulation
          template={form}
          etag={etag}
          onClose={() => setSimulate(false)}
        />
      )}
    </div>
  );
}

function Simulation({
  template,
  etag,
  onClose,
}: {
  template: SmsTemplate;
  etag: string;
  onClose: () => void;
}) {
  const [parameters, setParameters] = useState(
    JSON.stringify(template.sample_data, null, 2),
  );
  const [body, setBody] = useState("");
  const submission = useSubmission();
  return (
    <Modal
      open
      title="本地模板模拟"
      description="仅模拟，未发送；不会访问供应商或产生费用"
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                const response = await request<{ body: string }>(
                  `${base}/templates/${template.id}/simulate`,
                  {
                    method: "POST",
                    etag,
                    body: { parameters: parseObject(parameters) },
                  },
                );
                setBody(response.data.body);
              })
            }
          >
            <FlaskConical />
            执行模拟
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      <Field label="当次参数（JSON）">
        <Textarea
          className="font-mono"
          value={parameters}
          onChange={(event) => setParameters(event.target.value)}
        />
      </Field>
      {body && (
        <Notice tone="success" title="仅模拟、未发送">
          <pre className="whitespace-pre-wrap">{body}</pre>
        </Notice>
      )}
    </Modal>
  );
}

function SmsTest({ onClose }: { onClose: () => void }) {
  const profiles = useApiQuery<Page<SmsProfile>>(
    ["sms-profiles", "test"],
    `${base}/profiles?page=1&page_size=100&status=enabled`,
  );
  const templates = useApiQuery<Page<SmsTemplate>>(
    ["sms-templates", "test"],
    `${base}/templates?page=1&page_size=100&status=enabled`,
  );
  const [profileId, setProfileId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [result, setResult] = useState<MessageLog | null>(null);
  const errors = useFormErrors();
  const submission = useSubmission();
  const profile = profiles.data?.data.items.find(
    (item) => item.id === profileId,
  );
  const template = templates.data?.data.items.find(
    (item) => item.id === templateId && item.mode === "remote",
  );
  async function send() {
    if (!profile || !template || !/^1\d{10}$/.test(recipient)) {
      errors.validate({
        profile_id: !profile ? "请选择配置" : "",
        template_id: !template ? "请选择属于配置的远端模板" : "",
        recipient: !/^1\d{10}$/.test(recipient)
          ? "请输入中国大陆 11 位手机号"
          : "",
      });
      return;
    }
    await submission.run(
      async () => {
        const response = await request<MessageLog>(
          `${base}/profiles/${profile.id}/test`,
          {
            method: "POST",
            etag: `"${profile.version}"`,
            body: {
              recipient,
              template: {
                id: template.id,
                version: template.version,
                parameters: parseObject(parameters),
              },
            },
          },
        );
        setResult(response.data);
      },
      (error) => errors.show(error, ["recipient", "parameters"]),
    );
  }
  return (
    <Drawer
      open
      title="发送真实短信测试"
      description="将请求阿里云并可能计费；受理不代表送达"
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button pending={submission.pending} onClick={() => void send()}>
            <Send />
            确认真实发送
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {result && <LogSummary log={result} />}
        <Field label="短信配置" required error={errors.fields.profile_id}>
          <Select
            value={profileId}
            onValueChange={(value) => {
              setProfileId(value);
              setTemplateId("");
            }}
          >
            <option value="">请选择</option>
            {profiles.data?.data.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="远端模板" required error={errors.fields.template_id}>
          <Select
            value={templateId}
            onValueChange={(value) => {
              const next = templates.data?.data.items.find(
                (item) => item.id === value,
              );
              setTemplateId(value);
              setParameters(JSON.stringify(next?.sample_data ?? {}, null, 2));
            }}
          >
            <option value="">请选择</option>
            {templates.data?.data.items
              .filter(
                (item) =>
                  item.mode === "remote" && item.profile_id === profileId,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.remote_template_id}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="接收手机号" required error={errors.fields.recipient}>
          <Input
            inputMode="numeric"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </Field>
        <Field label="抽象参数（JSON）" error={errors.fields.parameters}>
          <Textarea
            className="font-mono"
            value={parameters}
            onChange={(event) => setParameters(event.target.value)}
          />
        </Field>
      </form>
    </Drawer>
  );
}

function LogSummary({ log }: { log: MessageLog }) {
  return (
    <Notice
      tone={
        log.status === "accepted"
          ? "success"
          : log.status === "unknown"
            ? "warning"
            : "danger"
      }
    >
      {log.outdated ? "历史结果 · " : ""}
      {messageStatusLabels[log.status] ?? log.status} ·{" "}
      {messageReasons[log.reason_code] ?? log.reason_code}
      <small className="mt-1 block">
        {log.test_id} · {formatDate(log.started_at)}
      </small>
    </Notice>
  );
}
function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("请输入 JSON 对象");
  return parsed as Record<string, unknown>;
}
