import { useOperationToast } from "@/components/platform/operation-toast";
import { StatusText } from "@/components/platform/status-text";
import { useEffect, useRef, useState } from "react";
import {
  type BranchModel,
  type BranchRule,
  type Page,
  reason,
  labels,
} from "@/shared/delivery";
import { useQuery } from "@/lib/use-query";
import { usePreview } from "@/lib/preview";
import { request, errorMessage } from "@/lib/api";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import { FormDialog } from "@/components/platform/form-dialog";
import { Pagination } from "@/components/platform/pagination";
import { AsyncState, ErrorBox } from "@/components/platform/feedback";
import { AreaControl } from "@/components/platform/form-controls";
import { NativeSelect } from "@/components/platform/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
type Preview = {
  samples: {
    name: string;
    git_valid: boolean;
    matched_types: string[];
    binding_validity: string;
    reason: string;
  }[];
  impacts: Page<{
    subject_kind: string;
    subject_id: string;
    name: string;
    branch_name: string;
    reason: string;
  }>;
  impact_token: string;
};
const modeLabels: Record<string, string> = {
  exact: "精确匹配",
  glob: "通配符",
  regex: "正则表达式",
};
export function BranchModelPanel({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const path = "/projects/" + projectId + "/branch-model",
    query = useQuery<BranchModel>(path);
  return (
    <AsyncState
      loading={query.loading}
      error={query.error}
      onRetry={query.refresh}
    >
      {query.data && (
        <Rules
          model={query.data}
          path={path}
          canManage={canManage && query.data.can_manage}
          onReload={query.refresh}
        />
      )}
    </AsyncState>
  );
}
function Rules({
  model,
  path,
  canManage,
  onReload,
}: {
  model: BranchModel;
  path: string;
  canManage: boolean;
  onReload: () => void;
}) {
  const [baseline, setBaseline] = useState(model),
    [editing, setEditing] = useState(false),
    [rules, setRules] = useState(model.rules),
    [samples, setSamples] = useState("main\ndevelop\ncustom/customer-a"),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20),
    [confirm, setConfirm] = useState<"save" | "reload" | "cancel">(),
    [error, setError] = useState(""),
    notify = useOperationToast();
  const dirty = JSON.stringify(rules) !== JSON.stringify(baseline.rules),
    save = useSubmission();
  const fields = useRef<HTMLFieldSetElement>(null),
    editButton = useRef<HTMLButtonElement>(null),
    wasEditing = useRef(false);
  useEffect(() => {
    if (editing)
      fields.current
        ?.querySelector<HTMLInputElement>("input:not([disabled])")
        ?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useNavigationProtection(
    save.pending ? "pending" : dirty ? "dirty" : undefined,
  );
  const payload = JSON.stringify({
      rules,
      sample_names: samples
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    }),
    preview = usePreview<Preview>(
      path + "/preview?page=" + page + "&page_size=" + size,
      payload,
      false,
      baseline.etag,
    );
  const label = (k: string) =>
    model.types.find((t) => t.branch_type === k)?.label || k;
  function update(index: number, next: BranchRule) {
    setRules((rows) => rows.map((r, i) => (i === index ? next : r)));

    setPage(1);
  }
  async function persist() {
    if (!canManage || !dirty || !preview.data?.impact_token) return;
    setConfirm(undefined);
    setError("");
    await save.submit(
      async () => {
        const r = await request<BranchModel>(path, {
          method: "PUT",
          etag: baseline.etag,
          body: { rules, impact_token: preview.data!.impact_token },
        });
        setBaseline(r.data);
        setRules(r.data.rules);
        setEditing(false);
        notify("分支模型已保存。");
      },
      (e) => setError(errorMessage(e)),
    );
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">分支规则</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {editing
              ? "修改后先检查匹配与影响，再保存规则。已有分支名称不会自动改变。"
              : `已启用 ${baseline.rules.filter((row) => row.enabled).length} 类分支。规则决定变体主干和环境可以绑定的分支名称。`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            disabled={save.pending}
            onClick={() => (dirty ? setConfirm("reload") : onReload())}
          >
            重新读取
          </Button>
          {editing ? (
            <Button
              variant="outline"
              disabled={save.pending}
              onClick={() => (dirty ? setConfirm("cancel") : setEditing(false))}
            >
              取消编辑
            </Button>
          ) : (
            canManage && (
              <Button
                ref={editButton}
                variant="outline"
                disabled={save.blocked}
                onClick={() => setEditing(true)}
              >
                编辑规则
              </Button>
            )
          )}
        </div>
      </div>
      <ErrorBox>{error || (editing ? preview.error : undefined)}</ErrorBox>

      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      {!editing ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {baseline.rules.map((row) => {
            const type = model.types.find(
              (item) => item.branch_type === row.branch_type,
            );
            return (
              <div
                key={row.branch_type}
                className="grid items-start gap-3 p-4 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,1.5fr)_5rem]"
              >
                <div>
                  <h3 className="text-sm font-medium">
                    {label(row.branch_type)}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {type?.description}
                  </p>
                </div>
                <div className="min-w-0 text-sm">
                  {row.rule ? (
                    <>
                      <code className="break-all">{row.rule.pattern}</code>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {modeLabels[row.rule.mode] || row.rule.mode}
                        {type?.allow_environment ? " · 可绑定环境" : ""}
                      </p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">尚未配置</span>
                  )}
                </div>
                <StatusText tone="neutral">
                  {row.enabled ? "已启用" : "未启用"}
                </StatusText>
              </div>
            );
          })}
        </div>
      ) : (
        <fieldset
          ref={fields}
          disabled={!canManage || save.pending || save.blocked}
          className="divide-y overflow-hidden rounded-xl border bg-card"
        >
          {rules.map((row, i) => {
            const type = model.types.find(
              (t) => t.branch_type === row.branch_type,
            );
            return (
              <div
                key={row.branch_type}
                className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[minmax(12rem,1fr)_auto_8rem_minmax(10rem,1fr)]"
              >
                <div>
                  <h3 className="text-sm font-semibold">
                    {label(row.branch_type)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {type?.description} ·{" "}
                    {type?.allow_environment ? "可绑定环境" : "不可绑定环境"}
                  </p>
                </div>
                <Switch
                  aria-label={"启用 " + row.branch_type}
                  disabled={
                    !canManage || save.pending || row.branch_type === "mainline"
                  }
                  checked={row.enabled}
                  onCheckedChange={(v) =>
                    update(i, {
                      ...row,
                      enabled: v,
                      rule:
                        row.rule ||
                        (v
                          ? { mode: "glob", pattern: row.branch_type + "/**" }
                          : null),
                    })
                  }
                />
                {row.rule ? (
                  <>
                    <NativeSelect
                      aria-label={row.branch_type + " 匹配方式"}
                      value={row.rule.mode}
                      onChange={(e) =>
                        update(i, {
                          ...row,
                          rule: { ...row.rule!, mode: e.target.value },
                        })
                      }
                    >
                      <option value="exact">精确匹配</option>
                      <option value="glob">通配符</option>
                      <option value="regex">正则表达式</option>
                    </NativeSelect>
                    <Input
                      aria-label={row.branch_type + " 命名规则"}
                      value={row.rule.pattern}
                      onChange={(e) =>
                        update(i, {
                          ...row,
                          rule: { ...row.rule!, pattern: e.target.value },
                        })
                      }
                    />
                  </>
                ) : (
                  <small className="text-muted-foreground">未配置规则</small>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      {editing && (
        <details className="text-sm text-muted-foreground">
          <summary>匹配规则说明</summary>
          <p className="mt-2">
            * 匹配本层，** 可跨层，? 匹配单个非斜杠字符。正则使用 Go
            语法并完整匹配，不支持回溯引用或前后查找。
          </p>
        </details>
      )}
      {editing && canManage && (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <AreaControl
            label="测试分支名称"
            hint="每行一个分支名。检查结果包含会受到规则变更影响的已有绑定。"
            rows={3}
            value={samples}
            onValue={(s) => {
              setSamples(s);
              setPage(1);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={preview.loading || save.pending}
              onClick={preview.run}
            >
              检查匹配与影响
            </Button>
            <Button
              disabled={
                !dirty ||
                !preview.data ||
                preview.loading ||
                save.blocked ||
                save.pending
              }
              onClick={() =>
                preview.data?.impacts.total
                  ? setConfirm("save")
                  : void persist()
              }
            >
              保存规则
            </Button>
          </div>
          {preview.loading && <p role="status">正在检查规则…</p>}
          {preview.data && (
            <div className="space-y-3">
              <h3 className="font-medium">样例匹配</h3>
              <ul className="divide-y">
                {preview.data.samples.map((s, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                  >
                    <code className="break-all">{s.name}</code>
                    <StatusText
                      tone={
                        !s.git_valid
                          ? "danger"
                          : s.binding_validity === "valid"
                            ? "success"
                            : "warning"
                      }
                    >
                      {s.git_valid
                        ? s.matched_types.map(label).join("、") ||
                          labels[s.binding_validity] ||
                          "未匹配"
                        : "分支名无效"}{" "}
                      {reason(s.reason)}
                    </StatusText>
                  </li>
                ))}
              </ul>
              <h3 className="font-medium">
                受影响绑定 · {preview.data.impacts.total}
              </h3>
              {preview.data.impacts.items.map((x) => (
                <p
                  className="break-words text-sm"
                  key={x.subject_kind + x.subject_id}
                >
                  {x.name} · {x.branch_name} · {reason(x.reason)}
                </p>
              ))}
              {preview.data.impacts.total > 0 && (
                <Pagination
                  page={page}
                  size={size}
                  total={preview.data.impacts.total}
                  onChange={(n, s) => {
                    setPage(n);
                    setSize(s);
                  }}
                />
              )}
            </div>
          )}
        </section>
      )}
      {confirm && (
        <FormDialog
          open
          title={confirm === "save" ? "确认规则影响" : "放弃规则修改"}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirm(undefined)}>
                继续编辑
              </Button>
              <Button
                onClick={() => {
                  if (confirm === "save") void persist();
                  else {
                    setConfirm(undefined);
                    if (confirm === "reload") onReload();
                    else {
                      setRules(baseline.rules);
                      setEditing(false);
                      setError("");
                    }
                  }
                }}
              >
                {confirm === "save"
                  ? "确认修改规则"
                  : confirm === "reload"
                    ? "放弃并重新读取"
                    : "放弃修改"}
              </Button>
            </>
          }
        >
          <p>
            {confirm === "save"
              ? "规则修改会使 " +
                preview.data?.impacts.total +
                " 个已有绑定不匹配。已保存的分支名称保持原值。"
              : confirm === "reload"
                ? "重新读取会丢弃当前规则草稿。"
                : "当前规则修改尚未保存，放弃后将恢复已保存的规则。"}
          </p>
        </FormDialog>
      )}
    </section>
  );
}
