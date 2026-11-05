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
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Pencil,
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
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { SimpleTable } from "@/components/table";
import { WizardSteps } from "@/components/wizard";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import {
  authenticationBody,
  diagnosticText,
  diagnosticTone,
} from "@/domain/service-providers";
import { sshProvider } from "@/domain/ssh-provider";
import type { Resource } from "@/types/collaboration";
import type {
  Credential,
  Diagnostic,
  ServiceConnection,
} from "@/types/integrations";

export function RemoteHostsPage() {
  const { hostId, projectId } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
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
  if ((params.get("create") === "1" || hostId === "new") && admin)
    return (
      <div className="page">
        <HostCreate />
      </div>
    );
  if (hostId && selected)
    return (
      <HostDetail
        summary={selected}
        admin={admin}
        project={project.data?.data}
      />
    );
  if (hostId && directory.data && !selected)
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
        actions={
          admin && (
            <Button
              onClick={() => {
                const next = new URLSearchParams(location.search);
                next.set("create", "1");
                window.history.pushState(
                  null,
                  "",
                  `${location.pathname}?${next}`,
                );
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              <Plus />
              添加主机
            </Button>
          )
        }
      />
      <HostDirectory
        items={directory.data?.data.items ?? []}
        loading={directory.isPending}
        error={directory.error}
        retry={() => void directory.refetch()}
      />
    </div>
  );
}

function HostDirectory({
  items,
  loading,
  error,
  retry,
}: {
  items: ServiceConnection[];
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
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
      <div className="toolbar">
        <form
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
          onChange={(event) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              if (event.target.value) next.set("status", event.target.value);
              else next.delete("status");
              return next;
            })
          }
        >
          <option value="">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
        </StandaloneSelect>
        <Button variant="ghost" onClick={() => setParams({})}>
          清除筛选
        </Button>
      </div>
      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={retry}
        empty={!filtered.length}
        emptyTitle={q || status ? "没有匹配的主机" : "还没有远程主机"}
      >
        <SimpleTable
          label="远程主机"
          headers={["主机", "说明", "协议", "状态", "操作"]}
        >
          {filtered.map((host) => (
            <tr key={host.id}>
              <td>
                <div className="flex items-center gap-3">
                  <span className="resource-icon">
                    <Server className="size-5" />
                  </span>
                  <div>
                    <Link
                      className="font-medium text-foreground hover:text-primary"
                      to={`${location.pathname.replace(/\/$/, "")}/${host.id}?${params}`}
                    >
                      {host.name}
                    </Link>
                    <small className="mono block text-muted">{host.code}</small>
                  </div>
                </div>
              </td>
              <td className="max-w-md whitespace-normal text-xs">
                {host.description || "—"}
              </td>
              <td>SSH</td>
              <td>
                <StatusBadge tone={host.enabled ? "success" : "neutral"}>
                  {host.enabled ? "已启用" : "已停用"}
                </StatusBadge>
              </td>
              <td>
                <Link
                  className="link"
                  to={`${location.pathname.replace(/\/$/, "")}/${host.id}?${params}`}
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

function HostCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    host: "",
    port: "22",
    enabled: true,
  });
  const [withCredential, setWithCredential] = useState(true);
  const [credential, setCredential] = useState({
    name: "",
    code: "",
    method: "ssh_password",
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<ServiceConnection | null>(null);
  const [credentialError, setCredentialError] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const markSaved = useUnsaved(true, submission.pending);
  const method =
    sshProvider.methods.find((item) => item.value === credential.method) ??
    sshProvider.methods[0];
  async function save(includeCredential: boolean) {
    if (!form.name.trim() || !form.host.trim()) {
      errors.validate({
        name: !form.name.trim() ? "请输入主机名称" : "",
        host: !form.host.trim() ? "请输入主机名或 IP" : "",
      });
      return;
    }
    await submission.run(async () => {
      let host = created;
      if (!host) {
        const response = await request<ServiceConnection>(
          "/admin/remote-hosts",
          {
            method: "POST",
            body: {
              name: form.name.trim(),
              code: form.code.trim(),
              description: form.description,
              enabled: form.enabled,
              config: { host: form.host, port: Number(form.port) },
            },
          },
        );
        host = response.data;
        setCreated(host);
      }
      if (includeCredential && method) {
        if (!credential.name.trim()) {
          errors.validate({ credential_name: "请输入首个凭证名称" });
          return;
        }
        try {
          const base = `/admin/remote-hosts/${host.id}/credentials`;
          const collection = await request<{ items: Credential[] }>(base);
          await request(base, {
            method: "POST",
            etag: collection.etag,
            body: {
              code: credential.code.trim(),
              name: credential.name.trim(),
              description: "",
              expires_at: null,
              authentication: authenticationBody(method, values),
            },
          });
        } catch (error) {
          setCredentialError(
            error instanceof Error ? error.message : "凭证创建失败",
          );
          return;
        }
      }
      markSaved();
      navigate(`/admin/remote-hosts/${host.id}`);
    });
  }
  return (
    <div>
      <PageHeader
        title="添加 SSH 主机"
        description="主机信息 → 首个凭证；公钥信任在创建后单独核对"
        actions={
          <Button
            variant="outline"
            onClick={() => navigate("/admin/remote-hosts")}
          >
            <ArrowLeft />
            返回列表
          </Button>
        }
      />
      <WizardSteps steps={["主机信息", "首个凭证"]} current={step} />
      <Panel className="mt-5">
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {step === 0 ? (
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
            <Field label="编码（可选）">
              <Input
                className="mono"
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="主机名 / IP" required error={errors.fields.host}>
              <Input
                name="host"
                autoComplete="off"
                value={form.host}
                onChange={(event) =>
                  setForm({ ...form, host: event.target.value })
                }
              />
            </Field>
            <Field label="SSH 端口" required>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) =>
                  setForm({ ...form, port: event.target.value })
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
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              创建后启用
            </label>
          </div>
        ) : (
          <div className="grid gap-4">
            <Notice>
              创建主机不会自动信任公钥。请先测试握手并从可信来源核对 SHA256
              指纹。
            </Notice>
            {created && (
              <Notice tone={credentialError ? "danger" : "warning"}>
                主机「{created.name}」已创建。{credentialError}
              </Notice>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withCredential}
                onChange={(event) => setWithCredential(event.target.checked)}
              />
              同时创建首个系统凭证
            </label>
            {withCredential && method && (
              <div className="form-grid">
                <Field
                  label="凭证名称"
                  required
                  error={errors.fields.credential_name}
                >
                  <Input
                    name="credential_name"
                    value={credential.name}
                    onChange={(event) =>
                      setCredential({ ...credential, name: event.target.value })
                    }
                  />
                </Field>
                <Field label="凭证编码（可选）">
                  <Input
                    className="mono"
                    value={credential.code}
                    onChange={(event) =>
                      setCredential({ ...credential, code: event.target.value })
                    }
                  />
                </Field>
                <Field label="认证方式" className="form-full">
                  <Select
                    value={credential.method}
                    onChange={(event) => {
                      setCredential({
                        ...credential,
                        method: event.target.value,
                      });
                      setValues({});
                    }}
                  >
                    {sshProvider.methods.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {[...method.identity, ...method.secret].map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required
                    className={
                      field.type === "textarea" ? "form-full" : undefined
                    }
                  >
                    {field.type === "textarea" ? (
                      <Textarea
                        className="font-mono"
                        value={values[field.key] ?? ""}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.key]: event.target.value,
                          })
                        }
                      />
                    ) : (
                      <Input
                        type={field.type ?? "text"}
                        autoComplete="off"
                        value={values[field.key] ?? ""}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.key]: event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="form-actions">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(0)}>
              上一步
            </Button>
          )}
          {step === 0 ? (
            <Button
              onClick={() => {
                if (form.name.trim() && form.host.trim()) setStep(1);
                else
                  errors.validate({
                    name: !form.name.trim() ? "请输入主机名称" : "",
                    host: !form.host.trim() ? "请输入主机名或 IP" : "",
                  });
              }}
            >
              下一步
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                pending={submission.pending}
                disabled={submission.uncertain}
                onClick={() => void save(false)}
              >
                仅创建主机
              </Button>
              <Button
                pending={submission.pending}
                disabled={!withCredential || submission.uncertain}
                onClick={() => void save(true)}
              >
                创建主机和凭证
              </Button>
            </>
          )}
        </div>
      </Panel>
    </div>
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
  const tab = params.get("tab") ?? (admin ? "config" : "credentials");
  const scope = admin ? "/admin" : project ? `/projects/${project.id}` : "/me";
  async function refresh() {
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: ["remote-host-directory"] }),
    ]);
  }
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Server className="size-7 text-primary" />
            {host.name}
          </span>
        }
        description={
          <span className="inline-flex items-center gap-2">
            <span className="mono">{host.code}</span>
            <CopyButton value={host.code} label="复制主机编码" /> · SSH
          </span>
        }
        actions={
          admin && (
            <>
              <Button
                variant="outline"
                onClick={() =>
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
              </Button>
              <Button variant="dangerSoft" onClick={() => setRemove(true)}>
                <Trash2 />
                删除主机
              </Button>
            </>
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
                { value: "config", label: "主机配置" },
                { value: "keys", label: "主机公钥" },
              ]
            : []),
          { value: "credentials", label: admin ? "系统凭证" : "访问凭证" },
        ]}
      />
      <div className="mt-5">
        {tab === "config" && admin && (
          <HostConfig
            host={host}
            path={path}
            etag={detail.data?.etag ?? ""}
            edit={edit}
            onEdit={setEdit}
            onSaved={refresh}
          />
        )}
        {tab === "keys" && admin && (
          <HostKeys
            host={host}
            path={path}
            etag={detail.data?.etag ?? ""}
            onSaved={refresh}
          />
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
  const diagnostic = current ?? diagnostics.data?.data.latest ?? null;
  return (
    <div className="grid gap-5">
      <Panel
        title="主机配置"
        action={
          !edit && (
            <Button size="sm" variant="outline" onClick={() => onEdit(true)}>
              <Pencil />
              编辑配置
            </Button>
          )
        }
      >
        {edit ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submission.run(async () => {
                await request(path, {
                  method: "PATCH",
                  etag,
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
            <Notice tone="warning" className="mb-4">
              地址或端口变化会清空全部已信任公钥，必须重新核对。
            </Notice>
            <div className="form-grid">
              <Field label="主机名称" required>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Field>
              <Field label="主机名 / IP" required>
                <Input
                  value={form.host}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                />
              </Field>
              <Field label="SSH 端口" required>
                <Input
                  type="number"
                  value={form.port}
                  onChange={(event) =>
                    setForm({ ...form, port: event.target.value })
                  }
                />
              </Field>
              <Field label="说明">
                <Input
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button variant="outline" onClick={() => onEdit(false)}>
                取消
              </Button>
              <Button type="submit" pending={submission.pending}>
                保存配置
              </Button>
            </div>
          </form>
        ) : (
          <DescriptionList
            items={[
              {
                label: "主机名 / IP",
                value: <span className="mono">{host.config?.host ?? "—"}</span>,
              },
              { label: "SSH 端口", value: host.config?.port ?? 22 },
              {
                label: "已信任公钥",
                value: `${host.config?.host_keys?.length ?? 0} 把`,
              },
              { label: "说明", value: host.description || "—" },
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
            disabled={!host.enabled || edit}
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
        <ErrorNotice error={submission.error} />
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
  async function save(next: string[]) {
    await submission.run(async () => {
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
            disabled={!host.enabled}
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
                    <span className="mono text-xs text-muted">
                      {fingerprint ?? "指纹已记录"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
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
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
        <Button
          className="mt-3"
          disabled={!key.trim() || keys.length >= 8}
          pending={submission.pending}
          onClick={() => void save([...keys, key.trim()])}
        >
          <KeyRound />
          核对后加入信任
        </Button>
      </Panel>
    </div>
  );
}
