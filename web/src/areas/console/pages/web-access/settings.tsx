import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Search,
  Settings2,
  Trash2,
  Plus,
} from "lucide-react";
import { request, type ApiResponse } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { Field, Input, Textarea } from "@/components/fields";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { useFormErrors } from "@/hooks/use-form";
import { useApiQuery } from "@/hooks/use-api";
import type {
  WebAccessProvider,
  WebAccessSettings,
  WebAccessState,
  WebOperation,
  WebRoute,
} from "@/types/agent-resources";
import { webAccessRoot, webAccessKeys } from "@/features/agents/data/agent-api";
import { useResourceSave } from "@/features/agents/resources/admin-shared";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import {
  capabilityLabel,
  stateReason,
  ProviderIcon,
} from "@/features/web-access/shared";

function useProviders(routes: WebRoute[]) {
  const ids = [
    ...new Set(
      routes
        .filter((route) => route.kind === "provider")
        .map((route) => route.id),
    ),
  ];
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...webAccessKeys, "provider", id],
      queryFn: () =>
        request<WebAccessProvider>(`${webAccessRoot}/providers/${id}`),
      retry: false,
    })),
  });
  return (id: string) => queries[ids.indexOf(id)];
}

function RouteIdentity({
  route,
  lookup,
}: {
  route: WebRoute;
  lookup: ReturnType<typeof useProviders>;
}) {
  const query = route.kind === "provider" ? lookup(route.id) : undefined;
  const provider = query?.data?.data;
  return (
    <>
      <ProviderIcon type={provider?.provider_type} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium wrap-anywhere">
          {route.kind === "builtin"
            ? "内置 HTTP 读取"
            : (provider?.name ?? `提供商 ${route.id}`)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {route.kind === "builtin"
            ? "内置读取"
            : provider
              ? `${provider.provider_type === "deepseek" ? "DeepSeek" : "智谱 GLM"}${provider.enabled ? "" : " · 已停用"}`
              : query?.isError
                ? "提供商信息读取失败"
                : "正在读取提供商信息"}
        </p>
      </div>
    </>
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1048576
    ? `${Number((bytes / 1048576).toFixed(3))} MiB`
    : `${Number((bytes / 1024).toFixed(3))} KiB`;
}

export function WebAccessSettings() {
  const query = useApiQuery<WebAccessSettings>(
    [...webAccessKeys, "settings"],
    `${webAccessRoot}/settings`,
  );
  const state = useApiQuery<WebAccessState>(
    [...webAccessKeys, "state"],
    `${webAccessRoot}/settings/state`,
  );
  const [editing, setEditing] = useState<{
    operation: WebOperation;
    trigger: HTMLElement;
  } | null>(null);
  const lookup = useProviders(
    query.data
      ? [...query.data.data.search.routes, ...query.data.data.fetch.routes]
      : [],
  );
  const cache = useQueryClient();
  return (
    <div className="web-access-settings">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">检索设置</h1>
        <p className="text-sm text-muted">
          全平台统一生效。优先使用默认提供商，明确失败后按顺序尝试备选。
        </p>
      </header>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (["search", "fetch"] as const).map((kind) => {
            const settings = query.data.data;
            const availability = state.data?.data[kind];
            const Icon = kind === "search" ? Search : FileText;
            return (
              <section
                key={kind}
                className="web-access-setting-card"
                aria-labelledby={`setting-${kind}`}
              >
                <header className="flex items-center gap-3">
                  <Icon aria-hidden className="size-5 text-muted" />
                  <h2
                    id={`setting-${kind}`}
                    className="text-base font-semibold"
                  >
                    {capabilityLabel[kind]}
                  </h2>
                  <StatusBadge
                    tone={availability?.available ? "success" : "neutral"}
                  >
                    {availability
                      ? availability.available
                        ? "配置可用"
                        : "当前不可用"
                      : "可用性待确认"}
                  </StatusBadge>
                  <Button
                    className="ml-auto"
                    variant="outline"
                    aria-label={`配置${capabilityLabel[kind]}`}
                    onClick={(event) =>
                      setEditing({
                        operation: kind,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    <Settings2 />
                    配置
                  </Button>
                </header>
                <div className="web-access-setting-body">
                  <div className="min-w-0">
                    <h3 className="mb-3 text-xs font-medium text-muted">
                      执行顺序
                    </h3>
                    {settings[kind].routes.length ? (
                      <ol className="web-access-route-overview">
                        {settings[kind].routes.map((route, index) => (
                          <li key={`${route.kind}:${route.id}`}>
                            <span className="web-access-route-position">
                              {index === 0 ? "默认" : `备选 ${index}`}
                            </span>
                            <RouteIdentity route={route} lookup={lookup} />
                            {availability?.routes.find(
                              (item) =>
                                item.route.kind === route.kind &&
                                item.route.id === route.id,
                            )?.reason && (
                              <span className="text-xs text-muted">
                                {stateReason[
                                  availability.routes.find(
                                    (item) =>
                                      item.route.kind === route.kind &&
                                      item.route.id === route.id,
                                  )!.reason!
                                ] ?? "当前不可用"}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="web-access-routes-empty">
                        尚未配置{capabilityLabel[kind]}
                        <span>
                          添加提供商{kind === "fetch" ? "或内置读取" : ""}
                          后即可使用。
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="web-access-limits-summary">
                    <h3 className="mb-3 text-xs font-medium text-muted">
                      调用限制
                    </h3>
                    <dl className="space-y-3 text-sm">
                      {kind === "search" ? (
                        <div>
                          <dt>搜索结果</dt>
                          <dd>最多 {settings.search.max_results} 条</dd>
                        </div>
                      ) : (
                        <>
                          <div>
                            <dt>内容上限</dt>
                            <dd title={`${settings.fetch.max_bytes} 字节`}>
                              {formatBytes(settings.fetch.max_bytes)}
                            </dd>
                          </div>
                          <div>
                            <dt>读取总期限</dt>
                            <dd>{settings.fetch.timeout_seconds} 秒</dd>
                          </div>
                          {settings.fetch.routes.some(
                            (route) => route.kind === "builtin",
                          ) && (
                            <>
                              <div>
                                <dt>重定向上限</dt>
                                <dd>{settings.fetch.max_redirects} 次</dd>
                              </div>
                              <div>
                                <dt>内网主机</dt>
                                <dd>
                                  {settings.fetch.allowed_internal_hosts.length
                                    ? `${settings.fetch.allowed_internal_hosts.length} 项允许`
                                    : "不允许访问"}
                                </dd>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </dl>
                  </div>
                </div>
              </section>
            );
          })}
      </AsyncBoundary>
      <ErrorNotice error={state.error} />
      {editing && (
        <SettingsLoader
          operation={editing.operation}
          trigger={editing.trigger}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void cache.invalidateQueries({ queryKey: webAccessKeys });
          }}
        />
      )}
    </div>
  );
}

function SettingsLoader({
  operation,
  trigger,
  onClose,
  onSaved,
}: {
  operation: WebOperation;
  trigger: HTMLElement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const query = useQuery({
    queryKey: [...webAccessKeys, "settings-editor", operation],
    queryFn: ({ signal }) =>
      request<WebAccessSettings>(`${webAccessRoot}/settings`, { signal }),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  if (query.data)
    return (
      <SettingsEditor
        initial={query.data}
        operation={operation}
        trigger={trigger}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Drawer
      open
      wide
      title={`配置${capabilityLabel[operation]}`}
      onClose={onClose}
      restoreFocusTo={trigger}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <span />
      </AsyncBoundary>
    </Drawer>
  );
}

function SettingsEditor({
  initial,
  operation,
  trigger,
  onClose,
  onSaved,
}: {
  initial: ApiResponse<WebAccessSettings>;
  operation: WebOperation;
  trigger: HTMLElement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial.data);
  const [baseline, setBaseline] = useState(initial.data);
  const [picker, setPicker] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const dirty =
    JSON.stringify(draft[operation]) !== JSON.stringify(baseline[operation]);
  const routes = draft[operation].routes;
  const lookup = useProviders(routes);
  const errors = useFormErrors();
  const save = useResourceSave({
    initial,
    path: `${webAccessRoot}/settings`,
    method: "PUT",
    dirty,
    showError: (error) => {
      setAdvanced(true);
      errors.show(error, [
        "search.max_results",
        "fetch.max_bytes",
        "fetch.timeout_seconds",
        "fetch.max_redirects",
        "fetch.allowed_internal_hosts",
      ]);
    },
    adopt: (value) => {
      setDraft(value);
      setBaseline(value);
      errors.clear();
    },
    // A settings PUT replaces both capabilities. Keep only this drawer's draft
    // when adopting a newer ETag so the other capability is never overwritten.
    rebase: (value) => {
      setDraft((current) => ({ ...value, [operation]: current[operation] }));
      setBaseline(value);
      errors.clear();
    },
    complete: onSaved,
  });
  const setRoutes = (next: WebRoute[]) =>
    setDraft({ ...draft, [operation]: { ...draft[operation], routes: next } });
  const move = (index: number, delta: number) => {
    const next = [...routes];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setRoutes(next);
  };
  return (
    <Drawer
      open
      wide
      title={`配置${capabilityLabel[operation]}`}
      description="更改对全平台生效，保存后应用。"
      onClose={onClose}
      restoreFocusTo={trigger}
      dirty={dirty}
      pending={save.pending}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form="web-access-settings-form"
            pending={save.pending}
            disabled={save.blocked || !dirty}
          >
            保存配置
          </Button>
        </>
      }
    >
      <form
        id="web-access-settings-form"
        ref={errors.formRef}
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !errors.validate(
              operation === "fetch" && !Number.isInteger(draft.fetch.max_bytes)
                ? { "fetch.max_bytes": "内容上限须对应整数个字节。" }
                : {},
            )
          )
            return;
          void save.save({
            search: draft.search,
            fetch: {
              ...draft.fetch,
              allowed_internal_hosts: draft.fetch.allowed_internal_hosts
                .map((host) => host.trim())
                .filter(Boolean),
            },
          });
        }}
      >
        {save.recovery}
        <fieldset disabled={save.pending || save.blocked} className="space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">执行顺序</h3>
              <p className="mt-1 text-xs text-muted">
                最多 3 项。默认项成功时立即返回，明确失败后尝试备选。
              </p>
            </div>
            {routes.length ? (
              <ol className="web-access-route-editor">
                {routes.map((route, index) => (
                  <li key={`${route.kind}:${route.id}`}>
                    <span className="web-access-route-position">
                      {index === 0 ? "默认" : `备选 ${index}`}
                    </span>
                    <RouteIdentity route={route} lookup={lookup} />
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label={`上移第 ${index + 1} 项`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp />
                      </IconButton>
                      <IconButton
                        label={`下移第 ${index + 1} 项`}
                        disabled={index === routes.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        label={`移除第 ${index + 1} 项`}
                        onClick={() =>
                          setRoutes(routes.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="web-access-routes-empty">
                尚未配置执行顺序
                <span>
                  请添加提供商{operation === "fetch" ? "或内置读取" : ""}。
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={routes.length >= 3}
                onClick={() => setPicker(true)}
              >
                <Plus />
                添加提供商
              </Button>
              {operation === "fetch" &&
                !routes.some((route) => route.kind === "builtin") && (
                  <Button
                    variant="ghost"
                    disabled={routes.length >= 3}
                    onClick={() =>
                      setRoutes([...routes, { kind: "builtin", id: "http" }])
                    }
                  >
                    <Plus />
                    添加内置 HTTP 读取
                  </Button>
                )}
            </div>
          </section>
          <section className="space-y-4 border-t pt-6">
            <h3 className="text-sm font-semibold">调用限制</h3>
            <div className="grid grid-cols-2 items-start gap-5">
              {operation === "search" ? (
                <Field
                  label="搜索结果数量"
                  error={errors.fields["search.max_results"]}
                  hint="每次搜索最多返回 1–20 条。"
                >
                  <Input
                    name="search.max_results"
                    type="number"
                    required
                    min={1}
                    max={20}
                    value={draft.search.max_results}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        search: {
                          ...draft.search,
                          max_results: Number(event.target.value),
                        },
                      })
                    }
                  />
                </Field>
              ) : (
                <>
                  <Field
                    label="网页内容上限（KiB）"
                    error={errors.fields["fetch.max_bytes"]}
                    hint="64–10,240 KiB，1,024 KiB = 1 MiB。"
                  >
                    <Input
                      name="fetch.max_bytes"
                      type="number"
                      required
                      min={64}
                      max={10240}
                      step="any"
                      value={draft.fetch.max_bytes / 1024}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          fetch: {
                            ...draft.fetch,
                            max_bytes: Number(event.target.value) * 1024,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="读取总期限（秒）"
                    error={errors.fields["fetch.timeout_seconds"]}
                    hint="一次读取的总时限，1–60 秒。"
                  >
                    <Input
                      name="fetch.timeout_seconds"
                      type="number"
                      required
                      min={1}
                      max={60}
                      value={draft.fetch.timeout_seconds}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          fetch: {
                            ...draft.fetch,
                            timeout_seconds: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                </>
              )}
            </div>
          </section>
          {operation === "fetch" &&
            routes.some((route) => route.kind === "builtin") && (
              <details
                className="border-t pt-5"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  高级设置 · 内置读取
                </summary>
                <div className="mt-5 space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <Field
                      label="HTTP 重定向上限"
                      error={errors.fields["fetch.max_redirects"]}
                      hint="最多 5 次，填 0 禁止重定向。"
                    >
                      <Input
                        name="fetch.max_redirects"
                        type="number"
                        required
                        min={0}
                        max={5}
                        value={draft.fetch.max_redirects}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fetch: {
                              ...draft.fetch,
                              max_redirects: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="允许访问的内网主机"
                    error={errors.fields["fetch.allowed_internal_hosts"]}
                    hint="每行一个精确主机名或 IP，最多 100 项；不支持通配符或 URL。留空禁止访问内网。"
                  >
                    <Textarea
                      name="fetch.allowed_internal_hosts"
                      rows={4}
                      value={draft.fetch.allowed_internal_hosts.join("\n")}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          fetch: {
                            ...draft.fetch,
                            allowed_internal_hosts:
                              event.target.value.split("\n"),
                          },
                        })
                      }
                    />
                  </Field>
                  <p className="text-xs text-muted">
                    仅作用于内置读取。第三方只接收公网初始地址，DNS
                    与重定向由提供商处理。
                  </p>
                </div>
              </details>
            )}
        </fieldset>
      </form>
      {picker && (
        <ResourcePicker<WebAccessProvider>
          title={`选择${capabilityLabel[operation]}提供商`}
          path={`${webAccessRoot}/providers?operation=${operation}&enabled=true`}
          identify={(item) => item.id}
          label={(item) => item.name}
          description={(item) => item.config.base_url}
          disabled={(item) =>
            routes.some(
              (route) => route.kind === "provider" && route.id === item.id,
            )
          }
          onChoose={(item) => {
            setRoutes([...routes, { kind: "provider", id: item.id }]);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </Drawer>
  );
}
