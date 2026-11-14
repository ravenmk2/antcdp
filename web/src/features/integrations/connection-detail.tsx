import { ApiError, isVersionConflict, request } from "@/api/client";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { DescriptionList, PageHeader, Panel, Tabs } from "@/components/layout";
import { OverlayPresence } from "@/components/overlay-presence";
import { ConfirmDialog } from "@/components/overlays";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import {
  diagnosticText,
  diagnosticTone,
  providerFor,
  type ProviderDefinition,
} from "@/domain/service-providers";
import { CredentialPanel } from "@/features/credentials/credential-panel";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { formatDate } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";
import type {
  Diagnostic,
  ServiceConnection,
  ServiceType,
} from "@/types/integrations";
import { useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  KeyRound,
  Pencil,
  Power,
  Settings2,
  Trash2,
  Webhook,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ConnectionEditor, IntegrationError } from "./connection-editor";
import { WebhookPanel } from "./webhook-panel";

export function ConnectionDetail({
  renderHeader,
  summary,
  admin,
  project,
  capabilities,
}: {
  renderHeader: (props: ComponentProps<typeof PageHeader>) => ReactNode;
  summary: ServiceConnection;
  admin: boolean;
  project?: Resource;
  capabilities: ServiceType[];
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [createdMessage, setCreatedMessage] = useState(
    Boolean(location.state?.connectionCreated),
  );
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState<unknown>(null);
  const attempted = useRef<"delete" | boolean | null>(null);
  const saving = useRef(false);
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const path = `/admin/service-connections/${summary.service_type}/${summary.id}`;
  const detail = useApiQuery<ServiceConnection>(
    ["connection", summary.id],
    path,
    { enabled: admin },
  );
  const connection = detail.data?.data ?? summary;
  const provider = providerFor(connection.service_type);
  const capability = capabilities.find(
    (item) => item.service_type === connection.service_type,
  );
  const tabs = [
    ...(admin
      ? [
          {
            value: "config",
            label: (
              <span className="inline-flex items-center gap-2">
                <Settings2 className="size-4" />
                连接配置
              </span>
            ),
          },
        ]
      : []),
    ...(capability?.credentials
      ? [
          {
            value: "credentials",
            label: (
              <span className="inline-flex items-center gap-2">
                <KeyRound className="size-4" />
                {admin ? "系统凭证" : "访问凭证"}
              </span>
            ),
          },
        ]
      : []),
    ...(admin && capability?.webhook.supported
      ? [
          {
            value: "webhook",
            label: (
              <span className="inline-flex items-center gap-2">
                <Webhook className="size-4" />
                Webhook 接收设置
              </span>
            ),
          },
        ]
      : []),
  ];
  const tab = tabs.some((item) => item.value === params.get("tab"))
    ? params.get("tab")!
    : tabs[0]?.value;
  const [webhookVisited, setWebhookVisited] = useState(tab === "webhook");
  useEffect(() => {
    if (tab === "webhook") setWebhookVisited(true);
  }, [tab]);
  const scope = admin ? "/admin" : project ? `/projects/${project.id}` : "/me";
  const credentialsBase = `${scope}/service-connections/${connection.service_type}/${connection.id}/credentials`;
  const busy = submission.pending || recovering;
  async function refresh() {
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: ["service-directory"] }),
      queryClient.invalidateQueries({
        queryKey: ["connection-diagnostics", path],
      }),
      queryClient.invalidateQueries({
        queryKey: ["webhook-diagnostics", `${path}/webhook`],
      }),
    ]);
  }
  function backToList() {
    const next = new URLSearchParams(params);
    next.delete("tab");
    next.delete("create");
    navigate(
      { pathname: "/admin/integrations", search: next.toString() },
      { replace: true },
    );
  }
  async function mutate(action: "delete" | boolean) {
    if (saving.current || busy || submission.uncertain || !detail.data?.etag)
      return;
    saving.current = true;
    attempted.current = action;
    setRecoveryMessage("");
    setRecoveryError(null);
    try {
      await submission.run(async () => {
        await request(path, {
          method: action === "delete" ? "DELETE" : "PATCH",
          etag: detail.data?.etag,
          ...(action === "delete" ? {} : { body: { enabled: action } }),
        });
        if (action === "delete") {
          await queryClient.invalidateQueries({
            queryKey: ["service-directory"],
          });
          backToList();
        } else await refresh();
      });
    } finally {
      saving.current = false;
    }
  }
  async function recover() {
    if (busy) return;
    setRecovering(true);
    setRecoveryError(null);
    try {
      const result = await request<ServiceConnection>(path);
      queryClient.setQueryData(["connection", summary.id], result);
      await refresh();
      if (
        !submission.uncertain ||
        (typeof attempted.current === "boolean" &&
          result.data.enabled === attempted.current)
      ) {
        submission.setError(null);
        setRecoveryMessage("已读取当前连接状态，请核对后继续操作。");
      } else
        setRecoveryMessage(
          "当前状态尚不能确认本次操作结果，请稍后再次核实；不会重复提交。",
        );
    } catch (error) {
      if (
        attempted.current === "delete" &&
        error instanceof ApiError &&
        error.status === 404
      ) {
        await queryClient.invalidateQueries({
          queryKey: ["service-directory"],
        });
        backToList();
      } else setRecoveryError(error);
    } finally {
      setRecovering(false);
    }
  }
  const recovery = (
    <>
      <IntegrationError error={submission.error} />
      {(submission.uncertain ||
        isVersionConflict(submission.error) ||
        !detail.data?.etag) && (
        <Button
          variant="outline"
          pending={recovering}
          onClick={() => void recover()}
        >
          {submission.uncertain ? "核实当前状态" : "重新加载连接"}
        </Button>
      )}
      {recoveryMessage && <Notice>{recoveryMessage}</Notice>}
      <IntegrationError error={recoveryError} />
    </>
  );
  if (admin && !detail.data)
    return (
      <>
        <AsyncBoundary
          loading={detail.isPending}
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      </>
    );
  return (
    <>
      {renderHeader({
        title: (
          <span className="flex min-w-0 flex-wrap items-center gap-3">
            {provider ? (
              <img
                src={`/service-icons/${connection.service_type}.svg`}
                alt=""
                className="size-7 shrink-0"
              />
            ) : (
              <Cable className="size-7 shrink-0" />
            )}
            <span className="min-w-0 break-all">{connection.name}</span>
            <StatusBadge tone={connection.enabled ? "success" : "neutral"}>
              {connection.enabled ? "已启用" : "已停用"}
            </StatusBadge>
          </span>
        ),
        actions: admin && (
          <RowActions
            label="连接"
            disabled={
              busy ||
              edit ||
              submission.uncertain ||
              !detail.data?.etag ||
              Boolean(detail.error)
            }
          >
            <RowAction
              icon={<Power />}
              onSelect={() => void mutate(!connection.enabled)}
            >
              {connection.enabled ? "停用连接" : "启用连接"}
            </RowAction>
            <RowActionSeparator />
            <RowAction
              icon={<Trash2 />}
              variant="destructive"
              onSelect={() => {
                submission.setError(null);
                setRecoveryMessage("");
                setRemove(true);
              }}
            >
              删除连接
            </RowAction>
          </RowActions>
        ),
      })}
      <div className="mb-5 grid gap-3 empty:hidden">
        {createdMessage && (
          <Notice
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreatedMessage(false);
                  void navigate(
                    { pathname: location.pathname, search: location.search },
                    { replace: true, state: null },
                  );
                }}
              >
                关闭提示
              </Button>
            }
          >
            连接已创建，创建成功不代表连接或身份已验证。
          </Notice>
        )}
        {!connection.enabled && (
          <Notice tone="warning">
            连接已停用，连接测试、凭证验证和 Webhook 接收暂停；配置仍可维护。
          </Notice>
        )}
        {!remove && admin && recovery}
        {detail.error && detail.data && (
          <div className="grid gap-3">
            <IntegrationError error={detail.error} />
            <Button
              variant="outline"
              pending={recovering}
              onClick={() => void recover()}
            >
              重新读取连接
            </Button>
          </div>
        )}
      </div>
      <Tabs
        label="连接功能"
        value={tab ?? ""}
        items={tabs}
        onChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set("tab", value);
            return next;
          })
        }
      />
      <div className="mt-5 min-w-0">
        {admin && provider && (
          <div hidden={tab !== "config"} role="tabpanel" aria-label="连接配置">
            <ConnectionConfig
              connection={connection}
              provider={provider}
              path={path}
              etag={detail.data?.etag ?? ""}
              edit={edit}
              onEdit={() => setEdit(true)}
              canTest={Boolean(capability?.connection_test)}
              onRefresh={refresh}
            />
          </div>
        )}
        {tab === "credentials" && capability?.credentials && provider && (
          <div role="tabpanel" aria-label={admin ? "系统凭证" : "访问凭证"}>
            <CredentialPanel
              base={credentialsBase}
              provider={provider}
              fallbackPath={admin ? `${path}/fallback-credential` : undefined}
              readonly={project?.status === "archived"}
            />
          </div>
        )}
        {admin &&
          capability?.webhook.supported &&
          (tab === "webhook" || webhookVisited) && (
            <div
              hidden={tab !== "webhook"}
              role="tabpanel"
              aria-label="Webhook 接收设置"
            >
              <WebhookPanel
                base={`${path}/webhook`}
                connectionEnabled={connection.enabled}
                methods={capability.webhook.verification_methods}
              />
            </div>
          )}
        {!tabs.length && <Notice>此服务当前没有可管理的凭证或配置。</Notice>}
      </div>
      <OverlayPresence>
        {edit && provider && (
          <ConnectionEditor
            path={path}
            provider={provider}
            onClose={() => setEdit(false)}
            onSaved={refresh}
          />
        )}
      </OverlayPresence>
      <ConfirmDialog
        open={remove}
        danger
        title="删除服务连接"
        description={connection.name}
        confirmLabel="删除连接"
        pending={busy}
        confirmDisabled={
          submission.uncertain ||
          !detail.data?.etag ||
          isVersionConflict(submission.error)
        }
        onClose={() => setRemove(false)}
        onConfirm={() => void mutate("delete")}
      >
        <div className="grid gap-3">
          {recovery}
          <p className="text-sm text-muted">
            仅当所有归属凭证与仓库引用已清空时可删除。Webhook
            设置和秘密一并删除，远端 Hook 需自行移除。
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}

function ConnectionConfig({
  connection,
  provider,
  path,
  etag,
  edit,
  onEdit,
  canTest,
  onRefresh,
}: {
  connection: ServiceConnection;
  provider: ProviderDefinition;
  path: string;
  etag: string;
  edit: boolean;
  onEdit: () => void;
  canTest: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { settings } = useAuth();
  // The resource version is part of the key so a changed config cannot show a
  // locally cached successful test as though it were still current.
  const diagnostics = useApiQuery<{ latest: Diagnostic | null }>(
    ["connection-diagnostics", path, etag],
    `${path}/diagnostics`,
  );
  const submission = useSubmission();
  const running = useRef(false);
  const [checking, setChecking] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [readError, setReadError] = useState<unknown>(null);
  const diagnostic = diagnostics.data?.data.latest;
  async function test() {
    if (
      running.current ||
      edit ||
      submission.pending ||
      submission.uncertain ||
      !etag ||
      !connection.enabled
    )
      return;
    running.current = true;
    setRecoveryMessage("");
    try {
      await submission.run(async () => {
        await request(`${path}/test`, { method: "POST", etag, body: {} });
        await diagnostics.refetch();
      });
    } finally {
      running.current = false;
    }
  }
  return (
    <div className="grid gap-5">
      <Panel
        title="连接资料"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!etag || edit}
            onClick={onEdit}
          >
            <Pencil />
            编辑配置
          </Button>
        }
      >
        <DescriptionList
          items={[
            {
              label: "连接名称",
              value: <span className="break-all">{connection.name}</span>,
            },
            {
              label: "连接编码",
              value: (
                <span className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 break-all">{connection.code}</code>
                  <CopyButton value={connection.code} label="复制连接编码" />
                </span>
              ),
            },
            ...provider.configFields.map((field) => {
              const value =
                connection.config?.[
                  field.key as keyof NonNullable<ServiceConnection["config"]>
                ];
              return {
                label: field.label.replace("（可选）", ""),
                value: (
                  <span className="break-all">
                    {field.key === "custom_ca_pem"
                      ? value
                        ? "已配置公共 CA"
                        : "使用系统信任"
                      : (field.options?.find((item) => item.value === value)
                          ?.label ?? String(value ?? "未设置"))}
                  </span>
                ),
                full: ["base_url", "host", "custom_ca_pem"].includes(field.key),
              };
            }),
            {
              label: "说明",
              value:
                connection.description.length > 200 ? (
                  <details className="group">
                    <summary className="cursor-pointer text-primary">
                      查看说明
                    </summary>
                    <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
                      {connection.description}
                    </div>
                  </details>
                ) : (
                  <div className="whitespace-pre-wrap break-words text-sm leading-6">
                    {connection.description || "未填写"}
                  </div>
                ),
              full: true,
            },
          ]}
        />
      </Panel>
      <Panel
        title="连接诊断"
        action={
          canTest && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                !connection.enabled ||
                edit ||
                !etag ||
                submission.uncertain ||
                checking
              }
              pending={submission.pending}
              onClick={() => void test()}
            >
              测试已保存的连接
            </Button>
          )
        }
      >
        <div className="grid gap-4">
          <p className="text-sm leading-6 text-muted">
            {provider.defaultPort
              ? "连接测试仅检查 TCP 端口可达性，不验证数据库服务、TLS 或身份。请在凭证中单独验证数据库访问。"
              : "连接测试不携带访问凭证；连接可达不代表身份认证或具体业务权限已通过。"}
          </p>
          <IntegrationError error={submission.error} />
          {(submission.uncertain ||
            isVersionConflict(submission.error) ||
            !etag) && (
            <Button
              variant="outline"
              pending={checking}
              onClick={() => {
                if (checking) return;
                setChecking(true);
                setReadError(null);
                void (async () => {
                  try {
                    await onRefresh();
                    const result = await diagnostics.refetch();
                    if (result.error) throw result.error;
                    if (!submission.uncertain) submission.setError(null);
                    else
                      setRecoveryMessage(
                        "已刷新最近诊断；无法据此确认本次请求是否已结束，请稍后查看。当前页面不会重放测试。",
                      );
                  } catch (error) {
                    setReadError(error);
                  } finally {
                    setChecking(false);
                  }
                })();
              }}
            >
              {submission.uncertain ? "查看当前诊断" : "重新加载连接"}
            </Button>
          )}
          {recoveryMessage && <Notice>{recoveryMessage}</Notice>}
          <IntegrationError error={readError} />
          <AsyncBoundary
            loading={diagnostics.isPending || diagnostics.isFetching}
            error={diagnostics.error}
            onRetry={() => void diagnostics.refetch()}
          >
            {diagnostic ? (
              <Notice tone={diagnosticTone(diagnostic)}>
                {diagnosticText(diagnostic)}
                <div className="mt-2 text-xs">
                  测试时间：
                  {formatDate(diagnostic.finished_at, settings.timezone)}
                </div>
              </Notice>
            ) : (
              <p className="text-sm text-muted">尚无诊断记录。</p>
            )}
          </AsyncBoundary>
        </div>
      </Panel>
    </div>
  );
}
