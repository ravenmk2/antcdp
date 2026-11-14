import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Type,
  Image,
  Wrench,
  Radio,
  Brain,
  ScanSearch,
  SlidersHorizontal,
  FlaskConical,
  KeyRound,
  Power,
  Trash2,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/button";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { ConfirmDialog } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { TableToolbar } from "@/components/table-toolbar";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import type {
  ModelProvider,
  ModelProviderSummary,
  ModelSummary,
  ModelDefinition,
  ModelCatalog,
  ProviderType,
} from "@/types/models";
import { modelKeys, modelRoot } from "@/features/models/model-api";
import {
  ModelProviderEditor,
  ModelProviderCreateDrawer,
  ModelAuthenticationEditor,
} from "@/features/models/provider-editor";
import { ModelEditor } from "@/features/models/model-editor";
import { ModelTestPanel } from "@/features/models/model-operations";
import { useModelWrite } from "@/features/models/model-write";
import {
  EnabledBadge,
  protocolNames,
  providerNames,
} from "@/features/models/model-shared";
import { ModelIcon } from "@/features/models/model-icon";

function queryNumber(value: string | null, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 1000000 ? n : fallback;
}
export function ModelProviderDetailPage() {
  return <ModelProvidersPage />;
}
export function ModelProvidersPage() {
  const { providerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const creating = location.pathname.endsWith("/new");
  const page = queryNumber(params.get("page"), 1);
  const q = params.get("q") || "";
  const kind = params.get("provider_type") || "all";
  const enabled = params.get("enabled") || "all";
  function change(values: Record<string, string>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(values)) {
          if (value && value !== "all") next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = new URLSearchParams({
    page: String(page),
    page_size: "20",
    ...(q ? { q } : {}),
    ...(kind !== "all" ? { provider_type: kind } : {}),
    ...(enabled !== "all" ? { enabled } : {}),
  });
  const providers = useApiQuery<ModelProviderSummary[]>(
    [...modelKeys, "providers", query.toString()],
    `${modelRoot}/providers?${query}`,
  );
  const catalog = useApiQuery<ModelCatalog>(
    [...modelKeys, "types"],
    `${modelRoot}/provider-types`,
  );
  const total = providers.data?.pagination?.total;
  useEffect(() => {
    if (total !== undefined && page > Math.max(1, Math.ceil(total / 20)))
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("page", String(Math.max(1, Math.ceil(total / 20))));
          return next;
        },
        { replace: true },
      );
  }, [total, page, setParams]);
  const selected =
    providerId ||
    (creating
      ? (location.state as { providerId?: string } | null)?.providerId
      : undefined) ||
    providers.data?.data[0]?.id;
  const suffix = params.size ? `?${params}` : "";
  return (
    <div className="model-management-page">
      <div className="model-workspace">
        <aside className="model-provider-list" aria-label="模型提供商">
          <div className="model-provider-list-tools">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                提供商{" "}
                <span className="ml-1 font-normal text-muted">
                  {total ?? ""}
                </span>
              </h2>
              <Button
                render={
                  <Link
                    to={`/admin/models/new${suffix}`}
                    state={{ providerId: selected }}
                  >
                    <Plus />
                    新建
                  </Link>
                }
                nativeButton={false}
                role="link"
                variant="ghost"
                size="sm"
              />
            </div>
            <StandaloneInput
              aria-label="搜索提供商"
              placeholder="搜索名称或编码"
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
              onCompositionStart={() => {
                search.composing.current = true;
              }}
              onCompositionEnd={search.compositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing)
                  search.submit();
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <StandaloneSelect
                className="w-full"
                aria-label="提供商类型"
                value={kind}
                onValueChange={(v) => change({ provider_type: v, page: "1" })}
              >
                <option value="all">全部类型</option>
                {Object.entries(providerNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </StandaloneSelect>
              <StandaloneSelect
                className="w-full"
                aria-label="提供商状态"
                value={enabled}
                onValueChange={(v) => change({ enabled: v, page: "1" })}
              >
                <option value="all">全部状态</option>
                <option value="true">已启用</option>
                <option value="false">已停用</option>
              </StandaloneSelect>
            </div>
          </div>
          <div className="model-provider-list-scroll">
            <AsyncBoundary
              loading={providers.isPending}
              error={providers.error}
              empty={providers.data?.data.length === 0}
              emptyTitle={
                q || kind !== "all" || enabled !== "all"
                  ? "没有匹配的提供商"
                  : "尚未添加提供商"
              }
              onRetry={() => void providers.refetch()}
            >
              <nav className="model-provider-items" aria-label="选择提供商">
                {providers.data?.data.map((item) => (
                  <Link
                    key={item.id}
                    to={`/admin/models/${item.id}${suffix}`}
                    aria-current={selected === item.id ? "page" : undefined}
                    className="model-provider-item"
                  >
                    <ModelIcon
                      icon={item.icon_key}
                      fallback={item.provider_type}
                      className="mt-1 size-8 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">
                        {item.name}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <EnabledBadge enabled={item.enabled} />
                        <span className="text-xs text-muted">
                          {item.model_count} 个模型
                        </span>
                      </span>
                    </span>
                  </Link>
                ))}
              </nav>
            </AsyncBoundary>
          </div>
          <div className="model-provider-list-footer">
            <span className="text-xs text-muted">
              第 {page} / {Math.max(1, Math.ceil((total ?? 0) / 20))} 页
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="上一页提供商"
                disabled={page <= 1 || providers.isFetching}
                onClick={() => change({ page: String(page - 1) })}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="下一页提供商"
                disabled={
                  total === undefined ||
                  page * 20 >= total ||
                  providers.isFetching
                }
                onClick={() => change({ page: String(page + 1) })}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </aside>
        <section className="model-workspace-content" aria-label="提供商详情">
          <AsyncBoundary
            loading={catalog.isPending}
            error={catalog.error}
            onRetry={() => void catalog.refetch()}
          >
            {selected && catalog.data ? (
              <ProviderContent
                key={selected}
                id={selected}
                catalog={catalog.data.data.items}
              />
            ) : (
              <div className="model-workspace-empty">
                <ScanSearch className="size-9 text-muted" />
                <h2 className="text-base font-medium">
                  添加提供商，开始配置模型
                </h2>
                <p className="text-sm text-muted">
                  连接模型服务后，可添加模型或发现远端模型。
                </p>
                <Button
                  render={
                    <Link to="/admin/models/new">
                      <Plus />
                      新建提供商
                    </Link>
                  }
                  nativeButton={false}
                  role="link"
                />
              </div>
            )}
          </AsyncBoundary>
        </section>
      </div>
      {creating && catalog.data && (
        <ModelProviderCreateDrawer
          catalog={catalog.data.data.items}
          onClose={() =>
            navigate(
              selected
                ? `/admin/models/${selected}${suffix}`
                : `/admin/models${suffix}`,
              { replace: true },
            )
          }
          onSaved={(provider) => {
            void client.invalidateQueries({ queryKey: modelKeys });
            navigate(`/admin/models/${provider.id}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function ProviderContent({
  id,
  catalog,
}: {
  id: string;
  catalog: ProviderType[];
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const provider = useApiQuery<ModelProvider>(
    [...modelKeys, "provider", id],
    `${modelRoot}/providers/${id}`,
  );
  const data = provider.data?.data;
  const type = catalog.find(
    (item) => item.provider_type === data?.provider_type,
  );
  const [editor, setEditor] = useState<"provider" | "authentication" | null>(
    null,
  );
  const [modelEditor, setModelEditor] = useState<{ id?: string } | null>(null);
  const [testing, setTesting] = useState<{
    kind: "provider" | "discovery" | "model";
    modelId?: string;
  } | null>(null);
  const [action, setAction] = useState<{
    kind: "toggle" | "delete";
    model?: ModelSummary;
    enabled: boolean;
  } | null>(null);
  function saved() {
    setEditor(null);
    setModelEditor(null);
    void client.invalidateQueries({ queryKey: modelKeys });
  }
  return (
    <AsyncBoundary
      loading={provider.isPending}
      error={provider.error}
      onRetry={() => void provider.refetch()}
    >
      {data && type && (
        <>
          <section className="model-detail-heading">
            <div className="flex min-w-0 items-center gap-3">
              <ModelIcon
                icon={data.icon_key}
                fallback={type.default_icon_key}
                className="size-10 shrink-0"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-semibold">
                  {data.name}
                </h1>
                <ProviderConnectionInfo provider={data} typeName={type.name} />
                {data.authentication.auth_method === "api_key" &&
                  !data.authentication.has_secret && (
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="warning">API Key 未配置</StatusBadge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditor("authentication")}
                      >
                        配置认证
                      </Button>
                    </div>
                  )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  !data.enabled ||
                  (data.authentication.auth_method === "api_key" &&
                    !data.authentication.has_secret)
                }
                onClick={() => setTesting({ kind: "provider" })}
              >
                <FlaskConical />
                测试连接
              </Button>
              <RowActions label={data.name}>
                <RowAction
                  icon={<SlidersHorizontal />}
                  onSelect={() => setEditor("provider")}
                >
                  连接设置
                </RowAction>
                <RowAction
                  icon={<KeyRound />}
                  onSelect={() => setEditor("authentication")}
                >
                  管理认证
                </RowAction>
                <RowAction
                  icon={<Power />}
                  onSelect={() =>
                    setAction({ kind: "toggle", enabled: !data.enabled })
                  }
                >
                  {data.enabled ? "停用提供商" : "启用提供商"}
                </RowAction>
                <RowActionSeparator />
                <RowAction
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={() => setAction({ kind: "delete", enabled: false })}
                >
                  删除提供商
                </RowAction>
              </RowActions>
            </div>
          </section>
          <ModelsTable
            providerId={id}
            provider={data}
            canCreate={type.protocols.some((item) => item.available)}
            onCreate={() => setModelEditor({})}
            onDetail={(modelId) => setModelEditor({ id: modelId })}
            onEdit={(modelId) => setModelEditor({ id: modelId })}
            onTest={(modelId) => setTesting({ kind: "model", modelId })}
            onAction={(model, kind) =>
              setAction({ kind, model, enabled: !model.enabled })
            }
            discovery={
              type.discovery_supported ? (
                <Button
                  variant="outline"
                  disabled={
                    !data.enabled ||
                    (data.authentication.auth_method === "api_key" &&
                      !data.authentication.has_secret)
                  }
                  onClick={() => setTesting({ kind: "discovery" })}
                >
                  <ScanSearch />
                  发现模型
                </Button>
              ) : undefined
            }
          />
          {editor === "provider" && (
            <ModelProviderEditor
              id={id}
              catalog={catalog}
              onClose={() => setEditor(null)}
              onSaved={saved}
            />
          )}
          {editor === "authentication" && (
            <ModelAuthenticationEditor
              provider={data}
              etag={provider.data!.etag}
              catalog={catalog}
              onClose={() => setEditor(null)}
              onSaved={saved}
            />
          )}
          {modelEditor && (
            <ModelEditor
              provider={data}
              type={type}
              id={modelEditor.id}
              onClose={() => setModelEditor(null)}
              onSaved={saved}
            />
          )}
          {testing && (
            <ModelTestPanel
              provider={data}
              providerEtag={provider.data!.etag}
              type={type}
              kind={testing.kind}
              modelId={testing.modelId}
              onClose={() => setTesting(null)}
            />
          )}
          {action && (
            <ModelActionDialog
              provider={data}
              model={action.model}
              action={action.kind}
              enabled={action.enabled}
              onClose={() => setAction(null)}
              onSaved={() => {
                setAction(null);
                void client.invalidateQueries({ queryKey: modelKeys });
                if (!action.model && action.kind === "delete")
                  navigate("/admin/models", { replace: true });
              }}
            />
          )}
        </>
      )}
    </AsyncBoundary>
  );
}

function ProviderConnectionInfo({
  provider,
  typeName,
}: {
  provider: ModelProvider;
  typeName: string;
}) {
  const rows = [
    ["提供商类型", typeName],
    [
      "认证状态",
      provider.authentication.auth_method === "none"
        ? "无需认证"
        : provider.authentication.has_secret
          ? "API Key 已配置"
          : "API Key 未配置",
    ],
    ["服务地址", provider.config.base_url],
    ["编码", provider.code],
    ["连接超时", `${provider.config.connect_timeout_seconds} 秒`],
    ["请求超时", `${provider.config.request_timeout_seconds} 秒`],
    ...(provider.config.region ? [["区域", provider.config.region]] : []),
  ];
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="iconSm" aria-label="连接信息">
              <Info aria-hidden />
            </Button>
          }
        />
        <TooltipContent
          side="bottom"
          align="start"
          className="w-96 max-w-[calc(100vw-32px)] max-h-80 overflow-auto p-4"
        >
          <p className="mb-3 text-sm font-semibold">连接信息</p>
          <dl className="space-y-2.5">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 leading-5"
              >
                <dt className="text-muted">{label}</dt>
                <dd
                  className={
                    label === "服务地址" || label === "编码"
                      ? "break-all font-mono"
                      : "break-words"
                  }
                >
                  {label === "认证状态" ? (
                    <StatusBadge
                      tone={
                        provider.authentication.auth_method === "none"
                          ? "neutral"
                          : provider.authentication.has_secret
                            ? "success"
                            : "warning"
                      }
                    >
                      {value}
                    </StatusBadge>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {provider.description && (
            <p className="mt-3 whitespace-pre-wrap break-words border-t border-border-subtle pt-3 leading-5 text-muted">
              {provider.description}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ModelActionDialog({
  provider,
  model,
  action,
  enabled,
  onClose,
  onSaved,
}: {
  provider: ModelProvider;
  model?: ModelSummary;
  action: "toggle" | "delete";
  enabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const path = model ? `/definitions/${model.id}` : `/providers/${provider.id}`;
  const current = useApiQuery<ModelProvider | ModelDefinition>(
    [...modelKeys, "action", path],
    `${modelRoot}${path}`,
  );
  const write = useModelWrite<unknown>();
  const label = action === "delete" ? "删除" : enabled ? "启用" : "停用";
  return (
    <ConfirmDialog
      open
      title={`${label}${model ? "模型" : "提供商"}`}
      description={`确认${label}“${model?.name ?? provider.name}”？${action === "delete" ? "此操作不可恢复；有业务引用时不能删除。" : enabled ? "启用不代表已经通过测试。" : "配置保留，停止发起新的调用。"}`}
      danger={action === "delete"}
      pending={write.pending}
      confirmDisabled={
        !current.data?.etag || current.isFetching || write.uncertain
      }
      confirmLabel={label}
      onClose={onClose}
      onConfirm={() =>
        write.run(
          path,
          {
            method: action === "delete" ? "DELETE" : "PATCH",
            etag: current.data!.etag,
            ...(action === "toggle" ? { body: { enabled } } : {}),
          },
          onSaved,
        )
      }
    >
      <ErrorNotice error={current.error} />
      {write.recovery}
      {current.error && (
        <Button variant="outline" onClick={() => void current.refetch()}>
          重新读取配置
        </Button>
      )}
    </ConfirmDialog>
  );
}

function ModelsTable({
  providerId,
  canCreate,
  onCreate,
  onDetail,
  onEdit,
  onTest,
  discovery,
  provider,
  onAction,
}: {
  providerId: string;
  canCreate: boolean;
  onCreate: () => void;
  onDetail: (id: string) => void;
  onEdit: (id: string) => void;
  onTest: (id: string) => void;
  discovery?: React.ReactNode;
  provider: ModelProvider;
  onAction: (model: ModelSummary, action: "toggle" | "delete") => void;
}) {
  const [filters, setFilters] = useState({
    q: "",
    enabled: "all",
    protocol: "all",
    page: 1,
    size: 20,
  });
  const search = useDebouncedSearch(filters.q, (q) =>
    setFilters((current) => ({ ...current, q, page: 1 })),
  );
  const params = new URLSearchParams({
    provider_id: providerId,
    page: String(filters.page),
    page_size: String(filters.size),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.enabled !== "all" ? { enabled: filters.enabled } : {}),
    ...(filters.protocol !== "all" ? { protocol: filters.protocol } : {}),
  });
  const query = useApiQuery<ModelSummary[]>(
    [...modelKeys, "definitions", params.toString()],
    `${modelRoot}/definitions?${params}`,
  );
  const total = query.data?.pagination?.total;
  useEffect(() => {
    if (total === undefined) return;
    const lastPage = Math.max(1, Math.ceil(total / filters.size));
    if (filters.page > lastPage)
      setFilters((current) => ({ ...current, page: lastPage }));
  }, [total, filters.page, filters.size]);
  return (
    <Panel title="模型" className="model-definitions-panel" bodyClassName="p-0">
      <TableToolbar
        onReset={() =>
          setFilters({
            q: "",
            enabled: "all",
            protocol: "all",
            page: 1,
            size: 20,
          })
        }
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
        actions={
          <>
            {discovery}
            <Button disabled={!canCreate} onClick={onCreate}>
              <Plus />
              添加模型
            </Button>
          </>
        }
      >
        <StandaloneInput
          aria-label="搜索模型"
          placeholder="搜索名称或模型 ID"
          value={search.value}
          onChange={(e) => search.setValue(e.target.value)}
          onCompositionStart={() => {
            search.composing.current = true;
          }}
          onCompositionEnd={search.compositionEnd}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing)
              search.submit();
          }}
        />
        <StandaloneSelect
          aria-label="模型状态"
          value={filters.enabled}
          onValueChange={(enabled) =>
            setFilters((current) => ({ ...current, enabled, page: 1 }))
          }
        >
          <option value="all">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已停用</option>
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="模型协议"
          value={filters.protocol}
          onValueChange={(protocol) =>
            setFilters((current) => ({ ...current, protocol, page: 1 }))
          }
        >
          <option value="all">全部协议</option>
          {Object.entries(protocolNames).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </StandaloneSelect>
      </TableToolbar>
      {!canCreate && (
        <div className="px-4">
          <Notice tone="warning">
            此提供商当前没有可用的模型协议，暂不能添加模型。
          </Notice>
        </div>
      )}
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        empty={query.data?.data.length === 0}
        emptyTitle={
          filters.q || filters.enabled !== "all" || filters.protocol !== "all"
            ? "暂无匹配的模型"
            : "尚未添加模型"
        }
        emptyDescription="可手动添加模型，或在支持时发现远端模型后逐项配置。"
        onRetry={() => void query.refetch()}
      >
        <SimpleTable
          label="模型列表"
          className="model-definitions-table"
          headers={["模型", "协议", "已开启能力", "启用状态", "操作"]}
          actions
        >
          {query.data?.data.map((model) => (
            <tr key={model.id}>
              <td className="max-w-96">
                <div className="flex items-start gap-3">
                  <ModelIcon
                    icon={model.icon_key}
                    fallback={provider.icon_key || provider.provider_type}
                    className="mt-1 size-7 shrink-0"
                  />
                  <div className="min-w-0">
                    <button
                      className="model-definition-name text-left font-medium text-foreground hover:underline"
                      title={model.name}
                      onClick={() => onDetail(model.id)}
                    >
                      {model.name}
                    </button>
                    <p
                      className="model-remote-id mt-1 font-mono text-xs text-muted"
                      title={model.model_id}
                    >
                      {model.model_id}
                    </p>
                  </div>
                </div>
              </td>
              <td className="text-muted">{protocolNames[model.protocol]}</td>
              <td>
                <TooltipProvider delay={200}>
                  <div
                    className="flex items-center gap-3 text-muted"
                    aria-label="已开启能力"
                  >
                    {(
                      [
                        ["text_input", "文本输入", Type],
                        ["image_input", "图像输入", Image],
                        ["tool_calling", "工具调用", Wrench],
                        ["streaming", "流式输出", Radio],
                        ["thinking", "思考", Brain],
                      ] as const
                    )
                      .filter(
                        ([key]) =>
                          model.declared_capabilities[key] === "supported",
                      )
                      .map(([key, label, Icon]) => (
                        <Tooltip key={key}>
                          <TooltipTrigger
                            render={
                              <span
                                role="img"
                                aria-label={label}
                                tabIndex={0}
                                className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                              >
                                <Icon className="size-4" aria-hidden />
                              </span>
                            }
                          />
                          <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                      ))}
                    {!Object.values(model.declared_capabilities).includes(
                      "supported",
                    ) && <span className="sr-only">未开启能力</span>}
                  </div>
                </TooltipProvider>
              </td>
              <td>
                <EnabledBadge enabled={model.enabled} />
              </td>
              <td>
                <RowActions label={model.name}>
                  <RowAction
                    icon={<Pencil />}
                    onSelect={() => onEdit(model.id)}
                  >
                    编辑
                  </RowAction>
                  <RowAction
                    icon={<FlaskConical />}
                    disabled={!model.enabled || !provider.enabled}
                    onSelect={() => onTest(model.id)}
                  >
                    测试
                  </RowAction>
                  <RowAction
                    icon={<Power />}
                    onSelect={() => onAction(model, "toggle")}
                  >
                    {model.enabled ? "停用模型" : "启用模型"}
                  </RowAction>
                  <RowActionSeparator />
                  <RowAction
                    icon={<Trash2 />}
                    variant="destructive"
                    onSelect={() => onAction(model, "delete")}
                  >
                    删除模型
                  </RowAction>
                </RowActions>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      <Pagination
        page={filters.page}
        size={filters.size}
        total={query.data?.pagination?.total}
        pending={query.isFetching}
        onChange={(page, size) =>
          setFilters((current) => ({ ...current, page, size }))
        }
      />
    </Panel>
  );
}
