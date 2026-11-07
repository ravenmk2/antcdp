import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Send,
  Trash2,
  Server,
  FileText,
  History,
  RefreshCw,
  KeyRound,
  Power,
} from "lucide-react";
import { ApiError, isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
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
import { formatBytes, formatDate } from "@/lib/utils";
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
  {
    value: "profiles",
    label: (
      <span className="inline-flex items-center gap-2">
        <Server className="size-4" aria-hidden />
        SMTP 配置
      </span>
    ),
  },
  {
    value: "templates",
    label: (
      <span className="inline-flex items-center gap-2">
        <FileText className="size-4" aria-hidden />
        邮件模板
      </span>
    ),
  },
  {
    value: "send-logs",
    label: (
      <span className="inline-flex items-center gap-2">
        <History className="size-4" aria-hidden />
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

export function EmailPage() {
  const { section = "profiles", id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  if (!sections.some((item) => item.value === section))
    return <Notice tone="danger">页面不存在。</Notice>;
  return (
    <div className="page">
      {(!id || section === "send-logs") && (
        <PageHeader
          title="邮件配置"
          description="配置发件服务、编写邮件模板并查看发送记录。"
          actions={<EmailTestButton />}
        />
      )}
      {(!id || section === "send-logs") && (
        <Tabs
          label="邮件功能"
          value={section}
          onChange={(value) => navigate(`${base}/${value}`)}
          items={sections}
        />
      )}
      <div className="mt-5">
        {section === "send-logs" && <EmailLogList />}
        <OverlayPresence>
          {section === "send-logs" && id && (
            <MessageLogDetail
              module="email"
              id={id}
              onClose={() => navigate(`${base}/send-logs?${params}`)}
            />
          )}
        </OverlayPresence>
        {section === "profiles" &&
          (id ? <EmailProfileDetail id={id} /> : <ProfileList />)}
        {section === "templates" &&
          (id ? <EmailTemplateEditor id={id} /> : <TemplateList />)}
      </div>
      <OverlayPresence>
        {params.get("test") === "1" && (
          <EmailTest
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
                      {profile.config.tls_mode === "implicit_tls"
                        ? "TLS 直连"
                        : "STARTTLS"}
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
                      ? `${profile.latest.outdated ? "历史 · " : ""}${messageStatusLabels[profile.latest.status]}`
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
                queryKey: ["email-profiles"],
              });
              navigate(`${base}/profiles/${id}`);
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
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const submission = useEmailSubmission();
  if (!query.data && (query.isPending || query.error))
    return (
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const profile = query.data!.data;
  return (
    <section>
      <PageHeader
        title={profile.name}
        actions={
          <RowActions label="SMTP 配置" disabled={submission.pending}>
            <RowAction
              icon={<Send />}
              disabled={!profile.enabled}
              onSelect={() => {
                const next = new URLSearchParams(params);
                next.set("test", "1");
                setParams(next);
              }}
            >
              发送测试
            </RowAction>
            <RowAction icon={<Pencil />} onSelect={() => setMode("edit")}>
              编辑配置
            </RowAction>
            <RowAction icon={<KeyRound />} onSelect={() => setMode("auth")}>
              替换认证
            </RowAction>
            <RowAction
              icon={<Power />}
              disabled={
                submission.uncertain || isVersionConflict(submission.error)
              }
              onSelect={() =>
                void submission.run(async () => {
                  await request(`${base}/profiles/${id}`, {
                    method: "PATCH",
                    etag: query.data!.etag,
                    body: { enabled: !profile.enabled },
                  });
                  await query.refetch();
                  await queryClient.invalidateQueries({
                    queryKey: ["email-profiles"],
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
      <div className="grid gap-5">
        <Panel title="SMTP 与发件身份">
          <DescriptionList
            items={[
              {
                label: "配置编码",
                value: (
                  <span className="inline-flex max-w-full items-center gap-2">
                    <span className="mono break-all">{profile.code}</span>
                    <CopyButton value={profile.code} label="复制配置编码" />
                  </span>
                ),
              },
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
              { label: "说明", value: profile.description || "—", full: true },
              {
                label: "公共 CA",
                value: profile.config.custom_ca_pem ? "已配置" : "使用系统信任",
              },
              { label: "状态", value: profile.enabled ? "已启用" : "已停用" },
            ]}
          />
          {!remove && <ErrorNotice error={submission.error} />}
          {(isVersionConflict(submission.error) || submission.uncertain) && (
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch().then((response) => {
                  if (!response.error) submission.setError(null);
                });
              }}
            >
              重新加载配置
            </Button>
          )}
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
            etag={query.data!.etag}
            authOnly={mode === "auth"}
            onClose={() => setMode(null)}
            onSaved={async () => {
              setMode(null);
              await queryClient.invalidateQueries({
                queryKey: ["email-profile", id],
              });
              await queryClient.invalidateQueries({
                queryKey: ["email-profiles"],
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
        confirmDisabled={
          submission.uncertain || isVersionConflict(submission.error)
        }
        onClose={() => setRemove(false)}
        onConfirm={() => {
          if (submission.uncertain || isVersionConflict(submission.error))
            return;
          void submission.run(async () => {
            await request(`${base}/profiles/${id}`, {
              method: "DELETE",
              etag: query.data!.etag,
            });
            navigate(`${base}/profiles`);
            await queryClient.invalidateQueries({
              queryKey: ["email-profiles"],
            });
          });
        }}
      >
        <ErrorNotice error={submission.error} />
        {(submission.uncertain || isVersionConflict(submission.error)) && (
          <Button
            variant="outline"
            onClick={() => {
              setRemove(false);
              void query.refetch().then((response) => {
                if (!response.error) submission.setError(null);
              });
            }}
          >
            读取最新配置核实
          </Button>
        )}
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
    host: profile?.config.host ?? "",
    port: String(profile?.config.port ?? 465),
    tls_mode: profile?.config.tls_mode ?? "implicit_tls",
    from_address: profile?.config.from_address ?? "",
    custom_ca_pem: profile?.config.custom_ca_pem ?? "",
    username: profile?.username ?? "",
    password: "",
  });
  const [senders, setSenders] = useState(
    profile?.sender_names.length
      ? profile.sender_names
      : [{ id: "", name: "AntCDP 通知", default: true }],
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({ form, senders }),
  );
  const [version, setVersion] = useState(etag);
  const [review, setReview] = useState<EmailProfile | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const errors = useFormErrors();
  const submission = useEmailSubmission();
  const dirty = JSON.stringify({ form, senders }) !== baseline;
  const markSaved = useUnsaved(dirty, submission.pending);
  const blocked =
    needsReview ||
    submission.uncertain ||
    isVersionConflict(submission.error) ||
    Boolean(profile && !version);
  function close() {
    if (!submission.pending) {
      if (dirty) setDiscard(true);
      else {
        markSaved();
        onClose();
      }
    }
  }
  function change(key: keyof typeof form, value: string) {
    setForm({ ...form, [key]: value });
    errors.change(key);
  }
  async function reload() {
    if (!profile) return;
    await submission.run(async () => {
      const response = await request<EmailProfile>(
        `${base}/profiles/${profile.id}`,
      );
      setVersion(response.etag);
      setReview(response.data);
      setForm((current) => ({ ...current, password: "" }));
      errors.clear();
    });
  }
  async function save() {
    if (submission.pending || blocked || review) return;
    const fields: Record<string, string> = {};
    if (!authOnly) {
      if (!form.name.trim()) fields.name = "请输入配置名称";
      if (!form.host.trim()) fields.host = "请输入 SMTP 主机";
      if (
        !/^\d+$/.test(form.port) ||
        Number(form.port) < 1 ||
        Number(form.port) > 65535
      )
        fields.port = "请输入 1–65535 的整数端口";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.from_address))
        fields.from_address = "请输入有效发件地址";
      const names = senders.map((sender) => sender.name.trim());
      if (
        !names.length ||
        names.length > 20 ||
        senders.filter((sender) => sender.default).length !== 1
      )
        fields.sender_names = "请保留 1–20 个发件名称，且恰好一个默认项";
      names.forEach((name, index) => {
        if (!name) fields[`sender_${index}`] = "请输入发件名称";
        else if (names.indexOf(name) !== index)
          fields[`sender_${index}`] = "发件名称不能重复";
      });
    }
    if (!profile || authOnly) {
      if (!form.username.trim()) fields.username = "请输入认证账号";
      if (!form.password) fields.password = "请输入密码或授权码";
    }
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        const response = await request<EmailProfile>(
          authOnly && profile
            ? `${base}/profiles/${profile.id}/authentication`
            : profile
              ? `${base}/profiles/${profile.id}`
              : `${base}/profiles`,
          {
            method: authOnly ? "PUT" : profile ? "PATCH" : "POST",
            etag: profile ? version : undefined,
            body: authOnly
              ? { username: form.username, password: form.password }
              : {
                  ...(profile ? {} : { code: form.code.trim(), enabled: true }),
                  name: form.name.trim(),
                  description: form.description,
                  config: {
                    host: form.host.trim(),
                    port: Number(form.port),
                    tls_mode: form.tls_mode,
                    from_address: form.from_address.trim(),
                    custom_ca_pem: form.custom_ca_pem,
                  },
                  sender_names: senders.map((sender) => ({
                    ...sender,
                    name: sender.name.trim(),
                  })),
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
        setBaseline(JSON.stringify({ form, senders }));
        markSaved();
        await onSaved(response.data.id);
      },
      (error) => {
        if (error.uncertain || isVersionConflict(error)) setNeedsReview(true);
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
            "custom_ca_pem",
          ],
          {
            "config.host": "host",
            "config.port": "port",
            "config.from_address": "from_address",
            "config.custom_ca_pem": "custom_ca_pem",
            "authentication.username": "username",
            "authentication.password": "password",
          },
        );
      },
    );
  }
  return (
    <>
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
        description={
          authOnly
            ? "新的账号和密码会完整替换现有认证。"
            : "设置服务器连接与发件身份，保存后可发送测试邮件。"
        }
        pending={submission.pending}
        onClose={close}
        footer={
          <>
            <Button
              variant="outline"
              disabled={submission.pending}
              onClick={close}
            >
              取消
            </Button>
            <Button
              pending={submission.pending}
              disabled={
                blocked || Boolean(review) || (!dirty && Boolean(profile))
              }
              onClick={() => void save()}
            >
              保存配置
            </Button>
          </>
        }
      >
        <form
          ref={errors.formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ErrorNotice error={errors.error || submission.error} />
          {blocked && (
            <Notice tone="warning">
              {submission.uncertain
                ? "保存结果尚未确认，请先核对当前配置，不要重复提交。"
                : "配置版本需要更新，请读取最新资料并核对草稿。"}
              {profile ? (
                <Button
                  variant="outline"
                  disabled={submission.pending}
                  onClick={() => void reload()}
                >
                  <RefreshCw />
                  读取最新配置
                </Button>
              ) : (
                <Link className="link ml-2" to={`${base}/profiles`}>
                  返回列表核实
                </Link>
              )}
            </Notice>
          )}
          {review && (
            <Notice tone="warning">
              已读取最新配置，草稿已保留。请核对服务器、发件身份和名称后再保存；认证密码需重新输入。
              <DescriptionList
                items={[
                  { label: "名称", value: review.name },
                  {
                    label: "服务器",
                    value: `${review.config.host}:${review.config.port} · ${review.config.tls_mode === "implicit_tls" ? "TLS 直连" : "STARTTLS"}`,
                  },
                  { label: "发件地址", value: review.config.from_address },
                  { label: "认证账号", value: review.username },
                  {
                    label: "发件名称",
                    value: review.sender_names
                      .map(
                        (sender) =>
                          `${sender.name}${sender.default ? "（默认）" : ""}`,
                      )
                      .join("、"),
                    full: true,
                  },
                  {
                    label: "说明",
                    value: review.description || "—",
                    full: true,
                  },
                ]}
              />
              <Button
                variant="outline"
                onClick={() => {
                  setReview(null);
                  setNeedsReview(false);
                }}
              >
                已核对，继续编辑草稿
              </Button>
            </Notice>
          )}
          <fieldset
            disabled={submission.pending}
            className="grid min-w-0 gap-6"
          >
            {!authOnly && (
              <>
                <section className="grid gap-3">
                  <h3 className="text-sm font-medium">基本信息</h3>
                  <div className="form-grid">
                    <Field label="配置名称" required error={errors.fields.name}>
                      <Input
                        name="name"
                        maxLength={100}
                        value={form.name}
                        onChange={(event) => change("name", event.target.value)}
                      />
                    </Field>
                    <Field
                      label={profile ? "配置编码" : "编码（可选）"}
                      error={errors.fields.code}
                      hint={profile ? "创建后不可修改" : "留空自动生成"}
                    >
                      <Input
                        name="code"
                        className="mono"
                        readOnly={Boolean(profile)}
                        value={form.code}
                        onChange={(event) => change("code", event.target.value)}
                      />
                    </Field>
                    <Field label="说明" className="form-full">
                      <Textarea
                        maxLength={1000}
                        value={form.description}
                        onChange={(event) =>
                          change("description", event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </section>
                <section className="grid gap-3 border-t pt-5">
                  <h3 className="text-sm font-medium">服务器连接</h3>
                  <div className="form-grid">
                    <Field
                      label="SMTP 主机"
                      required
                      error={errors.fields.host}
                      className="form-full"
                    >
                      <Input
                        name="host"
                        placeholder="smtp.example.com"
                        value={form.host}
                        onChange={(event) => change("host", event.target.value)}
                      />
                    </Field>
                    <Field label="安全模式">
                      <Select
                        disabled={submission.pending}
                        value={form.tls_mode}
                        onValueChange={(value) => change("tls_mode", value)}
                      >
                        <option value="implicit_tls">TLS 直连</option>
                        <option value="starttls">STARTTLS</option>
                      </Select>
                    </Field>
                    <Field
                      label="端口"
                      required
                      error={errors.fields.port}
                      hint="TLS 直连通常为 465，STARTTLS 通常为 587；以服务商为准。"
                    >
                      <NumberInput
                        name="port"
                        label="端口"
                        min={1}
                        max={65535}
                        value={form.port}
                        disabled={submission.pending}
                        onValueChange={(value) => change("port", value)}
                      />
                    </Field>
                  </div>
                  <details open={Boolean(errors.fields.custom_ca_pem)}>
                    <summary className="cursor-pointer text-sm text-muted">
                      高级选项 · 自定义 CA
                      {form.custom_ca_pem ? "（已填写）" : ""}
                    </summary>
                    <div className="mt-3">
                      <Field
                        label="公共 CA（PEM，可选）"
                        error={errors.fields.custom_ca_pem}
                        hint="默认使用系统信任证书；仅在服务器使用私有 CA 时填写。"
                      >
                        <Textarea
                          name="custom_ca_pem"
                          className="font-mono"
                          value={form.custom_ca_pem}
                          onChange={(event) =>
                            change("custom_ca_pem", event.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </details>
                </section>
              </>
            )}
            {!profile || authOnly ? (
              <section className="grid gap-3 border-t pt-5">
                <h3 className="text-sm font-medium">SMTP 认证</h3>
                <div className="form-grid">
                  <Field
                    label="认证用户名"
                    required
                    error={errors.fields.username}
                  >
                    <Input
                      name="username"
                      autoComplete="off"
                      value={form.username}
                      onChange={(event) =>
                        change("username", event.target.value)
                      }
                    />
                  </Field>
                  <Field
                    label="密码 / 授权码"
                    required
                    error={errors.fields.password}
                    hint="保存后不可读取；部分服务商要求使用授权码。"
                  >
                    <Input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      disabled={submission.pending}
                      value={form.password}
                      onChange={(event) =>
                        change("password", event.target.value)
                      }
                    />
                  </Field>
                </div>
              </section>
            ) : (
              <Notice tone="info">
                认证账号：{profile.username}
                。如需修改账号或密码，请返回详情使用“替换认证”。
              </Notice>
            )}
            {!authOnly && (
              <section className="grid gap-3 border-t pt-5">
                <h3 className="text-sm font-medium">发件身份</h3>
                <Field
                  label="发件地址"
                  required
                  error={errors.fields.from_address}
                  hint="可与认证账号不同，须获得邮件服务商授权。"
                >
                  <Input
                    name="from_address"
                    type="email"
                    value={form.from_address}
                    onChange={(event) =>
                      change("from_address", event.target.value)
                    }
                  />
                </Field>
                <p className="text-xs text-muted">
                  发件名称显示在收件人的邮箱中；发送时默认使用选中的名称。
                </p>
                {senders.map((sender, index) => (
                  <div
                    key={sender.id || index}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3"
                  >
                    <Field
                      label={`发件名称 ${index + 1}`}
                      required
                      error={
                        errors.fields[`sender_${index}`] ||
                        (index === 0 ? errors.fields.sender_names : undefined)
                      }
                    >
                      <Input
                        name={`sender_${index}`}
                        data-field-name={
                          index === 0 ? "sender_names" : undefined
                        }
                        maxLength={100}
                        value={sender.name}
                        onChange={(event) => {
                          errors.clear();
                          setSenders(
                            senders.map((item, position) =>
                              position === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <label className="mt-8 flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="default-sender"
                        aria-label={`将发件名称 ${index + 1} 设为默认`}
                        checked={sender.default}
                        onChange={() => {
                          errors.clear();
                          setSenders(
                            senders.map((item, position) => ({
                              ...item,
                              default: position === index,
                            })),
                          );
                        }}
                      />
                      默认
                    </label>
                    <Button
                      className="mt-6"
                      size="icon"
                      variant="ghost"
                      aria-label={`删除发件名称 ${index + 1}`}
                      disabled={senders.length <= 1 || sender.default}
                      title={
                        sender.default ? "请先将其他名称设为默认" : "删除名称"
                      }
                      onClick={() => {
                        errors.clear();
                        setSenders(
                          senders.filter((_, position) => position !== index),
                        );
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={senders.length >= 20}
                    onClick={() =>
                      setSenders([
                        ...senders,
                        { id: "", name: "", default: false },
                      ])
                    }
                  >
                    <Plus />
                    添加名称
                  </Button>
                  <span className="text-xs text-muted">
                    {senders.length} / 20 · 删除默认项前请先选择其他默认名称
                  </span>
                </div>
              </section>
            )}
          </fieldset>
        </form>
      </Drawer>
      <ConfirmDialog
        open={discard}
        title="放弃未保存的修改？"
        description="关闭后，本次填写的配置将丢失。"
        confirmLabel="放弃修改"
        danger
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          markSaved();
          onClose();
        }}
      />
    </>
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
                  {template.engine_id === "go_template"
                    ? "Go 模板"
                    : template.engine_id}{" "}
                  · v{template.engine_version}
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
  const current = query.data?.data;
  if (!create && query.isPending) return <AsyncBoundary loading />;
  if (query.error && !query.data)
    return (
      <AsyncBoundary error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <TemplateForm
      key={id}
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
  const submission = useEmailSubmission();
  const previewSubmission = useEmailSubmission();
  const busy = submission.pending || previewSubmission.pending;
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({ form, schema, sample }),
  );
  const [version, setVersion] = useState(etag);
  const [remove, setRemove] = useState(false);
  const [review, setReview] = useState<EmailTemplate | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [previewSource, setPreviewSource] = useState("");
  const dirty = JSON.stringify({ form, schema, sample }) !== baseline;
  const markSaved = useUnsaved(dirty, busy);
  const queryClient = useQueryClient();
  const blocked =
    needsReview ||
    submission.uncertain ||
    isVersionConflict(submission.error) ||
    (!create && !version);
  const source = JSON.stringify({ form, schema, sample });
  async function reload() {
    await submission.run(async () => {
      const response = await request<EmailTemplate>(
        `${base}/templates/${form.id}`,
      );
      setVersion(response.etag);
      setReview(response.data);
      errors.clear();
    });
  }
  function validateJSON() {
    const fields: Record<string, string> = {};
    try {
      parseObject(schema);
    } catch {
      fields.parameter_schema = "请输入有效的 JSON 对象";
    }
    try {
      parseObject(sample);
    } catch {
      fields.sample_data = "请输入有效的 JSON 对象";
    }
    return errors.validate(fields);
  }
  function update<K extends keyof EmailTemplate>(
    key: K,
    value: EmailTemplate[K],
  ) {
    errors.change(key);
    setForm({ ...form, [key]: value });
  }
  function draft() {
    return {
      code: form.code,
      name: form.name.trim(),
      description: form.description,
      enabled: form.enabled,
      engine_id: form.engine_id,
      engine_version: form.engine_version,
      subject_template: form.subject_template,
      body_format: form.body_format,
      body_template: form.body_template,
      text_body_template:
        form.body_format === "html" ? form.text_body_template : "",
      parameter_schema: parseObject(schema),
      sample_data: parseObject(sample),
    };
  }
  async function showPreview() {
    if (busy || !validateJSON()) return;
    await previewSubmission.run(
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
        setPreviewSource(source);
      },
      (error) => {
        if (error.uncertain) {
          errors.setError(
            "未取得预览结果，草稿仍保留；预览不会保存或发送邮件，可重新预览。",
          );
          return;
        }
        errors.show(error, [
          "parameter_schema",
          "sample_data",
          "body_template",
          "subject_template",
        ]);
      },
    );
  }
  async function save() {
    if (busy || blocked || review || !validateJSON()) return;
    if (!form.name.trim() || !form.subject_template || !form.body_template) {
      errors.validate({
        body_template: !form.body_template ? "请输入正文模板" : "",
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
            etag: create ? undefined : version,
            body: draft(),
          },
        );
        setVersion(response.etag);
        setBaseline(JSON.stringify({ form, schema, sample }));
        if (create) markSaved();
        await onSaved(response.data);
      },
      (error) => {
        if (error.uncertain || isVersionConflict(error)) setNeedsReview(true);
        errors.show(error, [
          "name",
          "code",
          "parameter_schema",
          "sample_data",
          "body_template",
          "subject_template",
        ]);
      },
    );
  }
  return (
    <div>
      <PageHeader
        title={create ? "创建邮件模板" : form.name}
        description="编辑主题与正文，使用样例数据检查预览效果。发送测试使用已保存版本。"
        actions={
          <>
            {!create && <EmailTestButton disabled={!form.enabled || busy} />}
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              <ArrowLeft />
              返回模板列表
            </Button>
            <Button
              variant="outline"
              pending={busy}
              onClick={() => void showPreview()}
            >
              预览草稿
            </Button>
            <Button
              pending={busy}
              disabled={blocked || Boolean(review) || (!create && !dirty)}
              onClick={() => void save()}
            >
              {create ? "创建模板" : "保存模板"}
            </Button>
            {!create && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRemove(true)}
              >
                <Trash2 />
                删除模板
              </Button>
            )}
          </>
        }
      />
      {!remove && (
        <ErrorNotice
          error={errors.error || submission.error || previewSubmission.error}
        />
      )}
      {blocked && (
        <Notice tone="warning">
          {submission.uncertain
            ? "保存结果尚未确认，请先核实已保存内容。"
            : "模板版本需要更新，请核对最新内容。"}
          {!create ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void reload()}
            >
              读取最新模板
            </Button>
          ) : (
            <Button variant="outline" onClick={onCancel}>
              返回列表核实
            </Button>
          )}
        </Notice>
      )}
      {review && (
        <Notice tone="warning">
          草稿已保留，请展开最新内容核对后继续。
          <details>
            <summary className="cursor-pointer">查看服务器最新模板</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(
                {
                  name: review.name,
                  code: review.code,
                  description: review.description,
                  enabled: review.enabled,
                  subject_template: review.subject_template,
                  body_format: review.body_format,
                  body_template: review.body_template,
                  text_body_template: review.text_body_template,
                  parameter_schema: review.parameter_schema,
                  sample_data: review.sample_data,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <Button
            variant="outline"
            onClick={() => {
              setReview(null);
              setNeedsReview(false);
            }}
          >
            已核对，继续编辑草稿
          </Button>
        </Notice>
      )}
      <form
        ref={errors.formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={busy}
          className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        >
          <Panel
            title="模板内容"
            className="min-w-0"
            bodyClassName="panel-body max-h-[calc(100dvh-300px)] overflow-y-auto"
          >
            <div className="form-grid">
              <Field label="模板名称" required error={errors.fields.name}>
                <Input
                  name="name"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </Field>
              <Field label="编码（可选）" error={errors.fields.code}>
                <Input
                  name="code"
                  className="mono"
                  readOnly={!create}
                  value={form.code}
                  onChange={(event) => update("code", event.target.value)}
                />
              </Field>
              <Field label="说明" className="form-full">
                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
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
                  disabled={busy}
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
                  name="body_template"
                  className="min-h-72 font-mono"
                  value={form.body_template}
                  onChange={(event) =>
                    update("body_template", event.target.value)
                  }
                />
              </Field>
              {form.body_format === "html" && (
                <Field
                  label="备用纯文本正文"
                  className="form-full"
                  hint="供无法显示 HTML 的邮件客户端使用。"
                >
                  <Textarea
                    className="font-mono"
                    value={form.text_body_template}
                    onChange={(event) =>
                      update("text_body_template", event.target.value)
                    }
                  />
                </Field>
              )}
              <Field
                label="参数 Schema（JSON）"
                className="form-full"
                error={errors.fields.parameter_schema}
              >
                <Textarea
                  name="parameter_schema"
                  className="min-h-40 font-mono"
                  value={schema}
                  onChange={(event) => {
                    errors.change("parameter_schema");
                    setSchema(event.target.value);
                  }}
                />
              </Field>
              <Field
                label="样例数据（JSON）"
                className="form-full"
                error={errors.fields.sample_data}
              >
                <Textarea
                  name="sample_data"
                  className="min-h-40 font-mono"
                  value={sample}
                  onChange={(event) => {
                    errors.change("sample_data");
                    setSample(event.target.value);
                  }}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="邮件预览" className="min-w-0 xl:sticky xl:top-5">
            {preview && previewSource !== source && (
              <Notice tone="warning">
                内容已修改，当前为上次预览。请重新预览草稿。
              </Notice>
            )}
            {preview ? (
              <>
                <h3 className="mb-3 text-sm font-medium">{preview.subject}</h3>
                {preview.body_format === "html" ? (
                  <iframe
                    title="邮件 HTML 隔离预览"
                    sandbox=""
                    className="h-[calc(100dvh-390px)] min-h-64 w-full rounded-lg border bg-white"
                    srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body>${preview.body}</body>`}
                  />
                ) : (
                  <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words text-sm">
                    {preview.body}
                  </pre>
                )}
                {preview.text_body && (
                  <details className="mt-3">
                    <summary>备用纯文本</summary>
                    <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words text-sm">
                      {preview.text_body}
                    </pre>
                  </details>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">
                点击“预览草稿”查看主题和正文。预览不会发送邮件，也不会加载外部图片。
              </p>
            )}
          </Panel>
        </fieldset>
      </form>
      <ConfirmDialog
        open={remove}
        title="删除邮件模板？"
        description={`将删除“${form.name}”。此操作不可撤销，已有发送日志保留至到期。`}
        confirmLabel="删除模板"
        danger
        pending={busy}
        confirmDisabled={blocked}
        onClose={() => {
          if (!busy) setRemove(false);
        }}
        onConfirm={() => {
          if (blocked) return;
          void submission.run(
            async () => {
              await request(`${base}/templates/${form.id}`, {
                method: "DELETE",
                etag: version,
              });
              markSaved();
              await queryClient.invalidateQueries({
                queryKey: ["email-templates"],
              });
              onCancel();
            },
            (error) => {
              if (error.uncertain || isVersionConflict(error))
                setNeedsReview(true);
            },
          );
        }}
      >
        <ErrorNotice error={submission.error} />
        {blocked && (
          <Button
            variant="outline"
            onClick={() => {
              setRemove(false);
              void reload();
            }}
          >
            读取最新模板核实
          </Button>
        )}
      </ConfirmDialog>
    </div>
  );
}

function EmailTest({
  onClose,
  initialProfileId = "",
  initialTemplateId = "",
}: {
  onClose: () => void;
  initialProfileId?: string;
  initialTemplateId?: string;
}) {
  const profiles = useEmailChoices<EmailProfile>("profiles");
  const templates = useEmailChoices<EmailTemplate>("templates");
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState(initialProfileId);
  const [templateId, setTemplateId] = useState(initialTemplateId);
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
  const [needsCheck, setNeedsCheck] = useState(false);
  const [checked, setChecked] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  const [discard, setDiscard] = useState(false);
  const errors = useFormErrors();
  const submission = useEmailSubmission();
  const recovery = useEmailSubmission();
  const draftKey = JSON.stringify({
    profileId,
    templateId,
    recipient,
    sender,
    parameters,
    content,
    files: files.map((file) => [file.name, file.size, file.lastModified]),
  });
  const [baseline, setBaseline] = useState(draftKey);
  const dirty = draftKey !== baseline;
  const markSaved = useUnsaved(dirty, submission.pending);
  const profile = profiles.data?.find((item) => item.id === profileId);
  const template = templates.data?.find((item) => item.id === templateId);
  const loading = profiles.isPending || templates.isPending;
  const loadError = profiles.error || templates.error;
  const pending = submission.pending || recovery.pending;
  const conflict = isVersionConflict(submission.error);
  const disabled = pending || needsCheck;
  function close() {
    if (pending) return;
    if (dirty) setDiscard(true);
    else {
      markSaved();
      onClose();
    }
  }
  async function refreshRelated() {
    await Promise.all(
      [
        "email-profiles",
        "email-profile",
        "email-templates",
        "email-template",
        "message-logs",
        "message-log",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  }
  async function checkResult() {
    await recovery.run(async () => {
      if (result) {
        const response = await request<MessageLog>(
          `${base}/send-logs/${result.id}`,
        );
        setResult(response.data);
        setCheckMessage(
          "已读取本次发送记录。结果未知时仍需与收件人或邮件服务商核对。",
        );
      } else {
        const response = await request<EmailProfile>(
          `${base}/profiles/${profileId}`,
        );
        setCheckMessage(
          response.data.latest
            ? `最近记录：${messageStatusLabels[response.data.latest.status]} · ${formatDate(response.data.latest.started_at)}。最近记录不一定属于本次请求，请在日志中核对。`
            : "保留期内暂无记录；这不能证明本次请求未发送，请与收件人或邮件服务商核对。",
        );
      }
      await refreshRelated();
      setChecked(true);
    });
  }
  async function send() {
    if (pending || needsCheck || conflict || loading || loadError) return;
    const fields: Record<string, string> = {};
    if (!profile || !profile.version)
      fields.profile_id = "请选择可用的 SMTP 配置";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim()))
      fields.recipient = "请输入有效收件地址";
    if (templateId && (!template || !template.version))
      fields.template_id = "所选模板不可用，请重新选择";
    if (template) {
      try {
        parseObject(parameters);
      } catch {
        fields.parameters = "请输入有效的 JSON 对象";
      }
    } else {
      if (!content.subject.trim()) fields.subject = "请输入邮件主题";
      if (!content.body.trim()) fields.body = "请输入邮件正文";
    }
    if (
      files.length > 5 ||
      files.some((file) => file.size > 5 * 1024 * 1024) ||
      files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024
    )
      fields.attachments = "附件最多 5 个，单个不超过 5 MiB，合计不超过 10 MiB";
    if (!errors.validate(fields) || !profile) return;
    setResult(null);
    setCheckMessage("");
    setChecked(false);
    await submission.run(
      async () => {
        const payload = {
          recipient: recipient.trim(),
          ...(sender ? { sender_name_id: sender } : {}),
          ...(template
            ? {
                template: {
                  id: template.id,
                  version: template.version,
                  parameters: parseObject(parameters),
                },
              }
            : {
                content: {
                  ...content,
                  text_body:
                    content.body_format === "html" ? content.text_body : "",
                },
              }),
        };
        let body: unknown = payload;
        if (files.length) {
          const multipart = new FormData();
          multipart.append("payload", JSON.stringify(payload));
          for (const file of files)
            multipart.append("attachments", file, file.name);
          body = multipart;
        }
        const response = await request<MessageLog>(
          `${base}/profiles/${profile.id}/test`,
          { method: "POST", etag: `"${profile.version}"`, body },
        );
        setResult(response.data);
        setBaseline(draftKey);
        setNeedsCheck(
          ["unknown", "in_progress"].includes(response.data.status),
        );
      },
      (error) => {
        if (error.uncertain) setNeedsCheck(true);
        errors.show(
          error,
          ["recipient", "parameters", "subject", "body", "attachments"],
          {
            "content.subject": "subject",
            "content.body": "body",
            "template.parameters": "parameters",
          },
        );
      },
    );
    await refreshRelated();
  }
  return (
    <>
      <Drawer
        open
        wide
        title="发送邮件测试"
        description="将向一个收件地址发送真实邮件；SMTP 受理不代表送达。"
        onClose={close}
        pending={pending}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={close}>
              关闭
            </Button>
            <Button
              pending={submission.pending}
              disabled={
                disabled ||
                loading ||
                Boolean(loadError) ||
                !profile ||
                conflict ||
                Boolean(templateId && !template)
              }
              onClick={() => void send()}
            >
              <Send />
              {result ? "再次发送" : "确认发送"}
            </Button>
          </>
        }
      >
        <form
          ref={errors.formRef}
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          onChange={() => errors.clear()}
        >
          <ErrorNotice error={errors.error || submission.error} />
          {result && <LogSummary log={result} />}
          {needsCheck && (
            <Notice tone="warning">
              本次发送仍需核实，暂时不能再次发送。
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  pending={recovery.pending}
                  onClick={() => void checkResult()}
                >
                  <RefreshCw />
                  核实发送结果
                </Button>
                <Link
                  className="link"
                  to={`${base}/send-logs?profile_id=${profileId}`}
                >
                  查看发送日志
                </Link>
              </div>
              <ErrorNotice error={recovery.error} />
              {checkMessage && <p className="mt-3">{checkMessage}</p>}
              {checked && result?.status !== "in_progress" && (
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    setNeedsCheck(false);
                    submission.setError(null);
                    errors.clear();
                  }}
                >
                  已核对，允许准备下一次发送
                </Button>
              )}
            </Notice>
          )}
          {conflict && (
            <Notice tone="warning">
              配置或模板已变更。请刷新后核对选项和内容，再次发送。
              <Button
                variant="outline"
                pending={recovery.pending}
                onClick={() =>
                  void recovery.run(async () => {
                    const responses = await Promise.all([
                      profiles.refetch(),
                      templates.refetch(),
                    ]);
                    if (responses.some((response) => response.error))
                      throw new Error("刷新失败，请重试");
                    submission.setError(null);
                    errors.clear();
                  })
                }
              >
                刷新配置与模板
              </Button>
              <ErrorNotice error={recovery.error} />
            </Notice>
          )}
          <AsyncBoundary
            loading={loading}
            error={loadError}
            onRetry={() => {
              void profiles.refetch();
              void templates.refetch();
            }}
          >
            {!loading && !loadError && !profiles.data?.length ? (
              <Notice tone="info">
                还没有已启用的 SMTP 配置。
                <Link className="link ml-2" to={`${base}/profiles`}>
                  前往添加或启用配置
                </Link>
              </Notice>
            ) : (
              <fieldset disabled={disabled} className="grid min-w-0 gap-5">
                <section className="grid gap-3">
                  <h3 className="text-sm font-medium">收发件信息</h3>
                  <div className="form-grid">
                    <Field
                      label="SMTP 配置"
                      required
                      error={
                        errors.fields.profile_id ||
                        (profileId && !profile
                          ? "所选配置已停用或不可用，请重新选择"
                          : "")
                      }
                    >
                      <Select
                        name="profile_id"
                        disabled={disabled}
                        value={profileId}
                        onValueChange={(value) => {
                          setProfileId(value);
                          setSender("");
                          errors.clear();
                        }}
                      >
                        <option value="">请选择配置</option>
                        {profiles.data?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.config.from_address}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="收件地址"
                      required
                      error={errors.fields.recipient}
                    >
                      <Input
                        name="recipient"
                        type="email"
                        placeholder="recipient@example.com"
                        value={recipient}
                        onChange={(event) => setRecipient(event.target.value)}
                      />
                    </Field>
                    {profile && (
                      <Field label="发件名称">
                        <Select
                          disabled={disabled}
                          value={sender}
                          onValueChange={setSender}
                        >
                          <option value="">
                            {profile.sender_names.find((item) => item.default)
                              ?.name ?? "默认名称"}
                            （默认）
                          </option>
                          {profile.sender_names.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
                </section>
                <section className="grid gap-3 border-t pt-5">
                  <h3 className="text-sm font-medium">邮件内容</h3>
                  <Field
                    label="内容来源"
                    error={
                      errors.fields.template_id ||
                      (templateId && !template
                        ? "所选模板不可用，请重新选择"
                        : "")
                    }
                    hint="模板发送使用已保存版本，样例数据仅供参考。"
                  >
                    <Select
                      name="template_id"
                      disabled={disabled}
                      value={templateId}
                      onValueChange={(value) => {
                        setTemplateId(value);
                        errors.clear();
                      }}
                    >
                      <option value="">直接输入内容</option>
                      {templates.data?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {templateId ? (
                    <Field
                      label="模板参数（JSON）"
                      error={errors.fields.parameters}
                    >
                      <Textarea
                        name="parameters"
                        className="min-h-48 font-mono"
                        value={parameters}
                        onChange={(event) => setParameters(event.target.value)}
                      />
                    </Field>
                  ) : (
                    <div className="form-grid">
                      <Field
                        label="主题"
                        required
                        error={errors.fields.subject}
                      >
                        <Input
                          name="subject"
                          maxLength={200}
                          value={content.subject}
                          onChange={(event) =>
                            setContent({
                              ...content,
                              subject: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="格式">
                        <Select
                          disabled={disabled}
                          value={content.body_format}
                          onValueChange={(value) =>
                            setContent({ ...content, body_format: value })
                          }
                        >
                          <option value="text">纯文本</option>
                          <option value="html">HTML</option>
                        </Select>
                      </Field>
                      <Field
                        label="正文"
                        required
                        className="form-full"
                        error={errors.fields.body}
                      >
                        <Textarea
                          name="body"
                          className="min-h-40"
                          value={content.body}
                          onChange={(event) =>
                            setContent({ ...content, body: event.target.value })
                          }
                        />
                      </Field>
                      {content.body_format === "html" && (
                        <Field label="备用纯文本正文" className="form-full">
                          <Textarea
                            value={content.text_body}
                            onChange={(event) =>
                              setContent({
                                ...content,
                                text_body: event.target.value,
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </section>
                <section className="grid gap-3 border-t pt-5">
                  <Field
                    label="附件"
                    hint="最多 5 个，单个 5 MiB、合计 10 MiB；仅随本次请求上传。"
                    error={errors.fields.attachments}
                  >
                    <Input
                      name="attachments"
                      type="file"
                      multiple
                      onChange={(event) => {
                        setFiles([
                          ...files,
                          ...Array.from(event.target.files ?? []),
                        ]);
                        event.target.value = "";
                      }}
                    />
                  </Field>
                  {files.length > 0 && (
                    <>
                      <ul className="divide-y">
                        {files.map((file, index) => (
                          <li
                            key={`${file.name}-${index}`}
                            className="flex items-center gap-3 py-2 text-sm"
                          >
                            <span className="min-w-0 flex-1 break-all">
                              {file.name}
                            </span>
                            <span className="text-xs text-muted">
                              {formatBytes(file.size)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`移除附件 ${file.name}`}
                              onClick={() =>
                                setFiles(
                                  files.filter(
                                    (_, position) => position !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted">
                        {files.length} 个附件 · 共{" "}
                        {formatBytes(
                          files.reduce((sum, file) => sum + file.size, 0),
                        )}
                      </p>
                    </>
                  )}
                </section>
              </fieldset>
            )}
          </AsyncBoundary>
        </form>
      </Drawer>
      <ConfirmDialog
        open={discard}
        title="放弃测试草稿？"
        description="未发送的内容和所选附件将被清除；已经提交的发送不会被撤回。"
        confirmLabel="放弃草稿"
        danger
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          markSaved();
          onClose();
        }}
      />
    </>
  );
}

function useEmailChoices<T extends { id: string }>(
  kind: "profiles" | "templates",
  status = "enabled",
) {
  return useQuery({
    queryKey: [`email-${kind}`, "choices", status],
    retry: false,
    queryFn: async ({ signal }) => {
      const items = new Map<string, T>();
      for (let page = 1; ; page++) {
        const response = await request<Page<T>>(
          `${base}/${kind}?page=${page}&page_size=100&status=${status}`,
          { signal },
        );
        for (const item of response.data.items) items.set(item.id, item);
        if (
          page * response.data.page_size >= response.data.total ||
          !response.data.items.length
        )
          break;
      }
      return [...items.values()];
    },
  });
}

function LogSummary({ log }: { log: MessageLog }) {
  return (
    <Notice
      tone={
        log.status === "accepted"
          ? "success"
          : log.status === "unknown"
            ? "warning"
            : log.status === "in_progress"
              ? "info"
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

function useEmailSubmission() {
  const submission = useSubmission();
  const lock = useRef(false);
  return {
    ...submission,
    run: async (
      task: () => Promise<void>,
      onError?: (error: ApiError) => void,
    ) => {
      if (lock.current) return false;
      lock.current = true;
      try {
        return await submission.run(task, onError);
      } finally {
        lock.current = false;
      }
    },
  };
}

function EmailTestButton({ disabled = false }: { disabled?: boolean }) {
  const [params, setParams] = useSearchParams();
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={() => {
        const next = new URLSearchParams(params);
        next.set("test", "1");
        setParams(next);
      }}
    >
      <Send />
      发送测试
    </Button>
  );
}

function EmailLogList() {
  const profiles = useEmailChoices<EmailProfile>("profiles", "");
  const templates = useEmailChoices<EmailTemplate>("templates", "");
  return (
    <>
      {(profiles.error || templates.error) && (
        <Notice tone="warning">
          筛选名称加载失败，仍可用 ID 查询历史记录。
          <Button
            variant="outline"
            onClick={() => {
              void profiles.refetch();
              void templates.refetch();
            }}
          >
            重试加载筛选项
          </Button>
        </Notice>
      )}
      <MessageLogList
        module="email"
        profileOptions={profiles.data}
        templateOptions={templates.data}
      />
    </>
  );
}
