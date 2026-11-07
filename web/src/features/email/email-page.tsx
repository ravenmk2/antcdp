import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Send, Trash2 } from "lucide-react";
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
  NumberInput,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatDate } from "@/lib/utils";
import {
  messageReasons,
  messageStatusLabels,
  type EmailProfile,
  type EmailTemplate,
  type MessageLog,
} from "@/types/messages";
import { MessageLogDetail, MessageLogList } from "../messages/log-list";

const base = "/admin/email";
const sections = [
  { value: "profiles", label: "SMTP 配置" },
  { value: "templates", label: "邮件模板" },
  { value: "send-logs", label: "发送日志" },
];
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export function EmailPage() {
  const { section = "profiles", id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  if (!sections.some((item) => item.value === section))
    return <Notice tone="danger">页面不存在。</Notice>;
  return (
    <div className="page">
      <PageHeader
        title="邮件管理"
        description="独立维护 SMTP、发件名称、模板、隔离预览与真实发送测试。"
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
          label="邮件功能"
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
                module="email"
                id={id}
                onClose={() => navigate(`${base}/send-logs`)}
              />
            ) : (
              <MessageLogList module="email" />
            ))}
        </OverlayPresence>
        {section === "profiles" &&
          (id ? <EmailProfileDetail id={id} /> : <ProfileList />)}
        {section === "templates" &&
          (id ? <EmailTemplateEditor id={id} /> : <TemplateList />)}
      </div>
      <OverlayPresence>
        {params.get("test") === "1" && (
          <EmailTest
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
  const query = useApiQuery<Page<EmailProfile>>(
    ["email-profiles", q, status, page, size],
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
              新增 SMTP
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
              aria-label="搜索 SMTP 配置"
              defaultValue={q}
              placeholder="搜索名称或编码"
            />
          </form>
          <StandaloneSelect
            aria-label="SMTP 状态"
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
          emptyTitle="还没有 SMTP 配置"
        >
          {query.data && (
            <SimpleTable
              actions
              label="SMTP 配置"
              headers={[
                "配置",
                "服务器",
                "发件地址",
                "状态",
                "最近测试",
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
                  <td className="mono">
                    {profile.config.host}:{profile.config.port}
                    <small className="block text-muted">
                      {profile.config.tls_mode}
                    </small>
                  </td>
                  <td>{profile.config.from_address}</td>
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
              const next = new URLSearchParams({
                page: String(nextPage),
                page_size: String(nextSize),
              });
              window.history.pushState(
                null,
                "",
                `${location.pathname}?${next}`,
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
                queryKey: ["email-profiles"],
              });
              window.location.assign(`${base}/profiles/${id}`);
            }}
          />
        )}
      </OverlayPresence>
    </>
  );
}

function EmailProfileDetail({ id }: { id: string }) {
  const query = useApiQuery<EmailProfile>(
    ["email-profile", id],
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
      <div className="grid gap-5">
        <Panel title="SMTP 与发件身份">
          <DescriptionList
            items={[
              {
                label: "服务器",
                value: `${profile.config.host}:${profile.config.port}`,
              },
              {
                label: "安全模式",
                value:
                  profile.config.tls_mode === "implicit_tls"
                    ? "TLS 直连"
                    : "STARTTLS",
              },
              { label: "发件地址", value: profile.config.from_address },
              { label: "认证账号", value: profile.username },
              {
                label: "公共 CA",
                value: profile.config.custom_ca_pem ? "已配置" : "使用系统信任",
              },
              { label: "状态", value: profile.enabled ? "已启用" : "已停用" },
            ]}
          />
          <div className="mt-5 flex gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setMode("auth")}>
              替换认证
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
        <Panel title="发件名称">
          <ul className="divide-y">
            {profile.sender_names.map((sender) => (
              <li key={sender.id} className="flex justify-between py-2 text-sm">
                <span>{sender.name}</span>
                {sender.default && <StatusBadge tone="info">默认</StatusBadge>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="最近发送测试">
          {profile.latest ? (
            <LogSummary log={profile.latest} />
          ) : (
            <p className="text-sm text-muted">尚无发送测试。</p>
          )}
        </Panel>
      </div>
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
                queryKey: ["email-profile", id],
              });
            }}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={remove}
        danger
        title="删除 SMTP 配置"
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
          模板保持独立；既有发送日志保留至到期。
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
  profile?: EmailProfile;
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
    host: profile?.config.host ?? "",
    port: String(profile?.config.port ?? 465),
    tls_mode: profile?.config.tls_mode ?? "implicit_tls",
    from_address: profile?.config.from_address ?? "",
    custom_ca_pem: profile?.config.custom_ca_pem ?? "",
    username: profile?.username ?? "",
    password: "",
  });
  const [senders, setSenders] = useState(
    profile?.sender_names ?? [{ id: "", name: "AntCDP 通知", default: true }],
  );
  const errors = useFormErrors();
  const submission = useSubmission();
  const markSaved = useUnsaved(true, submission.pending);
  async function save() {
    const fields: Record<string, string> = {};
    if (!form.name.trim()) fields.name = "请输入配置名称";
    if (!authOnly && !form.host.trim()) fields.host = "请输入 SMTP 主机";
    if (!authOnly && !form.from_address.includes("@"))
      fields.from_address = "请输入有效发件地址";
    if (
      !form.username.trim() ||
      (!profile && !form.password) ||
      (authOnly && !form.password)
    )
      fields.password = "请完整填写认证账号与密码";
    if (
      !authOnly &&
      (!senders.length ||
        senders.filter((sender) => sender.default).length !== 1 ||
        senders.some((sender) => !sender.name.trim()))
    )
      fields.sender_names = "至少一个发件名称，且恰好一个默认项";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        const response =
          authOnly && profile
            ? await request<EmailProfile>(
                `${base}/profiles/${profile.id}/authentication`,
                {
                  method: "PUT",
                  etag,
                  body: { username: form.username, password: form.password },
                },
              )
            : await request<EmailProfile>(
                profile ? `${base}/profiles/${profile.id}` : `${base}/profiles`,
                {
                  method: profile ? "PATCH" : "POST",
                  etag: profile ? etag : undefined,
                  body: {
                    ...(profile ? {} : { code: form.code.trim() }),
                    name: form.name.trim(),
                    description: form.description,
                    enabled: form.enabled,
                    config: {
                      host: form.host,
                      port: Number(form.port),
                      tls_mode: form.tls_mode,
                      from_address: form.from_address,
                      custom_ca_pem: form.custom_ca_pem,
                    },
                    sender_names: senders,
                    ...(profile
                      ? {}
                      : {
                          authentication: {
                            username: form.username,
                            password: form.password,
                          },
                        }),
                  },
                },
              );
        markSaved();
        await onSaved(response.data.id);
      },
      (error) =>
        errors.show(
          error,
          [
            "name",
            "code",
            "host",
            "port",
            "from_address",
            "username",
            "password",
            "sender_names",
          ],
          {
            "config.host": "host",
            "config.port": "port",
            "config.from_address": "from_address",
          },
        ),
    );
  }
  return (
    <Drawer
      open
      wide
      title={
        authOnly
          ? "替换 SMTP 认证"
          : profile
            ? "编辑 SMTP 配置"
            : "新增 SMTP 配置"
      }
      description="TLS 不回退；密码保存后不可读取"
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
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {!authOnly && (
          <>
            <div className="form-grid">
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
              <Field label="SMTP 主机" required error={errors.fields.host}>
                <Input
                  name="host"
                  value={form.host}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                />
              </Field>
              <Field label="端口" required>
                <NumberInput
                  name="port"
                  label="端口"
                  min={1}
                  max={65535}
                  value={form.port}
                  disabled={submission.pending}
                  onValueChange={(value) => {
                    setForm({ ...form, port: value });
                  }}
                />
              </Field>
              <Field label="安全模式">
                <Select
                  value={form.tls_mode}
                  onValueChange={(value) =>
                    setForm({ ...form, tls_mode: value })
                  }
                >
                  <option value="implicit_tls">TLS 直连</option>
                  <option value="starttls">STARTTLS</option>
                </Select>
              </Field>
              <Field
                label="发件地址"
                required
                error={errors.fields.from_address}
              >
                <Input
                  name="from_address"
                  type="email"
                  value={form.from_address}
                  onChange={(event) =>
                    setForm({ ...form, from_address: event.target.value })
                  }
                />
              </Field>
              <Field label="公共 CA（可选）" className="form-full">
                <Textarea
                  value={form.custom_ca_pem}
                  onChange={(event) =>
                    setForm({ ...form, custom_ca_pem: event.target.value })
                  }
                />
              </Field>
              <Field label="说明" className="form-full">
                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </Field>
            </div>
            <section>
              <h3 className="mb-2 text-sm font-medium">发件名称</h3>
              {senders.map((sender, index) => (
                <div
                  key={sender.id || index}
                  className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2"
                >
                  <Input
                    aria-label={`发件名称 ${index + 1}`}
                    value={sender.name}
                    onChange={(event) =>
                      setSenders(
                        senders.map((item, position) =>
                          position === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name="default-sender"
                      checked={sender.default}
                      onChange={() =>
                        setSenders(
                          senders.map((item, position) => ({
                            ...item,
                            default: position === index,
                          })),
                        )
                      }
                    />
                    默认
                  </label>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="删除发件名称"
                    disabled={senders.length <= 1}
                    onClick={() =>
                      setSenders(
                        senders.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSenders([...senders, { id: "", name: "", default: false }])
                }
              >
                <Plus />
                添加名称
              </Button>
              {errors.fields.sender_names && (
                <p className="mt-2 text-xs text-danger">
                  {errors.fields.sender_names}
                </p>
              )}
            </section>
          </>
        )}
        <div className="form-grid">
          <Field label="认证用户名" required>
            <Input
              autoComplete="off"
              value={form.username}
              onChange={(event) =>
                setForm({ ...form, username: event.target.value })
              }
            />
          </Field>
          <Field
            label="密码 / 授权码"
            required={!profile || authOnly}
            error={errors.fields.password}
          >
            <Input
              type="password"
              autoComplete="off"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </Field>
        </div>
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
  const query = useApiQuery<Page<EmailTemplate>>(
    ["email-templates", q, status, page, size],
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
            aria-label="搜索邮件模板"
            defaultValue={q}
            placeholder="搜索名称或编码"
          />
        </form>
        <StandaloneSelect
          aria-label="邮件模板状态"
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
        emptyTitle="还没有邮件模板"
      >
        {query.data && (
          <SimpleTable
            actions
            label="邮件模板"
            headers={["模板", "格式", "引擎", "状态", "更新时间", "操作"]}
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
                <td>{template.body_format === "html" ? "HTML" : "纯文本"}</td>
                <td>
                  {template.engine_id} · v{template.engine_version}
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

function EmailTemplateEditor({ id }: { id: string }) {
  const create = id === "new";
  const query = useApiQuery<EmailTemplate>(
    ["email-template", id],
    `${base}/templates/${id}`,
    { enabled: !create },
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = useState<EmailTemplate | null>(null);
  const current = form ?? query.data?.data;
  if (!create && query.isPending) return <AsyncBoundary loading />;
  if (query.error)
    return (
      <AsyncBoundary error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <TemplateForm
      key={current?.version ?? "new"}
      create={create}
      initial={current}
      etag={query.data?.etag ?? ""}
      onSaved={async (saved) => {
        await queryClient.invalidateQueries({ queryKey: ["email-templates"] });
        if (create) navigate(`${base}/templates/${saved.id}`);
        else await query.refetch();
      }}
      onCancel={() => navigate(`${base}/templates`)}
    />
  );
}

function TemplateForm({
  create,
  initial,
  etag,
  onSaved,
  onCancel,
}: {
  create: boolean;
  initial?: EmailTemplate;
  etag: string;
  onSaved: (template: EmailTemplate) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EmailTemplate>(
    initial ?? {
      id: "0",
      code: "",
      name: "",
      description: "",
      enabled: true,
      version: "",
      engine_id: "go_template",
      engine_version: 1,
      subject_template: "",
      body_format: "html",
      body_template: "",
      text_body_template: "",
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
  const [preview, setPreview] = useState<{
    subject: string;
    body_format: string;
    body: string;
    text_body?: string;
  } | null>(null);
  const errors = useFormErrors();
  const submission = useSubmission();
  const markSaved = useUnsaved(true, submission.pending);
  function update<K extends keyof EmailTemplate>(
    key: K,
    value: EmailTemplate[K],
  ) {
    setForm({ ...form, [key]: value });
  }
  function draft() {
    return {
      ...form,
      parameter_schema: parseObject(schema),
      sample_data: parseObject(sample),
    };
  }
  async function showPreview() {
    await submission.run(
      async () => {
        const response = await request<{
          subject: string;
          body_format: string;
          body: string;
          text_body?: string;
        }>(`${base}/templates/preview`, {
          method: "POST",
          body: { draft: draft() },
        });
        setPreview(response.data);
      },
      (error) =>
        errors.show(error, [
          "parameter_schema",
          "sample_data",
          "body_template",
          "subject_template",
        ]),
    );
  }
  async function save() {
    if (!form.name.trim() || !form.subject_template) {
      errors.validate({
        name: !form.name.trim() ? "请输入模板名称" : "",
        subject_template: !form.subject_template ? "请输入主题" : "",
      });
      return;
    }
    await submission.run(
      async () => {
        const response = await request<EmailTemplate>(
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
          "body_template",
          "subject_template",
        ]),
    );
  }
  return (
    <div>
      <PageHeader
        title={create ? "创建邮件模板" : form.name}
        description="Go 模板源码、参数 Schema、样例数据与隔离预览"
        actions={
          <Button variant="outline" onClick={onCancel}>
            <ArrowLeft />
            返回模板列表
          </Button>
        }
      />
      <ErrorNotice error={errors.error} />
      <ErrorNotice error={submission.error} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="模板源码">
          <div className="form-grid">
            <Field label="模板名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field label="编码（可选）">
              <Input
                className="mono"
                readOnly={!create}
                value={form.code}
                onChange={(event) => update("code", event.target.value)}
              />
            </Field>
            <Field label="说明" className="form-full">
              <Textarea
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
            <Field
              label="主题模板"
              required
              className="form-full"
              error={errors.fields.subject_template}
            >
              <Input
                name="subject_template"
                value={form.subject_template}
                onChange={(event) =>
                  update("subject_template", event.target.value)
                }
              />
            </Field>
            <Field label="正文格式">
              <Select
                value={form.body_format}
                onValueChange={(value) => update("body_format", value)}
              >
                <option value="html">HTML</option>
                <option value="text">纯文本</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
              />
              启用模板
            </label>
            <Field
              label="正文模板"
              required
              className="form-full"
              error={errors.fields.body_template}
            >
              <Textarea
                className="min-h-56 font-mono"
                value={form.body_template}
                onChange={(event) =>
                  update("body_template", event.target.value)
                }
              />
            </Field>
            <Field label="备用纯文本正文" className="form-full">
              <Textarea
                className="font-mono"
                value={form.text_body_template}
                onChange={(event) =>
                  update("text_body_template", event.target.value)
                }
              />
            </Field>
            <Field
              label="参数 Schema（JSON）"
              className="form-full"
              error={errors.fields.parameter_schema}
            >
              <Textarea
                className="min-h-40 font-mono"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
              />
            </Field>
            <Field
              label="样例数据（JSON）"
              className="form-full"
              error={errors.fields.sample_data}
            >
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
              渲染草稿预览
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
        <Panel title="隔离预览">
          {preview ? (
            <>
              <h3 className="mb-3 text-sm font-medium">{preview.subject}</h3>
              {preview.body_format === "html" ? (
                <iframe
                  title="邮件 HTML 隔离预览"
                  sandbox=""
                  className="h-96 w-full rounded-lg border bg-white"
                  srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body>${preview.body}</body>`}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm">
                  {preview.body}
                </pre>
              )}
              {preview.text_body && (
                <details className="mt-3">
                  <summary>备用纯文本</summary>
                  <pre className="whitespace-pre-wrap text-sm">
                    {preview.text_body}
                  </pre>
                </details>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              预览不访问 SMTP、不保存发送日志。HTML 在严格 sandbox 与 CSP
              下展示。
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function EmailTest({ onClose }: { onClose: () => void }) {
  const profiles = useApiQuery<Page<EmailProfile>>(
    ["email-profiles", "test"],
    `${base}/profiles?page=1&page_size=100&status=enabled`,
  );
  const templates = useApiQuery<Page<EmailTemplate>>(
    ["email-templates", "test"],
    `${base}/templates?page=1&page_size=100&status=enabled`,
  );
  const [profileId, setProfileId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sender, setSender] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [content, setContent] = useState({
    subject: "",
    body_format: "text",
    body: "",
    text_body: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<MessageLog | null>(null);
  const errors = useFormErrors();
  const submission = useSubmission();
  const profile = profiles.data?.data.items.find(
    (item) => item.id === profileId,
  );
  const template = templates.data?.data.items.find(
    (item) => item.id === templateId,
  );
  async function send() {
    if (!profile || !recipient) {
      errors.validate({
        profile_id: !profile ? "请选择 SMTP 配置" : "",
        recipient: !recipient ? "请输入收件地址" : "",
      });
      return;
    }
    if (
      files.length > 5 ||
      files.some((file) => file.size > 5 * 1024 * 1024) ||
      files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024
    ) {
      errors.validate({
        attachments: "附件最多 5 个，单个不超过 5 MiB，合计不超过 10 MiB",
      });
      return;
    }
    await submission.run(
      async () => {
        const payload = {
          recipient,
          ...(sender ? { sender_name_id: sender } : {}),
          ...(template
            ? {
                template: {
                  id: template.id,
                  version: template.version,
                  parameters: parseObject(parameters),
                },
              }
            : { content }),
        };
        let body: unknown = payload;
        if (files.length) {
          const form = new FormData();
          form.append("payload", JSON.stringify(payload));
          for (const file of files) form.append("attachments", file, file.name);
          body = form;
        }
        const response = await request<MessageLog>(
          `${base}/profiles/${profile.id}/test`,
          { method: "POST", etag: `"${profile.version}"`, body },
        );
        setResult(response.data);
      },
      (error) => errors.show(error, ["recipient", "parameters", "content"]),
    );
  }
  return (
    <Drawer
      open
      wide
      title="发送真实邮件测试"
      description="将连接 SMTP 并外发；受理不代表送达"
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button pending={submission.pending} onClick={() => void send()}>
            <Send />
            确认发送
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
        <div className="form-grid">
          <Field label="SMTP 配置" required error={errors.fields.profile_id}>
            <Select
              value={profileId}
              onValueChange={(value) => {
                setProfileId(value);
                setSender("");
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
          <Field label="收件地址" required error={errors.fields.recipient}>
            <Input
              name="recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </Field>
          {profile && (
            <Field label="发件名称">
              <Select
                value={sender}
                onValueChange={(value) => setSender(value)}
              >
                <option value="">默认名称</option>
                {profile.sender_names.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="已保存模板（可选）">
            <Select
              value={templateId}
              onValueChange={(value) => setTemplateId(value)}
            >
              <option value="">直接输入内容</option>
              {templates.data?.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {template ? (
          <Field label="模板参数（JSON）" error={errors.fields.parameters}>
            <Textarea
              className="font-mono"
              value={parameters}
              onChange={(event) => setParameters(event.target.value)}
            />
          </Field>
        ) : (
          <div className="form-grid">
            <Field label="主题" required>
              <Input
                value={content.subject}
                onChange={(event) =>
                  setContent({ ...content, subject: event.target.value })
                }
              />
            </Field>
            <Field label="格式">
              <Select
                value={content.body_format}
                onValueChange={(value) =>
                  setContent({ ...content, body_format: value })
                }
              >
                <option value="text">纯文本</option>
                <option value="html">HTML</option>
              </Select>
            </Field>
            <Field label="正文" required className="form-full">
              <Textarea
                value={content.body}
                onChange={(event) =>
                  setContent({ ...content, body: event.target.value })
                }
              />
            </Field>
          </div>
        )}
        <Field
          label="附件"
          hint="最多 5 个，单个 5 MiB、合计 10 MiB；只随本次请求发送"
          error={errors.fields.attachments}
        >
          <Input
            name="attachments"
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
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
