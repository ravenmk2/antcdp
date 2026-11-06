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
  ArrowLeft,
  ArrowRight,
  Cable,
  Check,
  Pencil,
  Plus,
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
import { CredentialPanel } from "@/components/credential-panel";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import {
  authenticationBody,
  defaultConfig,
  diagnosticText,
  diagnosticTone,
  providerFor,
  type ProviderDefinition,
} from "@/domain/service-providers";
import type { Resource } from "@/types/collaboration";
import type {
  Credential,
  Diagnostic,
  ServiceConnection,
  ServiceType,
} from "@/types/integrations";
import { WebhookPanel } from "./webhook-panel";

export function IntegrationsPage() {
  const { connectionId, projectId } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const admin = location.pathname.startsWith("/admin");
  const types = useApiQuery<{ items: ServiceType[] }>(
    ["service-types"],
    "/service-types",
  );
  const directory = useApiQuery<{ items: ServiceConnection[] }>(
    ["service-directory"],
    "/service-connections",
  );
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const summary = directory.data?.data.items.find(
    (item) => item.id === connectionId,
  );
  if ((params.get("create") === "1" || connectionId === "new") && admin)
    return (
      <div className="page">
        <ConnectionCreate capabilities={types.data?.data.items ?? []} />
      </div>
    );
  if (connectionId && summary)
    return (
      <ConnectionDetail
        summary={summary}
        admin={admin}
        project={project.data?.data}
        capabilities={types.data?.data.items ?? []}
      />
    );
  if (connectionId && directory.data && !summary)
    return (
      <div className="page">
        <Notice tone="danger">连接不存在或当前账号不可见。</Notice>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        title={admin ? "服务集成" : projectId ? "项目服务凭证" : "个人服务凭证"}
        description={
          admin
            ? "维护服务连接、归属凭证、首选/兜底、Webhook 与诊断。"
            : "选择服务连接，只维护当前归属的访问凭证；连接内部配置不会展示。"
        }
      />
      <Directory
        refreshing={directory.isFetching || types.isFetching}
        actions={
          admin && (
            <Button
              onClick={() => {
                const next = new URLSearchParams(location.search);
                next.set("create", "1");
                navigateWithQuery(next);
              }}
            >
              <Plus />
              添加连接
            </Button>
          )
        }
        items={directory.data?.data.items ?? []}
        types={types.data?.data.items ?? []}
        loading={directory.isPending || types.isPending}
        error={directory.error ?? types.error}
        retry={() => {
          void directory.refetch();
          void types.refetch();
        }}
      />
    </div>
  );
}

function navigateWithQuery(query: URLSearchParams) {
  window.history.pushState(null, "", `${location.pathname}?${query}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Directory({
  actions,
  refreshing,
  items,
  types,
  loading,
  error,
  retry,
}: {
  actions?: React.ReactNode;
  refreshing: boolean;
  items: ServiceConnection[];
  types: ServiceType[];
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const filtered = items.filter(
    (item) =>
      (!q ||
        `${item.name} ${item.code} ${item.description}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!type || item.service_type === type) &&
      (!status || item.enabled === (status === "enabled")),
  );
  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
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
            filter(
              "q",
              String(new FormData(event.currentTarget).get("q") ?? ""),
            );
          }}
        >
          <StandaloneInput
            name="q"
            aria-label="搜索服务连接"
            defaultValue={q}
            placeholder="搜索名称、编码或说明"
          />
        </form>
        <StandaloneSelect
          aria-label="服务类型"
          value={type}
          onValueChange={(value) => filter("type", value)}
        >
          <option value="">全部服务</option>
          {[
            ...new Set([
              ...types.map((item) => item.service_type),
              ...items.map((item) => item.service_type),
            ]),
          ].map((value) => (
            <option key={value} value={value}>
              {providerFor(value)?.name ?? value} ·{" "}
              {items.filter((item) => item.service_type === value).length}
            </option>
          ))}
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="连接状态"
          value={status}
          onValueChange={(value) => filter("status", value)}
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
        emptyTitle={
          q || type || status ? "没有匹配的服务连接" : "还没有服务连接"
        }
        emptyDescription="管理员可添加已实现的服务类型；不会显示未实现的占位服务。"
      >
        <SimpleTable
          label="服务连接"
          headers={["连接", "服务类型", "说明", "启停", "操作"]}
        >
          {filtered.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="flex min-w-52 items-center gap-3">
                  <ServiceIcon type={item.service_type} />
                  <div>
                    <Link
                      className="font-medium text-foreground hover:text-primary"
                      to={`${location.pathname.replace(/\/$/, "")}/${item.id}?${params}`}
                    >
                      {item.name}
                    </Link>
                    <small className="mono mt-1 block text-muted">
                      {item.code}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                {providerFor(item.service_type)?.name ?? item.service_type}
              </td>
              <td className="max-w-md whitespace-normal text-xs">
                {item.description || "—"}
              </td>
              <td>
                <StatusBadge tone={item.enabled ? "success" : "neutral"}>
                  {item.enabled ? "已启用" : "已停用"}
                </StatusBadge>
              </td>
              <td>
                <Link
                  className="link"
                  to={`${location.pathname.replace(/\/$/, "")}/${item.id}?${params}`}
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

function ServiceIcon({ type }: { type: string }) {
  return (
    <span className="resource-icon">
      {providerFor(type) ? (
        <img
          src={`/service-icons/${type}.svg`}
          alt=""
          className="size-5 dark:rounded-sm dark:bg-white dark:p-0.5"
        />
      ) : (
        <Cable className="size-5" />
      )}
    </span>
  );
}

function ConnectionCreate({ capabilities }: { capabilities: ServiceType[] }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const provider = providerFor(type);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    enabled: true,
  });
  const [withCredential, setWithCredential] = useState(true);
  const [credential, setCredential] = useState({
    name: "",
    code: "",
    description: "",
    method: "",
  });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<ServiceConnection | null>(null);
  const [credentialError, setCredentialError] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const markSaved = useUnsaved(true, submission.pending);
  const available = capabilities
    .filter((capability) => providerFor(capability.service_type))
    .filter(
      (capability) =>
        !search ||
        `${capability.name} ${capability.service_type}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  function choose(value: string) {
    const next = providerFor(value);
    setType(value);
    setConfig(next ? defaultConfig(next) : {});
    setCredential((current) => ({
      ...current,
      method: next?.methods[0]?.value ?? "",
    }));
    setSecrets({});
  }
  function validate(target: number) {
    const fields: Record<string, string> = {};
    if (target === 0 && !provider) fields.service_type = "请选择服务类型";
    if (target >= 1) {
      if (!form.name.trim()) fields.name = "请输入连接名称";
      if (form.code && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.code))
        fields.code = "编码格式不正确";
      if (provider)
        for (const field of provider.configFields)
          if (
            !field.key.includes("ca_pem") &&
            !(config[field.key] ?? "") &&
            !(field.key === "tls_mode")
          )
            fields[field.key] = `请输入${field.label}`;
    }
    return errors.validate(fields);
  }
  async function saveCredential(connection: ServiceConnection) {
    if (!provider) return;
    const method =
      provider.methods.find((item) => item.value === credential.method) ??
      provider.methods[0];
    if (!method) return;
    const base = `/admin/service-connections/${connection.service_type}/${connection.id}/credentials`;
    const collection = await request<{ items: Credential[] }>(base);
    await request(base, {
      method: "POST",
      etag: collection.etag,
      body: {
        code: credential.code.trim(),
        name: credential.name.trim(),
        description: credential.description,
        expires_at: null,
        authentication: authenticationBody(method, secrets),
      },
    });
  }
  async function save(includeCredential: boolean) {
    if (!provider || !validate(1)) return;
    await submission.run(async () => {
      let connection = created;
      if (!connection) {
        const response = await request<ServiceConnection>(
          `/admin/service-connections/${type}`,
          {
            method: "POST",
            body: { ...form, config: provider.configBody(config) },
          },
        );
        connection = response.data;
        setCreated(connection);
      }
      if (includeCredential) {
        if (!credential.name.trim()) {
          errors.validate({ credential_name: "请输入首个凭证名称" });
          return;
        }
        try {
          await saveCredential(connection);
        } catch (error) {
          setCredentialError(
            error instanceof Error ? error.message : "凭证创建失败",
          );
          return;
        }
      }
      markSaved();
      navigate(`/admin/integrations/${connection.id}`);
    });
  }
  return (
    <div>
      <PageHeader
        title="添加服务连接"
        description="选类型 → 连接信息 → 首个凭证；前两步只保留本地草稿"
        actions={
          <Button
            variant="outline"
            onClick={() => navigate("/admin/integrations")}
          >
            <ArrowLeft />
            返回列表
          </Button>
        }
      />
      <WizardSteps
        steps={["选择类型", "连接信息", "首个凭证"]}
        current={step}
      />
      <Panel className="mt-5">
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {step === 0 && (
          <div>
            <StandaloneInput
              aria-label="搜索服务类型"
              placeholder="搜索服务类型"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {available.map((capability) => {
                const item = providerFor(capability.service_type);
                if (!item) return null;
                return (
                  <button
                    key={item.type}
                    className={`flex items-start gap-3 rounded-lg border p-4 text-left ${type === item.type ? "border-primary bg-accent-soft" : "hover:bg-surface-hover"}`}
                    onClick={() => choose(item.type)}
                  >
                    <ServiceIcon type={item.type} />
                    <span>
                      <strong>{item.name}</strong>
                      <small className="mt-1 block text-muted">
                        {item.description}
                      </small>
                    </span>
                    {type === item.type && (
                      <Check className="ml-auto text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
            {errors.fields.service_type && (
              <p className="mt-2 text-xs text-danger">
                {errors.fields.service_type}
              </p>
            )}
          </div>
        )}
        {step === 1 && provider && (
          <div className="form-grid">
            <Field label="连接名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="编码（可选）" error={errors.fields.code}>
              <Input
                name="code"
                className="mono"
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
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
            <ProviderConfigFields
              provider={provider}
              values={config}
              onChange={setConfig}
              errors={errors.fields}
            />
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
        )}
        {step === 2 && provider && (
          <div className="grid gap-4">
            <Notice>
              连接成功而凭证失败时会保留连接，只重试凭证；不会自动设首选或兜底。
            </Notice>
            {created && (
              <Notice tone={credentialError ? "danger" : "warning"}>
                连接「{created.name}」已创建。
                {credentialError ? `凭证尚未创建：${credentialError}` : ""}
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
            {withCredential && (
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
                    onValueChange={(value) => {
                      setCredential({
                        ...credential,
                        method: value,
                      });
                      setSecrets({});
                    }}
                  >
                    {provider.methods.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <AuthenticationFields
                  provider={provider}
                  method={credential.method}
                  values={secrets}
                  onChange={setSecrets}
                />
              </div>
            )}
          </div>
        )}
        <div className="form-actions">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              上一步
            </Button>
          )}
          {step < 2 ? (
            <Button
              onClick={() => {
                if (validate(step)) setStep(step + 1);
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
                仅创建连接
              </Button>
              <Button
                pending={submission.pending}
                disabled={!withCredential || submission.uncertain}
                onClick={() => void save(true)}
              >
                创建连接和凭证
              </Button>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

function ProviderConfigFields({
  provider,
  values,
  onChange,
  errors,
}: {
  provider: ProviderDefinition;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors: Record<string, string>;
}) {
  return (
    <>
      {provider.configFields.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          required={!field.key.includes("ca_pem")}
          error={errors[field.key]}
          className={field.type === "textarea" ? "form-full" : undefined}
        >
          {field.options ? (
            <Select
              value={values[field.key] ?? ""}
              onValueChange={(value) =>
                onChange({ ...values, [field.key]: value })
              }
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : field.type === "textarea" ? (
            <Textarea
              name={field.key}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
            />
          ) : (
            <Input
              name={field.key}
              type={field.type ?? "text"}
              autoComplete="off"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
            />
          )}
        </Field>
      ))}
    </>
  );
}
function AuthenticationFields({
  provider,
  method,
  values,
  onChange,
}: {
  provider: ProviderDefinition;
  method: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const current =
    provider.methods.find((item) => item.value === method) ??
    provider.methods[0];
  if (!current) return null;
  return (
    <>
      {[...current.identity, ...current.secret].map((field) => (
        <Field
          key={field.key}
          label={field.label}
          required
          className={field.type === "textarea" ? "form-full" : undefined}
        >
          {field.type === "textarea" ? (
            <Textarea
              className="font-mono"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
            />
          ) : (
            <Input
              type={field.type ?? "text"}
              autoComplete="off"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
            />
          )}
        </Field>
      ))}
    </>
  );
}

function ConnectionDetail({
  summary,
  admin,
  project,
  capabilities,
}: {
  summary: ServiceConnection;
  admin: boolean;
  project?: Resource;
  capabilities: ServiceType[];
}) {
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const providerPath = `/admin/service-connections/${summary.service_type}/${summary.id}`;
  const detail = useApiQuery<ServiceConnection>(
    ["connection", summary.id],
    providerPath,
    { enabled: admin },
  );
  if (admin && detail.isPending) return <AsyncBoundary loading />;
  if (admin && detail.error)
    return (
      <AsyncBoundary
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  const connection = detail.data?.data ?? summary;
  const provider = providerFor(summary.service_type);
  const capability = capabilities.find(
    (item) => item.service_type === summary.service_type,
  );
  const tab = params.get("tab") ?? (admin ? "config" : "credentials");
  const scope = admin ? "/admin" : project ? `/projects/${project.id}` : "/me";
  const credentialsBase = `${scope}/service-connections/${summary.service_type}/${summary.id}/credentials`;
  async function refresh() {
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: ["service-directory"] }),
    ]);
  }
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <ServiceIcon type={summary.service_type} />
            {summary.name}
          </span>
        }
        description={
          <span className="inline-flex items-center gap-2">
            <span className="mono">{summary.code}</span>
            <CopyButton value={summary.code} label="复制连接编码" />
          </span>
        }
        actions={
          admin && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  void submission.run(async () => {
                    await request(providerPath, {
                      method: "PATCH",
                      etag: detail.data?.etag,
                      body: { enabled: !connection.enabled },
                    });
                    await refresh();
                  })
                }
              >
                {connection.enabled ? "停用连接" : "启用连接"}
              </Button>
              <Button variant="dangerSoft" onClick={() => setRemove(true)}>
                <Trash2 />
                删除连接
              </Button>
            </>
          )
        }
      />
      {connection.description && (
        <p className="-mt-3 mb-4 text-sm text-muted">
          {connection.description}
        </p>
      )}
      <ErrorNotice error={submission.error} />
      <Tabs
        label="连接功能"
        value={tab}
        onChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("tab", value);
            return next;
          })
        }
        items={[
          ...(admin ? [{ value: "config", label: "连接配置" }] : []),
          ...(capability?.credentials
            ? [{ value: "credentials", label: admin ? "系统凭证" : "访问凭证" }]
            : []),
          ...(admin && capability?.webhook.supported
            ? [{ value: "webhook", label: "Webhook 接收设置" }]
            : []),
        ]}
      />
      <div className="mt-5">
        {tab === "config" && admin && provider && (
          <ConnectionConfig
            connection={connection}
            provider={provider}
            etag={detail.data?.etag ?? ""}
            path={providerPath}
            edit={edit}
            onEdit={setEdit}
            onSaved={refresh}
          />
        )}
        {tab === "credentials" && provider && (
          <CredentialPanel
            base={credentialsBase}
            provider={provider}
            system={admin}
            fallbackPath={
              admin ? `${providerPath}/fallback-credential` : undefined
            }
            readonly={project?.status === "archived"}
          />
        )}
        {tab === "webhook" && capability && (
          <WebhookPanel
            base={`${providerPath}/webhook`}
            connectionEnabled={connection.enabled}
            methods={capability.webhook.verification_methods}
          />
        )}
      </div>
      <ConfirmDialog
        open={remove}
        danger
        title="删除服务连接"
        description={connection.name}
        confirmLabel="删除连接"
        pending={submission.pending}
        onClose={() => setRemove(false)}
        onConfirm={() =>
          void submission.run(async () => {
            await request(providerPath, {
              method: "DELETE",
              etag: detail.data?.etag,
            });
            window.location.assign("/admin/integrations");
          })
        }
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">
          仅当所有归属凭证与仓库引用已清空时可删除。Webhook
          设置和秘密一并删除，远端 Hook 需自行移除。
        </p>
      </ConfirmDialog>
    </div>
  );
}

function ConnectionConfig({
  connection,
  provider,
  etag,
  path,
  edit,
  onEdit,
  onSaved,
}: {
  connection: ServiceConnection;
  provider: ProviderDefinition;
  etag: string;
  path: string;
  edit: boolean;
  onEdit: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: connection.name,
    description: connection.description,
  });
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      provider.configFields.map((field) => {
        const value =
          connection.config?.[field.key as keyof typeof connection.config];
        return [
          field.key,
          typeof value === "number" || typeof value === "string"
            ? String(value)
            : "",
        ];
      }),
    ),
  );
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["connection-diagnostics", path],
    `${path}/diagnostics`,
  );
  const submission = useSubmission();
  const [current, setCurrent] = useState<Diagnostic | null>(null);
  const diagnostic = current ?? diagnostics.data?.data.latest ?? null;
  return (
    <div className="grid gap-5">
      <Panel
        title="连接配置"
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
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submission.run(async () => {
                await request(path, {
                  method: "PATCH",
                  etag,
                  body: {
                    name: form.name.trim(),
                    description: form.description,
                    config: provider.configBody(config),
                  },
                });
                onEdit(false);
                await onSaved();
              });
            }}
          >
            <ErrorNotice error={submission.error} />
            <div className="form-grid">
              <Field label="连接名称" required>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
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
              <ProviderConfigFields
                provider={provider}
                values={config}
                onChange={setConfig}
                errors={{}}
              />
            </div>
            <div className="form-actions">
              <Button variant="outline" onClick={() => onEdit(false)}>
                取消
              </Button>
              <Button type="submit" pending={submission.pending}>
                保存已修改配置
              </Button>
            </div>
          </form>
        ) : (
          <DescriptionList
            items={provider.configFields.map((field) => {
              const value =
                connection.config?.[
                  field.key as keyof typeof connection.config
                ];
              return {
                label: field.label,
                value:
                  field.key === "custom_ca_pem"
                    ? value
                      ? "已配置公共 CA"
                      : "使用系统信任"
                    : String(value ?? "未设置"),
                full: field.type === "textarea",
              };
            })}
          />
        )}
      </Panel>
      <Panel
        title="连接诊断"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!connection.enabled || edit}
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
            测试已保存的连接
          </Button>
        }
      >
        <ErrorNotice error={submission.error} />
        <AsyncBoundary
          loading={diagnostics.isPending}
          error={diagnostics.error}
          onRetry={() => void diagnostics.refetch()}
        >
          {diagnostic ? (
            <Notice tone={diagnosticTone(diagnostic)}>
              {diagnosticText(diagnostic)}
              <small className="mt-2 block">{diagnostic.finished_at}</small>
            </Notice>
          ) : (
            <p className="text-sm text-muted">
              尚无诊断记录。连接测试不携带凭证，不代表业务权限完整。
            </p>
          )}
        </AsyncBoundary>
      </Panel>
    </div>
  );
}
