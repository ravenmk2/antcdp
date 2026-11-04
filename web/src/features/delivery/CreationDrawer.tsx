import { OperationStatus } from "@/components/platform/operation-status";
import { useRef, useState } from "react";
import {
  type Variant,
  type Repository,
  type Creation,
  type CreationItem,
  type Page,
  labels,
  reason,
} from "@/shared/delivery";
import { uuidV4 } from "@/shared/uuid";
import { request, errorMessage, ApiError } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { writeRequiresReview } from "@/lib/write-error";
import { useDate } from "@/lib/date";
import { FormDrawer } from "@/components/platform/form-drawer";
import { FormDialog } from "@/components/platform/form-dialog";
import {
  AsyncState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { TextControl, ValuesGrid } from "@/components/platform/form-controls";
import { NativeSelect } from "@/components/platform/native-select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
type Selected = Pick<Repository, "id" | "full_path">;
type Selection = {
  items: Selected[];
  scope: string;
  variant: Variant;
  retry?: string;
};
type Preparation = {
  url: string;
  etag: string;
  key: string;
  body: {
    repository_ids: string[];
    scope_token: string;
    default_source_branch: string;
    source_overrides: { repository_id: string; source_branch: string }[];
    retry_of_id?: string;
  };
};
export function CreationDrawer({
  projectId,
  variant,
  initialId,
  allowed = true,
  selection,
  onClose,
  onChanged,
}: {
  projectId: string;
  variant: Variant;
  initialId?: string;
  allowed?: boolean;
  selection?: { items: Selected[]; scope: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const root = "/projects/" + projectId,
    [id, setId] = useState(initialId || ""),
    [revision, setRev] = useState(0),
    [draft, setDraft] = useState<Selection | undefined>(() =>
      selection ? { ...selection, variant } : undefined,
    ),
    [source, setSource] = useState("main"),
    [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [uncertain, setUncertain] = useState<Preparation>(),
    [executionReview, setExecutionReview] = useState(false);
  const [preparationBlocked, setPreparationBlocked] = useState(false);
  const lock = useRef(false),
    date = useDate();
  const query = useQuery<Creation>(
      id ? root + "/branch-creations/" + id : null,
      revision,
    ),
    items = useQuery<Page<CreationItem>>(
      id ? root + "/branch-creations/" + id + "/items?page_size=100" : null,
      revision,
    );
  const plan = query.data?.variant_id === variant.id ? query.data : undefined,
    rows = items.data?.items || [],
    [choices, setChoices] = useState<{
      tag: string;
      byId: Record<string, string>;
    }>({ tag: "", byId: {} });
  const writable = allowed && variant.can_manage && !variant.archived_at;
  const canManage = writable && variant.binding_validity === "valid";
  function action(item: CreationItem) {
    return (
      (plan && choices.tag === plan.etag ? choices.byId[item.id] : undefined) ||
      (item.preview_state === "ready" ? "create" : "skip")
    );
  }
  const chosen = rows.filter((i) => action(i) !== "skip"),
    fullyRead = !!items.data && rows.length === items.data.total;
  function refresh() {
    setRev((v) => v + 1);
    setConfirm(false);
    onChanged();
  }
  async function prepare() {
    if (
      preparationBlocked ||
      lock.current ||
      !draft ||
      !canManage ||
      !source.trim()
    )
      return;
    const req: Preparation = uncertain || {
      url: root + "/variants/" + draft.variant.id + "/branch-creations",
      etag: draft.variant.etag,
      key: uuidV4(),
      body: {
        repository_ids: draft.items.map((i) => i.id),
        scope_token: draft.scope,
        default_source_branch: source,
        source_overrides: draft.items
          .filter((i) => overrides[i.id]?.trim())
          .map((i) => ({
            repository_id: i.id,
            source_branch: overrides[i.id]!,
          })),
        retry_of_id: draft.retry,
      },
    };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request<Creation>(req.url, {
        method: "POST",
        etag: req.etag,
        headers: { "Idempotency-Key": req.key },
        body: req.body,
      });
      setId(r.data.id);
      setDraft(undefined);
      setUncertain(undefined);
      setExecutionReview(false);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (
        e instanceof ApiError &&
        ["NETWORK_ERROR", "HTTP_ERROR", "INVALID_RESPONSE"].includes(e.code)
      )
        setUncertain(req);
      else if (
        writeRequiresReview(e) ||
        (e instanceof ApiError && e.code === "IDEMPOTENCY_CONFLICT")
      ) {
        setError(errorMessage(e) + " 请关闭后重新读取产品分支和仓库范围。");
        setPreparationBlocked(true);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function changePlan(command: "execute" | "reconcile") {
    if (lock.current || !plan || !fullyRead || !writable) return;
    if (command === "execute" && !canManage) return;
    if (
      command === "execute" &&
      (!plan.can_execute || !chosen.length || executionReview)
    )
      return;
    if (command === "reconcile" && !plan.can_reconcile) return;
    lock.current = true;
    setBusy(true);
    setConfirm(false);
    setError("");
    try {
      await request(root + "/branch-creations/" + id + "/" + command, {
        method: "POST",
        etag: plan.etag,
        body:
          command === "execute"
            ? { items: rows.map((i) => ({ id: i.id, action: action(i) })) }
            : {
                item_ids: rows
                  .filter((i) => i.status === "unknown")
                  .map((i) => i.id),
              },
      });
    } catch (e) {
      setError(errorMessage(e) + " 请刷新本地记录并核对结果。");
      if (command === "execute" && writeRequiresReview(e))
        setExecutionReview(true);
    } finally {
      refresh();
      lock.current = false;
      setBusy(false);
    }
  }
  const retryable = rows.filter(
    (i) =>
      i.status === "failed" ||
      i.status === "not_started" ||
      (i.status === "unknown" && i.reconciliation),
  );
  async function retry() {
    if (lock.current || !plan || !canManage || !retryable.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const fresh = (await request<Variant>(root + "/variants/" + variant.id))
        .data;
      if (
        fresh.main_branch !== plan.target_branch ||
        !fresh.can_manage ||
        fresh.archived_at ||
        fresh.binding_validity !== "valid"
      ) {
        setError("当前主干、权限或状态已变化，请重新选择仓库。");
        return;
      }
      const scope = (
        await request<Page<Repository>>(
          root + "/variants/" + variant.id + "/repositories",
        )
      ).data.scope_token;
      if (!scope) {
        setError("缺少当前仓库范围版本。");
        return;
      }
      setDraft({
        variant: fresh,
        scope,
        items: retryable.map((i) => ({
          id: i.repository_id,
          full_path: i.repository_path,
        })),
        retry: plan.id,
      });
      setSource(plan.default_source_branch || "main");
      setOverrides(
        Object.fromEntries(
          retryable
            .filter((i) => i.source_branch !== plan.default_source_branch)
            .map((i) => [i.repository_id, i.source_branch]),
        ),
      );
      setUncertain(undefined);
      setExecutionReview(false);
      setId("");
      setChoices({ tag: "", byId: {} });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const customCount = Object.values(overrides).filter((v) => v.trim()).length;
  const pending = query.loading || items.loading || busy;
  return (
    <FormDrawer
      title={id ? "主干创建记录" : "预览主干创建计划"}
      description={variant.name + " · " + variant.main_branch}
      dirty={
        !id && (source !== "main" || Object.values(overrides).some(Boolean))
      }
      pending={busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={busy} onClick={() => close()}>
            关闭
          </Button>
          {draft && (
            <Button
              disabled={
                preparationBlocked ||
                busy ||
                !canManage ||
                !draft.items.length ||
                !source.trim()
              }
              onClick={() => void prepare()}
            >
              {uncertain ? "核对原创建计划" : "预览创建清单"}
            </Button>
          )}
          {plan?.can_execute && canManage && (
            <Button
              disabled={
                pending ||
                !fullyRead ||
                !chosen.length ||
                plan.expired ||
                executionReview
              }
              onClick={() => setConfirm(true)}
            >
              确认执行
            </Button>
          )}
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {draft && (
        <fieldset disabled={busy || !!uncertain} className="space-y-4">
          {draft.retry && (
            <p role="status">
              从记录 {draft.retry} 重新准备计划，执行前需再次确认。
            </p>
          )}
          <TextControl
            label="默认来源分支"
            required
            value={source}
            onValue={setSource}
          />
          <p className="text-sm text-muted-foreground">
            {draft.items.length - customCount} 个仓库沿用 {source || "默认来源"}
            ，{customCount} 个自定义。预览会读取远端状态并保存计划。
          </p>
          <label className="grid gap-1 text-sm">
            为个别仓库指定来源
            <NativeSelect
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) setOverrides((old) => ({ ...old, [id]: "" }));
              }}
            >
              <option value="">选择要单独设置的仓库</option>
              {draft.items
                .filter((i) => !Object.hasOwn(overrides, i.id))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.full_path}
                  </option>
                ))}
            </NativeSelect>
          </label>
          {draft.items
            .filter((i) => Object.hasOwn(overrides, i.id))
            .map((i) => (
              <div key={i.id} className="space-y-1">
                <TextControl
                  key={i.id}
                  label={i.full_path}
                  placeholder={source}
                  value={overrides[i.id] || ""}
                  onValue={(v) =>
                    setOverrides((old) => ({ ...old, [i.id]: v }))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={"恢复默认来源：" + i.full_path}
                  onClick={() =>
                    setOverrides((old) => {
                      const next = { ...old };
                      delete next[i.id];
                      return next;
                    })
                  }
                >
                  恢复默认来源
                </Button>
              </div>
            ))}
        </fieldset>
      )}
      {uncertain && (
        <p role="alert">请使用原请求核对计划。核对会沿用同一个幂等键。</p>
      )}
      {id && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">记录 {id}</span>
            <RefreshButton loading={pending} onClick={refresh} />
          </div>
          <AsyncState
            loading={query.loading || items.loading}
            error={
              query.error ||
              items.error ||
              (query.data && !plan ? "记录不属于当前产品分支。" : "")
            }
            onRetry={refresh}
          >
            {plan && (
              <div className="space-y-5">
                <ValuesGrid
                  items={[
                    [
                      "计划状态",
                      <OperationStatus
                        value={plan.expired ? "outdated" : plan.status}
                      >
                        {labels[plan.status] || plan.status}
                        {plan.expired && " · 已过期"}
                      </OperationStatus>,
                    ],
                    ["目标分支", plan.target_branch],
                    ["默认来源", plan.default_source_branch],
                    ["创建时间", date(plan.created_at)],
                  ]}
                />
                <Table aria-label="创建计划清单">
                  <TableHeader>
                    <TableRow>
                      {["仓库 / 来源", "预览状态", "执行动作 / 结果"].map(
                        (t) => (
                          <TableHead key={t}>{t}</TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          {i.repository_path}
                          <small className="block text-muted-foreground">
                            {i.source_branch}
                          </small>
                        </TableCell>
                        <TableCell>
                          <OperationStatus value={i.preview_state}>
                            {labels[i.preview_state] || i.preview_state}
                          </OperationStatus>
                          <small className="block text-muted-foreground">
                            {reason(i.preview_reason)}
                          </small>
                        </TableCell>
                        <TableCell>
                          {plan.status === "prepared" ? (
                            <NativeSelect
                              aria-label={i.repository_path + " 执行动作"}
                              disabled={
                                busy ||
                                !canManage ||
                                !plan.can_execute ||
                                executionReview
                              }
                              value={action(i)}
                              onChange={(e) =>
                                setChoices((old) => ({
                                  tag: plan.etag,
                                  byId: {
                                    ...(old.tag === plan.etag ? old.byId : {}),
                                    [i.id]: e.target.value,
                                  },
                                }))
                              }
                            >
                              <option value="skip">跳过</option>
                              {i.preview_state === "ready" && (
                                <option value="create">创建</option>
                              )}
                              {i.preview_state === "existing" && (
                                <option value="use_existing">
                                  采用已有分支
                                </option>
                              )}
                            </NativeSelect>
                          ) : (
                            <>
                              <OperationStatus value={i.status}>
                                {labels[i.status] || i.status}
                              </OperationStatus>{" "}
                              · {reason(i.reason)}
                            </>
                          )}
                          <details className="mt-2 text-xs">
                            <summary>记录详情</summary>
                            {[
                              ["来源提交", i.source_commit_id],
                              ["预览目标", i.preview_target_commit_id],
                              ["结果提交", i.result_commit_id],
                              [
                                "最近核实",
                                i.reconciliation
                                  ? (labels[i.reconciliation.status] ||
                                      i.reconciliation.status) +
                                    " · " +
                                    reason(i.reconciliation.reason) +
                                    " · " +
                                    (i.reconciliation.commit_id || "—") +
                                    " · " +
                                    date(i.reconciliation.checked_at)
                                  : "",
                              ],
                            ].map(
                              ([label, v]) =>
                                v && (
                                  <p
                                    key={label}
                                    className="whitespace-normal break-all"
                                  >
                                    {label} · {v}
                                  </p>
                                ),
                            )}
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-sm text-muted-foreground">
                  共 {items.data?.total}{" "}
                  个仓库。刷新读取本地记录，未知结果需要先核实。
                </p>
                <div className="flex flex-wrap gap-2">
                  {plan.can_reconcile && writable && (
                    <Button
                      variant="outline"
                      disabled={pending || !fullyRead}
                      onClick={() => void changePlan("reconcile")}
                    >
                      核实未知结果
                    </Button>
                  )}
                  {canManage &&
                    fullyRead &&
                    retryable.length > 0 &&
                    plan.status !== "executing" &&
                    plan.status !== "prepared" && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => void retry()}
                      >
                        为可重试项准备新计划
                      </Button>
                    )}
                </div>
              </div>
            )}
          </AsyncState>
        </>
      )}
      {confirm && plan && (
        <FormDialog
          open
          title="确认创建主干 Git 分支"
          description={plan.target_branch}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                取消
              </Button>
              <Button onClick={() => void changePlan("execute")}>
                执行已选动作
              </Button>
            </>
          }
        >
          <p>
            创建 {chosen.filter((i) => action(i) === "create").length} 个远端
            Git 分支，采用{" "}
            {chosen.filter((i) => action(i) === "use_existing").length}{" "}
            个已有分支。远端创建无法在本页面撤销。
          </p>
        </FormDialog>
      )}
    </FormDrawer>
  );
}
