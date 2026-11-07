import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  KeyRound,
  Pencil,
  Power,
  Settings2,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { CredentialPanel } from "@/components/credential-panel";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { CopyButton } from "@/components/copy-button";
import {
  Field,
  Input,
  NumberInput,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { OverlayPresence } from "@/components/overlay-presence";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { diagnosticText, diagnosticTone } from "@/domain/service-providers";
import { sshProvider } from "@/domain/ssh-provider";
import type { Resource } from "@/types/collaboration";
import type { Diagnostic, ServiceConnection } from "@/types/integrations";

import { HostCreateDrawer } from "./host-create-drawer";
import { HostDescription } from "./host-description";

export function RemoteHostsPage() {
  const { hostId, projectId } = useParams();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const admin = location.pathname.startsWith("/admin");
  const directory = useApiQuery<{ items: ServiceConnection[] }>(
    ["remote-host-directory"],
    "/remote-hosts",
  );
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const selected = directory.data?.data.items.find(
    (item) => item.id === hostId,
  );
  const creating = admin && (params.get("create") === "1" || hostId === "new");
  const closeCreate = () => {
    const next = new URLSearchParams(params);
    next.delete("create");
    navigate(
      { pathname: "/admin/remote-hosts", search: next.toString() },
      { replace: true },
    );
  };
  if (hostId && selected)
    return (
      <HostDetail
        key={selected.id}
        summary={selected}
        admin={admin}
        project={project.data?.data}
      />
    );
  if (hostId && !creating && directory.data && !selected)
    return (
      <div className="page">
        <Notice tone="danger">主机不存在或当前账号不可见。</Notice>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        title={
          admin ? "远程主机" : projectId ? "项目 SSH 凭证" : "个人 SSH 凭证"
        }
        description={
          admin
            ? "维护 SSH 主机、公钥信任、归属凭证与连接诊断。"
            : "选择主机并维护当前归属凭证；主机地址和公钥信任由系统管理员管理。"
        }
      />
      <HostDirectory
        refreshing={directory.isFetching}
        actions={
          admin && (
            <Button
              onClick={() => {
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("create", "1");
                  return next;
                });
              }}
            >
              <Plus />
              添加主机
            </Button>
          )
        }
        items={directory.data?.data.items ?? []}
        loading={directory.isPending}
        error={directory.error}
        retry={() => void directory.refetch()}
      />
      <OverlayPresence>
        {creating && <HostCreateDrawer onClose={closeCreate} />}
      </OverlayPresence>
    </div>
  );
}

function HostDirectory({
  actions,
  refreshing,
  items,
  loading,
  error,
  retry,
}: {
  actions?: React.ReactNode;
  refreshing: boolean;
  items: ServiceConnection[];
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const basePath = location.pathname
    .replace(/\/new\/?$/, "")
    .replace(/\/$/, "");
  const linkParams = new URLSearchParams(params);
  linkParams.delete("create");
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const filtered = items.filter(
    (item) =>
      (!q ||
        `${item.name} ${item.code} ${item.description}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!status || item.enabled === (status === "enabled")),
  );
  return (
    <Panel bodyClassName="p-0">
      <TableToolbar
        onReset={() => setParams({})}
        onRefresh={retry}
        refreshing={refreshing}
        actions={actions}
      >
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get("q") ?? "",
            );
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (value) next.set("q", value);
              else next.delete("q");
              return next;
            });
          }}
        >
          <StandaloneInput
            name="q"
            aria-label="搜索主机"
            defaultValue={q}
            placeholder="搜索名称、编码或说明"
          />
        </form>
        <StandaloneSelect
          aria-label="主机状态"
          value={status}
          onValueChange={(value) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (value) next.set("status", value);
              else next.delete("status");
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
        loading={loading}
        error={error}
        onRetry={retry}
        empty={!filtered.length}
        emptyTitle={q || status ? "没有匹配的主机" : "还没有远程主机"}
      >
        <SimpleTable
          actions
          label="远程主机"
          className="host-directory"
          headers={["主机", "协议", "状态", "操作"]}
        >
          {filtered.map((host) => (
            <tr key={host.id}>
              <td>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="resource-icon shrink-0">
                    <Server className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1">
                      <Link
                        className="truncate font-medium text-foreground hover:text-primary"
                        title={host.name}
                        to={`${basePath}/${host.id}?${linkParams}`}
                      >
                        {host.name}
                      </Link>
                      {host.description.trim() && (
                        <HostDescription
                          name={host.name}
                          description={host.description}
                        />
                      )}
                    </div>
                    <small
                      className="mono block truncate text-muted"
                      title={host.code}
                    >
                      {host.code}
                    </small>
                  </div>
                </div>
              </td>
              <td>SSH</td>
              <td>
                <StatusBadge tone={host.enabled ? "success" : "neutral"}>
                  {host.enabled ? "已启用" : "已停用"}
                </StatusBadge>
              </td>
              <td>
                <Link
                  className="link inline-flex"
                  aria-label={`查看 ${host.name}`}
                  to={`${basePath}/${host.id}?${linkParams}`}
                >
                  <ArrowRight className="size-4" />
                </Link>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
    </Panel>
  );
}

function HostDetail({
  summary,
  admin,
  project,
}: {
  summary: ServiceConnection;
  admin: boolean;
  project?: Resource;
}) {
  const path = `/admin/remote-hosts/${summary.id}`;
  const detail = useApiQuery<ServiceConnection>(
    ["remote-host", summary.id],
    path,
    { enabled: admin },
  );
  const host = detail.data?.data ?? summary;
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const submission = useSubmission();
  const queryClient = useQueryClient();
  if (admin && detail.isPending) return <AsyncBoundary loading />;
  if (admin && detail.error)
    return (
      <AsyncBoundary
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  const requestedTab = params.get("tab");
  const tab =
    admin && (requestedTab === "config" || requestedTab === "keys")
      ? requestedTab
      : requestedTab === "credentials" || !admin
        ? "credentials"
        : "config";
  const scope = admin ? "/admin" : project ? `/projects/${project.id}` : "/me";
  async function refresh() {
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: ["remote-host-directory"] }),
    ]);
  }
  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Server className="size-7 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 break-all">{host.name}</span>
            <StatusBadge tone={host.enabled ? "success" : "neutral"}>
              {host.enabled ? "已启用" : "已停用"}
            </StatusBadge>
          </span>
        }
        actions={
          admin && (
            <RowActions
              label="主机"
              disabled={submission.pending || submission.uncertain}
            >
              <RowAction
                icon={<Power />}
                onSelect={() =>
                  void submission.run(async () => {
                    await request(path, {
                      method: "PATCH",
                      etag: detail.data?.etag,
                      body: { enabled: !host.enabled },
                    });
                    await refresh();
                  })
                }
              >
                {host.enabled ? "停用主机" : "启用主机"}
              </RowAction>
              <RowActionSeparator />
              <RowAction
                icon={<Trash2 />}
                variant="destructive"
                onSelect={() => setRemove(true)}
              >
                删除主机
              </RowAction>
            </RowActions>
          )
        }
      />
      <ErrorNotice error={submission.error} />
      <Tabs
        label="主机功能"
        value={tab}
        onChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("tab", value);
            return next;
          })
        }
        items={[
          ...(admin
            ? [
                {
                  value: "config",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <Settings2 className="size-4" aria-hidden />
                      主机配置
                    </span>
                  ),
                },
                {
                  value: "keys",
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <ShieldCheck className="size-4" aria-hidden />
                      主机公钥
                    </span>
                  ),
                },
              ]
            : []),
          {
            value: "credentials",
            label: (
              <span className="inline-flex items-center gap-2">
                <KeyRound className="size-4" aria-hidden />
                {admin ? "系统凭证" : "访问凭证"}
              </span>
            ),
          },
        ]}
      />
      <div className="mt-5">
        {admin && (
          <div hidden={tab !== "config"} role="tabpanel" aria-label="主机配置">
            <HostConfig
              host={host}
              path={path}
              etag={detail.data?.etag ?? ""}
              edit={edit}
              onEdit={setEdit}
              onSaved={refresh}
            />
          </div>
        )}
        {admin && (
          <div hidden={tab !== "keys"} role="tabpanel" aria-label="主机公钥">
            <HostKeys
              host={host}
              path={path}
              etag={detail.data?.etag ?? ""}
              onSaved={refresh}
            />
          </div>
        )}
        {tab === "credentials" && (
          <CredentialPanel
            base={`${scope}/remote-hosts/${host.id}/credentials`}
            provider={sshProvider}
            system={admin}
            fallbackPath={admin ? `${path}/fallback-credential` : undefined}
            readonly={project?.status === "archived"}
          />
        )}
      </div>
      <ConfirmDialog
        open={remove}
        danger
        title="删除远程主机"
        description={host.name}
        confirmLabel="删除主机"
        pending={submission.pending}
        confirmDisabled={submission.uncertain}
        onClose={() => setRemove(false)}
        onConfirm={() =>
          void submission.run(async () => {
            await request(path, { method: "DELETE", etag: detail.data?.etag });
            window.location.assign("/admin/remote-hosts");
          })
        }
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">
          删除前须清空全部归属凭证；已信任公钥与诊断会一并删除。
        </p>
      </ConfirmDialog>
    </div>
  );
}

function HostConfig({
  host,
  path,
  etag,
  edit,
  onEdit,
  onSaved,
}: {
  host: ServiceConnection;
  path: string;
  etag: string;
  edit: boolean;
  onEdit: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [editEtag, setEditEtag] = useState(etag);
  const [form, setForm] = useState({
    name: host.name,
    description: host.description,
    host: host.config?.host ?? "",
    port: String(host.config?.port ?? 22),
  });
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["host-diagnostics", path],
    `${path}/diagnostics`,
  );
  const [current, setCurrent] = useState<Diagnostic | null>(null);
  const submission = useSubmission();
  const errors = useFormErrors();
  const savedForm = {
    name: host.name,
    description: host.description,
    host: host.config?.host ?? "",
    port: String(host.config?.port ?? 22),
  };
  const dirty = edit && JSON.stringify(form) !== JSON.stringify(savedForm);
  useUnsaved(dirty, submission.pending, true);
  const diagnostic = current ?? diagnostics.data?.data.latest ?? null;
  return (
    <div className="grid gap-5">
      <Panel
        title="主机配置"
        action={
          !edit && (
            <Button
              size="sm"
              variant="outline"
              disabled={submission.pending || submission.uncertain}
              onClick={() => {
                setForm(savedForm);
                setEditEtag(etag);
                errors.clear();
                submission.setError(null);
                onEdit(true);
              }}
            >
              <Pencil />
              编辑配置
            </Button>
          )
        }
      >
        {edit ? (
          <form
            ref={errors.formRef}
            onChange={() => errors.clear()}
            onSubmit={(event) => {
              event.preventDefault();
              if (
                submission.pending ||
                submission.uncertain ||
                !errors.validate({
                  name: !form.name.trim() ? "请输入主机名称" : "",
                  host: !form.host.trim() ? "请输入主机名或 IP" : "",
                  port:
                    !Number.isInteger(Number(form.port)) ||
                    Number(form.port) < 1 ||
                    Number(form.port) > 65535
                      ? "请输入 1–65535 的整数端口"
                      : "",
                })
              )
                return;
              void submission.run(async () => {
                await request(path, {
                  method: "PATCH",
                  etag: editEtag,
                  body: {
                    name: form.name.trim(),
                    description: form.description,
                    config: { host: form.host, port: Number(form.port) },
                  },
                });
                onEdit(false);
                await onSaved();
              });
            }}
          >
            <ErrorNotice error={submission.error} />
            <ErrorNotice error={errors.error} />
            <fieldset
              disabled={submission.pending || submission.uncertain}
              className="min-w-0"
            >
              <Notice tone="warning" className="mb-4">
                地址或端口变化会清空全部已信任公钥，必须重新核对。
              </Notice>
              <div className="form-grid">
                <Field label="主机名称" required error={errors.fields.name}>
                  <Input
                    name="name"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </Field>
                <Field label="主机编码" hint="创建后不可修改">
                  <Input readOnly value={host.code} className="mono" />
                </Field>
                <Field label="主机名 / IP" required error={errors.fields.host}>
                  <Input
                    name="host"
                    value={form.host}
                    onChange={(event) =>
                      setForm({ ...form, host: event.target.value })
                    }
                  />
                </Field>
                <Field label="SSH 端口" required error={errors.fields.port}>
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
                <Field label="说明" className="form-full">
                  <Textarea
                    name="description"
                    rows={5}
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                  />
                </Field>
              </div>
            </fieldset>
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={submission.pending}
                onClick={() => {
                  setForm(savedForm);
                  onEdit(false);
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                pending={submission.pending}
                disabled={submission.uncertain || !dirty}
              >
                保存配置
              </Button>
            </div>
          </form>
        ) : (
          <DescriptionList
            items={[
              {
                label: "主机编码",
                value: (
                  <span className="inline-flex max-w-full items-center gap-2">
                    <span className="mono break-all">{host.code}</span>
                    <CopyButton value={host.code} label="复制主机编码" />
                  </span>
                ),
              },
              { label: "协议", value: "SSH" },
              {
                label: "主机名 / IP",
                value: (
                  <span className="mono break-all">
                    {host.config?.host ?? "—"}
                  </span>
                ),
              },
              { label: "SSH 端口", value: host.config?.port ?? 22 },
              {
                label: "已信任公钥",
                value: `${host.config?.host_keys?.length ?? 0} 把`,
              },
              {
                label: "说明",
                value: (
                  <span className="whitespace-pre-wrap break-all">
                    {host.description || "—"}
                  </span>
                ),
                full: true,
              },
            ]}
          />
        )}
      </Panel>
      <Panel
        title="SSH 连接诊断"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!host.enabled || edit || submission.uncertain}
            pending={submission.pending}
            onClick={() =>
              void submission.run(async () => {
                const response = await request<Diagnostic>(`${path}/test`, {
                  method: "POST",
                  etag,
                  body: {},
                });
                setCurrent(response.data);
                await diagnostics.refetch();
              })
            }
          >
            测试 SSH 握手与公钥
          </Button>
        }
      >
        {!edit && <ErrorNotice error={submission.error} />}
        {diagnostic ? (
          <Notice tone={diagnosticTone(diagnostic)}>
            {diagnosticText(diagnostic)}
            <small className="mt-2 block">{diagnostic.finished_at}</small>
          </Notice>
        ) : (
          <p className="text-sm text-muted">
            尚无记录。测试在取得公钥时结束，不发送登录认证材料。
          </p>
        )}
      </Panel>
    </div>
  );
}

function HostKeys({
  host,
  path,
  etag,
  onSaved,
}: {
  host: ServiceConnection;
  path: string;
  etag: string;
  onSaved: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [testResult, setTestResult] = useState<Diagnostic | null>(null);
  const submission = useSubmission();
  const keys = host.config?.host_keys ?? [];
  useUnsaved(Boolean(key.trim()), submission.pending, true);
  async function save(next: string[]) {
    if (submission.pending || submission.uncertain) return false;
    return submission.run(async () => {
      await request(path, {
        method: "PATCH",
        etag,
        body: { config: { host_keys: next } },
      });
      await onSaved();
    });
  }
  async function probe() {
    await submission.run(async () => {
      const response = await request<Diagnostic>(`${path}/test`, {
        method: "POST",
        etag,
        body: {},
      });
      setTestResult(response.data);
    });
  }
  const observedKey = testResult?.summary.host_key ?? "";
  return (
    <div className="grid gap-5">
      <Panel
        title="受信任主机公钥"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!host.enabled || submission.uncertain}
            pending={submission.pending}
            onClick={() => void probe()}
          >
            探测当前公钥
          </Button>
        }
      >
        <ErrorNotice error={submission.error} />
        <Notice className="mb-4">
          探测不等于信任。请通过可信来源核对 SHA256 指纹后显式加入；最多 8
          把公钥支持轮换。
        </Notice>
        {keys.length ? (
          <ul className="grid gap-3">
            {keys.map((value) => {
              const fingerprint = Object.entries(
                host.host_key_fingerprints ?? {},
              ).find(([publicKey]) => publicKey === value)?.[1];
              return (
                <li key={value} className="rounded-lg border p-3">
                  <code className="block break-all text-xs">{value}</code>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="mono min-w-0 break-all text-xs text-muted">
                      {fingerprint ?? "指纹已记录"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-danger"
                      disabled={submission.pending || submission.uncertain}
                      onClick={() =>
                        void save(keys.filter((item) => item !== value))
                      }
                    >
                      移除信任
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">尚未信任任何主机公钥。</p>
        )}
      </Panel>
      {testResult && (
        <Panel title="本次探测结果">
          <Notice tone={diagnosticTone(testResult)}>
            {diagnosticText(testResult)}
          </Notice>
          <dl className="mt-3 grid gap-2 text-xs">
            <div>
              <dt className="text-muted">SHA256 指纹</dt>
              <dd className="mono break-all">
                {testResult.summary.fingerprint ?? "—"}
              </dd>
            </div>
          </dl>
          {observedKey && !keys.includes(observedKey) && (
            <Button
              className="mt-4"
              pending={submission.pending}
              disabled={submission.uncertain || keys.length >= 8}
              onClick={() => void save([...keys, observedKey])}
            >
              <ShieldCheck />
              我已核对指纹，信任此公钥
            </Button>
          )}
        </Panel>
      )}
      <Panel title="手动导入 OpenSSH 公钥">
        <Field label="公钥" hint="不包含选项或注释；服务端计算指纹">
          <Textarea
            className="font-mono"
            disabled={submission.pending || submission.uncertain}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
        <Button
          className="mt-3"
          disabled={!key.trim() || keys.length >= 8 || submission.uncertain}
          pending={submission.pending}
          onClick={() =>
            void save([...keys, key.trim()]).then((saved) => {
              if (saved) setKey("");
            })
          }
        >
          <KeyRound />
          核对后加入信任
        </Button>
      </Panel>
    </div>
  );
}
