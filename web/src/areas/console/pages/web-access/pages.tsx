import { WebAccessSettings as SettingsView } from "@/areas/console/pages/web-access/settings";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, StatusBadge } from "@/components/feedback";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { RowAction, RowActions } from "@/components/row-actions";
import { webAccessRoot } from "@/features/agents/data/agent-api";
import { webAccessKeys, webRequest } from "@/features/web-access/api";
import {
  AuthenticationEditor,
  DeleteProvider,
  ProviderEditor,
} from "@/features/web-access/editors";
import {
  capabilityLabel,
  ProviderIcon,
  WebDiagnosticView,
  type WebDiagnostic,
} from "@/features/web-access/shared";
import { TestPanel } from "@/features/web-access/test-panel";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import type {
  WebAccessCatalog,
  WebAccessProvider,
  WebAccessSettings,
} from "@/types/agent-resources";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Globe,
  KeyRound,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

export function WebAccessPage() {
  const [params] = useSearchParams();
  return <WebAccessWorkspace settings={params.get("view") === "settings"} />;
}
export function WebAccessSettingsPage() {
  return <WebAccessWorkspace settings />;
}
export function WebAccessDetailPage() {
  return <WebAccessWorkspace />;
}
export function WebAccessCreatePage() {
  return <WebAccessWorkspace creating />;
}

function WebAccessWorkspace({
  settings = false,
  creating = false,
}: {
  settings?: boolean;
  creating?: boolean;
}) {
  const { providerId } = useParams();
  const location = useLocation();
  const createLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!creating && location.state?.restoreCreateFocus)
      createLink.current?.focus();
  }, [creating, location.key, location.state]);
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const origin = creating
    ? (location.state as { providerId?: string; settings?: boolean } | null)
    : null;
  const showSettings = settings || Boolean(origin?.settings);
  const q = params.get("q") ?? "";
  const kind = params.get("provider_type") ?? "all";
  const enabled = params.get("enabled") ?? "all";
  const rawPage = Number(params.get("page"));
  const page =
    Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1000000
      ? rawPage
      : 1;
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
  const filter = new URLSearchParams({ page: String(page), page_size: "20" });
  if (q) filter.set("q", q);
  if (kind !== "all") filter.set("provider_type", kind);
  if (enabled !== "all") filter.set("enabled", enabled);
  const list = useApiQuery<WebAccessProvider[]>(
    [...webAccessKeys, "list", filter.toString()],
    webAccessRoot + "/providers?" + filter,
  );
  const catalog = useApiQuery<WebAccessCatalog>(
    [...webAccessKeys, "types"],
    webAccessRoot + "/provider-types",
  );
  const selected = showSettings
    ? undefined
    : (providerId ?? origin?.providerId ?? list.data?.data[0]?.id);
  const total = list.data?.pagination?.total;
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / 20));
  useEffect(() => {
    if (total !== undefined && page > lastPage)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("page", String(lastPage));
          return next;
        },
        { replace: true },
      );
  }, [total, page, lastPage, setParams]);
  const suffix =
    "?" +
    new URLSearchParams({ ...Object.fromEntries(params), view: "providers" });
  const settingsPath = "/admin/web-access/settings" + suffix;
  function refresh() {
    void cache.invalidateQueries({ queryKey: webAccessKeys });
    void cache.invalidateQueries({ queryKey: ["agent-resources"] });
  }
  return (
    <div className="web-access-workspace">
      <aside className="web-access-sidebar" aria-label="网络检索导航">
        <div className="web-access-sidebar-tools">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              提供商{" "}
              <span className="ml-1 font-normal text-muted">{total ?? ""}</span>
            </h2>
            <div className="flex items-center gap-1">
              <Button
                render={
                  <Link
                    ref={createLink}
                    to={"/admin/web-access/new" + suffix}
                    state={{ providerId: selected, settings: showSettings }}
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
              <IconButton
                render={
                  <Link
                    to={settingsPath}
                    aria-current={showSettings ? "page" : undefined}
                  >
                    <Settings aria-hidden />
                  </Link>
                }
                size="iconSm"
                label="检索设置"
                className={
                  showSettings
                    ? "bg-accent-soft text-primary hover:bg-accent-soft"
                    : undefined
                }
              />
            </div>
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
              className="min-w-0 w-full"
              aria-label="提供商类型"
              value={kind}
              onValueChange={(v) => change({ provider_type: v, page: "1" })}
            >
              <option value="all">全部类型</option>
              {catalog.data?.data.items.map((t) => (
                <option key={t.provider_type} value={t.provider_type}>
                  {t.name}
                </option>
              ))}
            </StandaloneSelect>
            <StandaloneSelect
              className="min-w-0 w-full"
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
        <div className="web-access-sidebar-scroll">
          <AsyncBoundary
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          >
            {list.data?.data.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                {q || kind !== "all" || enabled !== "all"
                  ? "没有匹配的提供商"
                  : "尚未添加提供商"}
              </p>
            ) : (
              <nav
                className="web-access-provider-items"
                aria-label="选择提供商"
              >
                {list.data?.data.map((p) => (
                  <Link
                    key={p.id}
                    to={"/admin/web-access/" + p.id + suffix}
                    aria-current={selected === p.id ? "page" : undefined}
                    className="web-access-nav-item"
                  >
                    <ProviderIcon type={p.provider_type} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-5 font-medium wrap-anywhere">
                        {p.name}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="text-xs text-muted">
                          {catalog.data?.data.items.find(
                            (t) => t.provider_type === p.provider_type,
                          )?.name ?? p.provider_type}
                        </span>
                        <span
                          className={`shrink-0 text-xs ${p.enabled ? "text-success" : "text-muted"}`}
                        >
                          {p.enabled ? "已启用" : "已停用"}
                        </span>
                      </span>
                    </span>
                  </Link>
                ))}
              </nav>
            )}
          </AsyncBoundary>
        </div>
        <div className="web-access-sidebar-footer">
          <span className="text-xs text-muted">
            第 {page} / {lastPage} 页
          </span>
          <div className="flex gap-1">
            <Button
              size="iconSm"
              variant="ghost"
              aria-label="上一页提供商"
              disabled={page <= 1 || list.isFetching}
              onClick={() => change({ page: String(page - 1) })}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label="下一页提供商"
              disabled={
                total === undefined || page >= lastPage || list.isFetching
              }
              onClick={() => change({ page: String(page + 1) })}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </aside>
      <section
        className="web-access-content"
        aria-label={showSettings ? "检索设置" : "提供商详情"}
      >
        {showSettings ? (
          <SettingsView />
        ) : (
          <AsyncBoundary
            loading={catalog.isPending || (!selected && list.isPending)}
            error={catalog.error || (!selected ? list.error : undefined)}
            onRetry={() => {
              void catalog.refetch();
              void list.refetch();
            }}
          >
            {selected && catalog.data ? (
              <ProviderDetail
                key={selected}
                id={selected}
                catalog={catalog.data.data}
                onSaved={refresh}
              />
            ) : (
              <div className="web-access-empty">
                <Globe className="size-9 text-muted" />
                <h1 className="text-lg font-medium">连接搜索与网页读取服务</h1>
                <p className="max-w-md text-sm text-muted">
                  添加 DeepSeek 或 GLM 提供商后，在检索设置中选择使用顺序。内置
                  HTTP 读取可直接在网页读取路由中添加。
                </p>
                <Button
                  render={
                    <Link to={"/admin/web-access/new" + suffix}>
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
        )}
      </section>
      {creating && catalog.data && (
        <ProviderEditor
          catalog={catalog.data.data}
          onClose={() =>
            navigate(
              showSettings
                ? settingsPath
                : selected
                  ? "/admin/web-access/" + selected + suffix
                  : "/admin/web-access" + suffix,
              { replace: true, state: { restoreCreateFocus: true } },
            )
          }
          onSaved={(p) => {
            refresh();
            navigate("/admin/web-access/" + p.id + suffix, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function ProviderDetail({
  id,
  catalog,
  onSaved,
}: {
  id: string;
  catalog: WebAccessCatalog;
  onSaved: () => void;
}) {
  const query = useApiQuery<WebAccessProvider>(
    [...webAccessKeys, "provider", id],
    `${webAccessRoot}/providers/${id}`,
  );
  const settings = useApiQuery<WebAccessSettings>(
    [...webAccessKeys, "settings"],
    `${webAccessRoot}/settings`,
  );
  const navigate = useNavigate();
  const [editor, setEditor] = useState<
    "provider" | "auth" | "delete" | "test" | null
  >(null);
  const p = query.data?.data;
  const diagnostics = useQueries({
    queries: (p?.supported_operations ?? []).map((operation) => ({
      queryKey: [...webAccessKeys, id, "diagnostics", operation],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        webRequest<{ latest: WebDiagnostic | null }>(
          `/providers/${id}/diagnostics?operation=${operation}`,
          { signal },
        ),
      retry: false,
    })),
  });
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {p && query.data && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h1 className="break-words text-xl font-semibold">{p.name}</h1>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={p.enabled ? "success" : "neutral"}>
                  {p.enabled ? "已启用" : "已停用"}
                </StatusBadge>
                <StatusBadge
                  tone={p.authentication.has_secret ? "neutral" : "warning"}
                >
                  {p.authentication.has_secret
                    ? "已配置 API Key"
                    : "API Key 未配置"}
                </StatusBadge>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                disabled={!p.enabled || !p.authentication.has_secret}
                onClick={() => setEditor("test")}
              >
                <FlaskConical />
                测试连接
              </Button>
              <RowActions label={p.name}>
                <RowAction
                  icon={<Settings2 />}
                  onSelect={() => setEditor("provider")}
                >
                  提供商设置
                </RowAction>
                <RowAction
                  icon={<KeyRound />}
                  onSelect={() => setEditor("auth")}
                >
                  管理认证
                </RowAction>
                <RowAction
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={() => setEditor("delete")}
                >
                  删除提供商
                </RowAction>
              </RowActions>
            </div>
          </div>
          <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">服务地址</dt>
            <dd className="break-all select-text">{p.config.base_url}</dd>
            <dt className="text-muted">服务类型</dt>
            <dd>
              {catalog.items.find((t) => t.provider_type === p.provider_type)
                ?.name ?? p.provider_type}{" "}
              · {p.config.timeout_seconds} 秒超时
            </dd>
            <dt className="text-muted">提供商编码</dt>
            <dd className="break-all select-text">{p.code}</dd>
            {p.description && (
              <>
                <dt className="text-muted">说明</dt>
                <dd className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                  {p.description}
                </dd>
              </>
            )}
          </dl>
          <div className="border-t pt-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">能力与最近诊断</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSaved();
                }}
              >
                <RefreshCw />
                刷新结果
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
              {p.supported_operations.map((operation, index) => {
                const position = settings.data?.data[
                  operation
                ].routes.findIndex((r) => r.kind === "provider" && r.id === id);
                return (
                  <section
                    key={operation}
                    className="min-w-0 rounded-lg border p-4"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">
                        {capabilityLabel[operation]}
                      </h4>
                      <span className="text-xs text-muted">
                        {position === undefined
                          ? "路由信息未加载"
                          : position < 0
                            ? "未加入全平台路由"
                            : position === 0
                              ? "默认路由"
                              : `备选 ${position}`}
                      </span>
                    </div>
                    <AsyncBoundary
                      loading={diagnostics[index].isPending}
                      error={diagnostics[index].error}
                      onRetry={() => void diagnostics[index].refetch()}
                    >
                      <WebDiagnosticView
                        value={diagnostics[index].data?.data.latest ?? null}
                      />
                    </AsyncBoundary>
                  </section>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-muted">
              最近结果仅代表受测时的配置与输入，不保证后续所有请求成功。
            </p>
          </div>
          {editor === "provider" && (
            <ProviderEditor
              initial={query.data}
              catalog={catalog}
              onClose={() => setEditor(null)}
              onSaved={() => {
                setEditor(null);
                onSaved();
              }}
            />
          )}
          {editor === "auth" && (
            <AuthenticationEditor
              initial={query.data}
              onClose={() => setEditor(null)}
              onSaved={onSaved}
            />
          )}{" "}
          {editor === "delete" && (
            <DeleteProvider
              initial={query.data}
              onClose={() => setEditor(null)}
              onDeleted={() => {
                onSaved();
                navigate("/admin/web-access?view=providers", {
                  replace: true,
                });
              }}
            />
          )}
          {editor === "test" && (
            <TestPanel
              provider={p}
              onClose={() => {
                setEditor(null);
                onSaved();
              }}
            />
          )}
        </div>
      )}
    </AsyncBoundary>
  );
}
