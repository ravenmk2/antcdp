import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Play, RotateCcw } from "lucide-react";
import { isUncertain, request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Field, Input, StandaloneSelect } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { WizardSteps } from "@/components/wizard";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { deliveryLabel, reasonLabel, resultTone } from "@/domain/labels";
import { creationItemCanRetry } from "@/domain/delivery-rules";
import { formatDate, uuid } from "@/lib/utils";
import type { Resource } from "@/types/collaboration";
import type {
  Creation,
  CreationItem,
  Page,
  ScopedRepository,
  Variant,
} from "@/types/delivery";

export function BranchCreations({
  project,
  variant,
}: {
  project: Resource;
  variant: Variant;
}) {
  const [params] = useSearchParams();
  const create = params.get("create") === "1";
  const creation = params.get("creation");
  if (create)
    return (
      <CreationWizard
        key={params.get("retry") ?? "new"}
        project={project}
        variant={variant}
        retryOf={params.get("retry") ?? ""}
      />
    );
  if (creation)
    return <CreationDetail project={project} variant={variant} id={creation} />;
  return <CreationHistory project={project} variant={variant} />;
}

function CreationHistory({
  project,
  variant,
}: {
  project: Resource;
  variant: Variant;
}) {
  const [, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [status, setStatus] = useState("all");
  const list = useApiQuery<Page<Creation>>(
    ["branch-creations", project.id, variant.id, page, size, status],
    `/projects/${project.id}/branch-creations?${new URLSearchParams({ variant_id: variant.id, page: String(page), page_size: String(size), status })}`,
  );
  return (
    <Panel
      title="主干 Git 分支创建记录"
      action={
        <Button
          disabled={!variant.can_manage}
          onClick={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("create", "1");
              return next;
            })
          }
        >
          新建创建计划
        </Button>
      }
    >
      <div className="mb-4 flex justify-end">
        <StandaloneSelect
          aria-label="创建批次状态"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          {[
            "all",
            "prepared",
            "executing",
            "completed",
            "partial",
            "failed",
            "interrupted",
          ].map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "全部状态" : deliveryLabel(value)}
            </option>
          ))}
        </StandaloneSelect>
      </div>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!list.data?.data.items.length}
        emptyTitle="暂无创建记录"
      >
        <SimpleTable
          label="分支创建记录"
          headers={["目标分支", "来源", "状态", "逐项计数", "创建时间", "操作"]}
        >
          {list.data?.data.items.map((creation) => (
            <tr key={creation.id}>
              <td className="mono">{creation.target_branch}</td>
              <td className="mono">{creation.default_source_branch}</td>
              <td>
                <StatusBadge tone={resultTone(creation.status)}>
                  {deliveryLabel(creation.status)}
                  {creation.expired ? " · 已过期" : ""}
                </StatusBadge>
              </td>
              <td className="text-xs">
                {Object.entries(creation.counts)
                  .map(([key, value]) => `${deliveryLabel(key)} ${value}`)
                  .join(" · ") || "—"}
              </td>
              <td className="text-xs text-muted">
                {formatDate(creation.created_at)}
              </td>
              <td>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set("creation", creation.id);
                      return next;
                    })
                  }
                >
                  查看
                </Button>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
      {list.data && (
        <Pagination
          page={page}
          size={size}
          total={list.data.data.total}
          onChange={(nextPage, nextSize) => {
            setPage(nextPage);
            setSize(nextSize);
          }}
        />
      )}
    </Panel>
  );
}

function CreationWizard({
  project,
  variant,
  retryOf,
}: {
  project: Resource;
  variant: Variant;
  retryOf: string;
}) {
  const [, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const oldItems = useApiQuery<Page<CreationItem>>(
    ["creation-retry-items", project.id, retryOf],
    `/projects/${project.id}/branch-creations/${retryOf}/items?page=1&page_size=100`,
    { enabled: Boolean(retryOf) },
  );
  const repositories = useApiQuery<Page<ScopedRepository>>(
    ["creation-scope", project.id, variant.id],
    `/projects/${project.id}/variants/${variant.id}/repositories?page=1&page_size=100`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState("main");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [idempotency, setIdempotency] = useState(uuid);
  const [plan, setPlan] = useState<Creation | null>(null);
  const [planEtag, setPlanEtag] = useState("");
  const [actions, setActions] = useState<Record<string, string>>({});
  const [unknown, setUnknown] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const rows = useMemo(
    () =>
      repositories.data?.data.items.filter(
        (repo) =>
          !retryOf ||
          oldItems.data?.data.items.some(
            (item) =>
              item.repository_id === repo.id && creationItemCanRetry(item),
          ),
      ) ?? [],
    [repositories.data, oldItems.data, retryOf],
  );
  const items = useApiQuery<Page<CreationItem>>(
    ["creation-items", project.id, plan?.id],
    `/projects/${project.id}/branch-creations/${plan?.id ?? ""}/items?page=1&page_size=100`,
    { enabled: Boolean(plan) },
  );
  function close() {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("create");
      next.delete("retry");
      next.set("vview", "creations");
      return next;
    });
  }
  function changeDraft() {
    setIdempotency(uuid());
    setUnknown(false);
  }
  async function prepare() {
    const fields: Record<string, string> = {};
    if (!selected.length) fields.repository_ids = "请选择至少一个仓库";
    if (!source) fields.default_source_branch = "请输入默认来源分支";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        const response = await request<Creation>(
          `/projects/${project.id}/variants/${variant.id}/branch-creations`,
          {
            method: "POST",
            etag: variant.etag,
            idempotencyKey: idempotency,
            body: {
              repository_ids: selected,
              default_source_branch: source,
              source_overrides: Object.entries(overrides)
                .filter(([, source_branch]) => source_branch)
                .map(([repository_id, source_branch]) => ({
                  repository_id,
                  source_branch,
                })),
              scope_token: repositories.data?.data.scope_token ?? "",
              ...(retryOf ? { retry_of_id: retryOf } : {}),
            },
          },
        );
        setPlan(response.data);
        setPlanEtag(response.etag);
        setStep(1);
      },
      (error) =>
        errors.show(error, [
          "repository_ids",
          "default_source_branch",
          "source_overrides",
        ]),
    );
  }
  async function execute() {
    if (!plan || !items.data) return;
    const completeActions = Object.fromEntries(
      items.data.data.items.map((item) => [
        item.id,
        actions[item.id] ??
          (item.preview_state === "ready"
            ? "create"
            : item.preview_state === "existing"
              ? "use_existing"
              : "skip"),
      ]),
    );
    if (Object.values(completeActions).every((action) => action === "skip")) {
      errors.setError("不能跳过全部项目，请至少选择一项创建或采用。");
      return;
    }
    await submission.run(
      async () => {
        await request(
          `/projects/${project.id}/branch-creations/${plan.id}/execute`,
          {
            method: "POST",
            etag: planEtag,
            body: {
              items: Object.entries(completeActions).map(([id, action]) => ({
                id,
                action,
              })),
            },
          },
        );
        await queryClient.invalidateQueries({
          queryKey: ["creation-items", project.id, plan.id],
        });
        await queryClient.invalidateQueries({
          queryKey: ["branch-creations", project.id],
        });
        setStep(2);
      },
      (error) => {
        if (isUncertain(error)) setUnknown(true);
      },
    );
  }
  return (
    <div>
      <PageHeader
        title={retryOf ? "基于历史结果重新预览" : "创建主干 Git 分支"}
        description={`${variant.name} · 目标固定为 ${variant.main_branch}`}
        actions={
          <Button variant="outline" onClick={close}>
            <ArrowLeft />
            返回创建记录
          </Button>
        }
      />
      <WizardSteps
        steps={["选择仓库与来源", "预览并确认执行", "结果与核实"]}
        current={step}
      />
      <Panel className="mt-5">
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {unknown && (
          <Notice tone="warning" title="执行结果未知" className="mb-4">
            请不要重发执行请求。返回记录并读取批次与逐项状态；未知项只能先只读核实。
          </Notice>
        )}
        {step === 0 && (
          <>
            <Notice className="mb-4">
              准备只读取远端并冻结来源提交，不创建分支。目标已存在时必须显式选择“采用既有分支”。
            </Notice>
            <Field
              label="默认来源分支"
              required
              error={errors.fields.default_source_branch}
            >
              <Input
                name="default_source_branch"
                className="mono"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  changeDraft();
                }}
              />
            </Field>
            <div className="mt-5">
              <AsyncBoundary
                loading={
                  repositories.isPending ||
                  (Boolean(retryOf) && oldItems.isPending)
                }
                error={repositories.error ?? oldItems.error}
                empty={!rows.length}
                emptyTitle={
                  retryOf ? "没有符合重试条件的项目" : "当前范围没有仓库"
                }
              >
                <SimpleTable
                  label="选择创建仓库"
                  headers={["", "仓库", "目标", "来源覆盖"]}
                >
                  {rows.map((repo) => (
                    <tr key={repo.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${repo.full_path}`}
                          checked={selected.includes(repo.id)}
                          onChange={(event) => {
                            setSelected(
                              event.target.checked
                                ? [...selected, repo.id]
                                : selected.filter((id) => id !== repo.id),
                            );
                            changeDraft();
                          }}
                        />
                      </td>
                      <td className="mono break-all">{repo.full_path}</td>
                      <td className="mono">{variant.main_branch}</td>
                      <td>
                        <Input
                          aria-label={`${repo.full_path} 来源分支`}
                          className="mono"
                          placeholder={source}
                          value={overrides[repo.id] ?? ""}
                          onChange={(event) => {
                            setOverrides({
                              ...overrides,
                              [repo.id]: event.target.value,
                            });
                            changeDraft();
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </SimpleTable>
              </AsyncBoundary>
            </div>
            {errors.fields.repository_ids && (
              <p className="mt-2 text-xs text-danger">
                {errors.fields.repository_ids}
              </p>
            )}
            <div className="form-actions">
              <Button variant="outline" onClick={close}>
                取消
              </Button>
              <Button
                pending={submission.pending}
                disabled={!repositories.data}
                onClick={() => void prepare()}
              >
                <Eye />
                生成预览计划
              </Button>
            </div>
          </>
        )}
        {step > 0 && plan && (
          <>
            <Notice tone={step === 2 ? "info" : "warning"} className="mb-4">
              {step === 2
                ? "执行由当前请求驱动；逐项事实如下，部分成功不会回滚其他仓库。"
                : `计划 ${plan.id} · 有效期至 ${formatDate(plan.expires_at)}。请逐仓确认动作，执行后不会跨仓回滚。`}
            </Notice>
            <AsyncBoundary
              loading={items.isPending}
              error={items.error}
              onRetry={() => void items.refetch()}
            >
              {items.data && (
                <SimpleTable
                  label="分支创建计划明细"
                  headers={["仓库", "来源提交", "预览", "执行动作", "结果"]}
                >
                  {items.data.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="mono break-all text-xs">
                          {item.repository_path}
                        </strong>
                        <small className="mono block text-muted">
                          {item.source_branch}
                        </small>
                      </td>
                      <td className="mono break-all text-xs">
                        {item.source_commit_id || "—"}
                      </td>
                      <td>
                        <StatusBadge tone={resultTone(item.preview_state)}>
                          {deliveryLabel(item.preview_state)}
                        </StatusBadge>
                        {item.preview_reason && (
                          <small className="block text-warning">
                            {reasonLabel(item.preview_reason)}
                          </small>
                        )}
                      </td>
                      <td>
                        {step === 1 ? (
                          <StandaloneSelect
                            aria-label={`${item.repository_path} 执行动作`}
                            value={
                              actions[item.id] ??
                              (item.preview_state === "ready"
                                ? "create"
                                : item.preview_state === "existing"
                                  ? "use_existing"
                                  : "skip")
                            }
                            onChange={(event) =>
                              setActions({
                                ...actions,
                                [item.id]: event.target.value,
                              })
                            }
                          >
                            {item.preview_state === "ready" && (
                              <option value="create">创建</option>
                            )}
                            {item.preview_state === "existing" && (
                              <option value="use_existing">采用既有分支</option>
                            )}
                            <option value="skip">跳过</option>
                          </StandaloneSelect>
                        ) : (
                          item.action || "—"
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={resultTone(item.status)}>
                          {deliveryLabel(item.status)}
                        </StatusBadge>
                        {item.reason && (
                          <small className="block text-muted">
                            {reasonLabel(item.reason)}
                          </small>
                        )}
                        {item.reconciliation && (
                          <small className="block">
                            核实：{deliveryLabel(item.reconciliation.status)} ·{" "}
                            {item.reconciliation.commit_id}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
            </AsyncBoundary>
            <div className="form-actions">
              {step === 1 && (
                <>
                  <Button variant="outline" onClick={() => setStep(0)}>
                    返回修改（需重新预览）
                  </Button>
                  <Button
                    pending={submission.pending}
                    disabled={unknown || !plan.can_execute}
                    onClick={() => void execute()}
                  >
                    <Play />
                    确认并执行
                  </Button>
                </>
              )}
              {step === 2 && <Button onClick={close}>完成并查看记录</Button>}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function CreationDetail({
  project,
  id,
}: {
  project: Resource;
  variant: Variant;
  id: string;
}) {
  const [, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const plan = useApiQuery<Creation>(
    ["creation", project.id, id],
    `/projects/${project.id}/branch-creations/${id}`,
  );
  const items = useApiQuery<Page<CreationItem>>(
    ["creation-items", project.id, id, page],
    `/projects/${project.id}/branch-creations/${id}/items?page=${page}&page_size=100`,
  );
  const submission = useSubmission();
  const unknownIds =
    items.data?.data.items
      .filter((item) => item.status === "unknown")
      .map((item) => item.id) ?? [];
  function close() {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("creation");
      return next;
    });
  }
  return (
    <Panel
      title={`创建批次 ${id}`}
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={close}>
            <ArrowLeft />
            返回记录
          </Button>
          {plan.data?.data.can_reconcile && (
            <Button
              pending={submission.pending}
              disabled={!unknownIds.length}
              onClick={() =>
                void submission.run(async () => {
                  await request(
                    `/projects/${project.id}/branch-creations/${id}/reconcile`,
                    {
                      method: "POST",
                      etag: plan.data?.etag,
                      body: { item_ids: unknownIds },
                    },
                  );
                  await queryClient.invalidateQueries({
                    queryKey: ["creation-items", project.id, id],
                  });
                  await plan.refetch();
                })
              }
            >
              核实未知项
            </Button>
          )}
          {plan.data &&
            ["completed", "partial", "failed", "interrupted"].includes(
              plan.data.data.status,
            ) && (
              <Button
                variant="outline"
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("create", "1");
                    next.set("retry", id);
                    next.delete("creation");
                    return next;
                  })
                }
              >
                <RotateCcw />
                重新预览可重试项
              </Button>
            )}
        </div>
      }
    >
      {plan.data && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusBadge tone={resultTone(plan.data.data.status)}>
            {deliveryLabel(plan.data.data.status)}
          </StatusBadge>
          <span className="mono">{plan.data.data.target_branch}</span>
          <span className="text-xs text-muted">
            来源 {plan.data.data.default_source_branch} ·{" "}
            {formatDate(plan.data.data.created_at)}
          </span>
        </div>
      )}
      <ErrorNotice error={submission.error} />
      <Notice className="mb-4">
        未知结果只追加只读核实证据，不改变原始历史；重试会创建新计划并重新冻结来源。
      </Notice>
      <AsyncBoundary
        loading={plan.isPending || items.isPending}
        error={plan.error ?? items.error}
        onRetry={() => {
          void plan.refetch();
          void items.refetch();
        }}
      >
        {items.data && (
          <SimpleTable
            label="创建批次逐项结果"
            headers={["仓库", "来源", "预览", "动作", "结果", "提交 / 核实"]}
          >
            {items.data.data.items.map((item) => (
              <tr key={item.id}>
                <td className="mono break-all">{item.repository_path}</td>
                <td>
                  <span className="mono">{item.source_branch}</span>
                  <small className="mono block break-all text-muted">
                    {item.source_commit_id}
                  </small>
                </td>
                <td>
                  {deliveryLabel(item.preview_state)}
                  <small className="block text-muted">
                    {reasonLabel(item.preview_reason)}
                  </small>
                </td>
                <td>{deliveryLabel(item.action)}</td>
                <td>
                  <StatusBadge tone={resultTone(item.status)}>
                    {deliveryLabel(item.status)}
                  </StatusBadge>
                  <small className="block text-muted">
                    {reasonLabel(item.reason)}
                  </small>
                </td>
                <td className="mono break-all text-xs">
                  {item.result_commit_id || "—"}
                  {item.reconciliation && (
                    <span className="mt-1 block">
                      核实：{deliveryLabel(item.reconciliation.status)} ·{" "}
                      {item.reconciliation.commit_id ||
                        reasonLabel(item.reconciliation.reason)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </AsyncBoundary>
      {items.data && (
        <Pagination
          page={page}
          size={100}
          total={items.data.data.total}
          onChange={(nextPage) => setPage(nextPage)}
        />
      )}
    </Panel>
  );
}
