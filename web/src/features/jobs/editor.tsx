import { RunAccountField } from "@/features/projects/run-account-field";
import { useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bug, Plus, Save, X } from "lucide-react";
import { ApiError, errorMessage, request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  Textarea,
} from "@/components/fields";
import { PageHeader } from "@/components/layout";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { resourceCodeSchema } from "@/domain/validation";
import { useApiQuery } from "@/hooks/use-api";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource, MemberPage, ScopedRole } from "@/types/collaboration";
import { Inputs, JobSection, JobStatus } from "./presentation";
import { StartForm, RunView } from "./runs";
import { ScriptEditor } from "./script-editor";
import {
  exampleScript,
  type Job,
  type Config,
  type Grant,
  type Parameter,
} from "./types";

const saveFieldLabels = new Map([
  ["execution", "运行设置"],
  ["run_as_user_id", "运行账号"],
  ["parameters", "输入参数"],
  ["code", "作业编码"],
  ["name", "作业名称与说明"],
]);

export function JobEditor({
  job: initialJob,
  project,
  base,
}: {
  job?: Job;
  project: Resource;
  base: string;
}) {
  const [job, setJob] = useState(initialJob);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const nameInputId = useId();
  const codeInputId = useId();
  const [form, setForm] = useState(() => ({
    code: job?.code ?? "",
    name: job?.name ?? "",
    description: job?.description ?? "",
    enabled: job?.enabled ?? false,
    max_concurrency: job?.max_concurrency ?? 1,
    busy_policy: job?.busy_policy ?? "queue",
    timeout_ms: job?.timeout_ms ?? 1800000,
  }));
  const [config, setConfig] = useState<Config>(
    () =>
      job?.config ?? {
        run_as_user_id: "",
        script: exampleScript,
        parameters: [],
      },
  );
  const [accountRequired, setAccountRequired] = useState(false);
  const [grants, setGrants] = useState<Grant[]>(job?.grants ?? []);
  const [pending, setPending] = useState<"save" | "draft">();
  const [error, setError] = useState<unknown>();
  const [nameError, setNameError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [debug, setDebug] = useState(false);
  const [debugRun, setDebugRun] = useState<string>();
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const changes = JSON.stringify({ form, config, grants });
  const initial = useRef(changes);
  const dirty = initial.current !== changes;
  const markSaved = useUnsaved(dirty, Boolean(pending));

  function validateCode() {
    if (job) return true;
    const parsed = resourceCodeSchema.safeParse(form.code);
    if (parsed.success) return true;
    setCodeError(
      form.code ? parsed.error.issues[0]!.message : "请输入作业编码",
    );
    document.getElementById(codeInputId)?.focus();
    return false;
  }

  async function createDraft() {
    if (pending) return;
    setPending("draft");
    setError(undefined);
    try {
      const draft = await request<Job>(base, {
        method: "POST",
        body: {
          ...form,
          name: form.name.trim() || "未命名作业草稿",
          enabled: false,
          grants: [],
          config: null,
        },
      });
      setJob(draft.data);
      setConfirmDraft(false);
      setDebug(true);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e) {
      setError(e);
    } finally {
      setPending(undefined);
    }
  }

  function openDebug() {
    setError(undefined);
    if (job) setDebug(!debug);
    else if (validateCode()) setConfirmDraft(true);
  }

  async function save() {
    if (pending) return;
    setError(undefined);
    if (!form.name.trim()) {
      setNameError("请输入作业名称");
      document.getElementById(nameInputId)?.focus();
      return;
    }
    if (!validateCode()) return;
    if (!config.run_as_user_id) {
      setAccountRequired(true);
      return;
    }
    setPending("save");
    try {
      const r = await request<Job>(job ? `${base}/${job.id}` : base, {
        method: job ? "PUT" : "POST",
        body: { ...form, config, grants, version: job?.version ?? "" },
      });
      markSaved();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["job"] }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
      navigate(`${base}/${r.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "CODE_CONFLICT") {
        setCodeError(e.message);
      }
      setError(e);
    } finally {
      setPending(undefined);
    }
  }

  const invalidField =
    error instanceof ApiError &&
    error.details.find((item) => item.field)?.field;
  const invalidSection =
    invalidField &&
    (saveFieldLabels.get(invalidField) ??
      (config.parameters.some((p) => p.name === invalidField)
        ? "输入参数"
        : undefined));
  return (
    <>
      <div className="sticky top-16 z-10 -mt-2 border-b border-border bg-surface">
        <PageHeader
          className="py-3"
          title={
            initialJob
              ? `编辑 ${initialJob.name}`
              : job
                ? "编辑作业草稿"
                : "创建作业"
          }
          description={
            <div className="flex flex-wrap items-center gap-3">
              {job && <JobStatus job={job} />}
              {dirty && (
                <StatusBadge tone="warning">有未保存的修改</StatusBadge>
              )}
              {!initialJob && !job && (
                <span>填写基本信息并编辑要运行的脚本。</span>
              )}
            </div>
          }
          actions={
            <>
              <Button
                variant="outline"
                aria-expanded={debug}
                disabled={Boolean(pending)}
                onClick={openDebug}
              >
                <Bug /> {debug ? "收起调试" : job ? "调试" : "草稿调试"}
              </Button>
              <Button
                pending={pending === "save"}
                disabled={pending === "draft"}
                onClick={() => void save()}
              >
                <Save /> 保存作业
              </Button>
            </>
          }
        />
        {!confirmDraft && Boolean(error) && (
          <div className="pb-3">
            <ErrorNotice
              error={
                invalidSection
                  ? `「${invalidSection}」校验失败。${errorMessage(error)}`
                  : error
              }
            />
          </div>
        )}
      </div>
      {confirmDraft && (
        <ConfirmDialog
          open
          title="创建草稿并调试？"
          description="系统会先创建一条停用的作业草稿并固定作业编码。当前脚本和参数仍可继续编辑。"
          confirmLabel="创建草稿"
          pending={pending === "draft"}
          onClose={() => {
            setConfirmDraft(false);
            setError(undefined);
          }}
          onConfirm={() => void createDraft()}
        >
          <ErrorNotice error={error} />
        </ConfirmDialog>
      )}
      <div
        inert={Boolean(pending)}
        className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5 max-lg:grid-cols-1"
      >
        <div className="min-w-0 space-y-4">
          <section
            className="min-w-0 overflow-hidden rounded-xl border border-border"
            aria-label="脚本编辑"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-4 py-3">
              <h2 className="flex items-center gap-3 text-sm font-semibold">
                JavaScript 脚本
                <code className="hidden font-normal text-muted xl:inline">
                  async function main(ctx)
                </code>
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowReference(true)}
              >
                <BookOpen /> API 速查
              </Button>
            </header>
            <div
              className={`[&>div]:rounded-none [&>div]:border-0 [&_.cm-editor]:h-[var(--job-editor-height)]! ${debug ? "[--job-editor-height:340px]" : "[--job-editor-height:clamp(440px,calc(100dvh-360px),660px)]"}`}
            >
              <ScriptEditor
                value={config.script}
                onChange={(script) => setConfig((c) => ({ ...c, script }))}
              />
            </div>
          </section>
          {debug && job && (
            <section className="space-y-4 rounded-xl border border-border">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-4 py-3">
                <h2 className="text-sm font-semibold">调试当前脚本</h2>
                <span className="text-xs text-muted">
                  使用编辑中的脚本和参数
                </span>
              </header>
              <div className="px-4 pb-4">
                <StartForm
                  job={{ ...job, timeout_ms: form.timeout_ms }}
                  base={`${base}/${job.id}`}
                  config={config}
                  onStarted={setDebugRun}
                />
              </div>
              {debugRun && (
                <div className="border-t border-border px-4 pt-4 pb-4">
                  <RunView
                    key={debugRun}
                    job={job}
                    base={`${base}/${job.id}`}
                    runId={debugRun}
                    embedded
                  />
                </div>
              )}
            </section>
          )}
        </div>

        <aside
          className="min-w-0 overflow-hidden rounded-xl border border-border"
          aria-label="作业配置"
        >
          <div className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">基本信息</h2>
            <Field id={nameInputId} label="作业名称" required error={nameError}>
              <Input
                value={form.name}
                placeholder="例如 每日构建检查"
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setNameError("");
                }}
              />
            </Field>
            <Field
              id={codeInputId}
              label="作业编码"
              required
              hint={
                job
                  ? "创建后固定，用于标识作业。"
                  : "小写字母、数字、下划线或连字符，创建后固定。"
              }
              error={codeError}
            >
              <Input
                value={form.code}
                maxLength={64}
                readOnly={Boolean(job)}
                className="font-mono"
                placeholder="daily_build_check"
                onChange={(e) => {
                  setForm({ ...form, code: e.target.value });
                  setCodeError("");
                }}
              />
            </Field>
            <RunAccountField
              attempted={accountRequired}
              base={`/projects/${project.id}`}
              value={config.run_as_user_id}
              onChange={(id) => setConfig({ ...config, run_as_user_id: id })}
            />
            <Field label="说明">
              <Textarea
                rows={2}
                placeholder="用于说明作业的用途"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
          </div>
          <JobSection
            title="输入参数"
            detail={
              config.parameters.length ? `${config.parameters.length} 项` : "无"
            }
          >
            <ParameterEditor
              value={config.parameters}
              onChange={(parameters) =>
                setConfig((c) => ({ ...c, parameters }))
              }
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  parameters: [
                    ...c.parameters,
                    { name: "", label: "", type: "text", required: false },
                  ],
                }))
              }
            >
              <Plus /> 添加参数
            </Button>
          </JobSection>
          <JobSection
            title="运行设置"
            detail={`${form.enabled ? "启用" : "停用"} · 并发 ${form.max_concurrency}`}
          >
            <Field label="作业状态">
              <Select
                value={String(form.enabled)}
                onValueChange={(value) =>
                  setForm({ ...form, enabled: value === "true" })
                }
              >
                <option value="true">启用</option>
                <option value="false">停用</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="并发上限">
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={form.max_concurrency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_concurrency: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="超时时长（秒）">
                <Input
                  type="number"
                  min="1"
                  value={form.timeout_ms / 1000}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      timeout_ms: Number(e.target.value) * 1000,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="并发满额时">
              <Select
                value={form.busy_policy}
                onValueChange={(value) =>
                  setForm({ ...form, busy_policy: value })
                }
              >
                <option value="queue">排队等待</option>
                <option value="skip">跳过本次触发</option>
              </Select>
            </Field>
          </JobSection>
          <JobSection
            title="运行授权"
            detail={grants.length ? `已选 ${grants.length} 项` : "仅管理员"}
          >
            <RunAccess
              projectId={project.id}
              grants={grants}
              onChange={setGrants}
            />
          </JobSection>
        </aside>
      </div>
      {showReference && (
        <Drawer
          open
          onClose={() => setShowReference(false)}
          title="脚本 API 速查"
        >
          <dl className="divide-y divide-border text-sm">
            {[
              ["ctx.inputs", "读取运行参数"],
              ["ctx.run", "读取运行上下文"],
              ['ctx.log.info("开始", { value: 1 })', "写入运行日志"],
              ["await ctx.sleep(1000)", "等待指定毫秒数"],
              ['ctx.state.get("key")', "读取状态，返回值与 etag 或 null"],
              ['ctx.state.put("key", value, { ifMatch: etag })', "更新状态"],
              ['ctx.state.delete("key", { ifMatch: etag })', "删除状态"],
              [
                'await ctx.resources.call("platform/build", { target: "app", operation: "build" })',
                "服务连接路径支持 platform/连接编码 和 project/当前项目编码/连接编码。",
              ],
              [
                'await ctx.dingtalk.send("robot_code", { format: "text", body: "完成" })',
                "按编码发送项目钉钉通知",
              ],
              [
                "await Promise.all([operationA(), operationB()])",
                "等待多个宿主操作完成",
              ],
            ].map(([code, label]) => (
              <div key={code} className="space-y-1 py-3 first:pt-0">
                <dt>{label}</dt>
                <dd className="font-mono text-xs wrap-anywhere text-muted">
                  {code}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted">
            服务连接调用暂只检查授权并记录审计。
          </p>
          {project.can_manage && (
            <Link
              className="link mt-3 block text-sm"
              to={`/projects/${project.id}/dingtalk`}
            >
              管理项目钉钉机器人
            </Link>
          )}
        </Drawer>
      )}
    </>
  );
}

function RunAccess({
  projectId,
  grants,
  onChange,
}: {
  projectId: string;
  grants: Grant[];
  onChange: (grants: Grant[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const size = 20;
  const members = useApiQuery<MemberPage>(
    ["job-members", projectId, filter, page],
    `/projects/${projectId}/members?${new URLSearchParams({ q: filter, page: String(page), page_size: String(size) })}`,
  );
  const roles = useApiQuery<{ items: ScopedRole[] }>(
    ["job-roles", projectId],
    `/projects/${projectId}/roles`,
  );
  const memberRows = members.data?.data.items ?? [];
  const roleRows = roles.data?.data.items ?? [];
  const total = members.data?.data.total ?? 0;

  function toggle(kind: string, id: string, checked: boolean) {
    onChange(
      checked
        ? [...grants, { kind, id }]
        : grants.filter((g) => g.kind !== kind || g.id !== id),
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted">
        项目管理员始终可以运行。其他成员可按个人或项目角色授权。
      </p>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">项目成员</h3>
        <StandaloneInput
          aria-label="搜索项目成员"
          placeholder="搜索项目成员"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        />
        <AsyncBoundary
          loading={members.isPending}
          error={members.error}
          empty={!memberRows.length}
          emptyCompact
          emptyTitle="没有匹配的成员"
          onRetry={() => void members.refetch()}
        >
          <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {memberRows.map((member) => (
              <label
                key={member.user_id}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={grants.some(
                    (g) => g.kind === "user" && g.id === member.user_id,
                  )}
                  onChange={(e) =>
                    toggle("user", member.user_id, e.target.checked)
                  }
                />
                <span className="min-w-0 wrap-anywhere">
                  {member.display_name}{" "}
                  <span className="text-muted">@{member.username}</span>
                </span>
              </label>
            ))}
          </div>
        </AsyncBoundary>
        {(total > size || page > 1) && (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="text-xs text-muted">第 {page} 页</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page * size >= total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">项目角色</h3>
        <AsyncBoundary
          loading={roles.isPending}
          error={roles.error}
          empty={!roleRows.length}
          emptyCompact
          emptyTitle="暂无项目角色"
          onRetry={() => void roles.refetch()}
        >
          {roleRows.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={grants.some(
                  (g) => g.kind === "role" && g.id === role.id,
                )}
                onChange={(e) => toggle("role", role.id, e.target.checked)}
              />
              {role.name}
            </label>
          ))}
        </AsyncBoundary>
      </div>
    </div>
  );
}

function ParameterEditor({
  value,
  onChange,
}: {
  value: Parameter[];
  onChange: (value: Parameter[]) => void;
}) {
  function change(i: number, p: Partial<Parameter>) {
    onChange(value.map((v, n) => (n === i ? { ...v, ...p } : v)));
  }
  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">
              {p.label || p.name || `参数 ${i + 1}`}
            </span>
            <IconButton
              label="删除参数"
              variant="ghost"
              size="iconSm"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              <X />
            </IconButton>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="参数名">
              <Input
                value={p.name}
                onChange={(e) => change(i, { name: e.target.value })}
              />
            </Field>
            <Field label="显示名称">
              <Input
                value={p.label}
                onChange={(e) => change(i, { label: e.target.value })}
              />
            </Field>
          </div>
          <Field label="类型">
            <Select
              value={p.type}
              onValueChange={(value) =>
                change(i, {
                  type: value as Parameter["type"],
                  default: undefined,
                })
              }
            >
              <option value="text">文本</option>
              <option value="select">单选</option>
              <option value="multiselect">多选</option>
            </Select>
          </Field>
          {p.type !== "text" && (
            <Field label="选项（每行一个）">
              <Textarea
                value={p.options?.join("\n") ?? ""}
                onChange={(e) =>
                  change(i, { options: e.target.value.split("\n") })
                }
              />
            </Field>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.default !== undefined}
              onChange={(e) =>
                change(i, {
                  default: e.target.checked
                    ? p.type === "multiselect"
                      ? []
                      : ""
                    : undefined,
                })
              }
            />
            设置默认值
          </label>
          {p.default !== undefined && (
            <Inputs
              parameters={[
                { ...p, label: "默认值", required: false, default: undefined },
              ]}
              value={{ [p.name]: p.default }}
              onChange={(next) =>
                change(i, {
                  default: next[p.name] ?? (p.type === "multiselect" ? [] : ""),
                })
              }
            />
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => change(i, { required: e.target.checked })}
            />
            必填
          </label>
        </div>
      ))}
      {!value.length && (
        <p className="text-sm text-muted">此作业无需输入参数。</p>
      )}
    </div>
  );
}
