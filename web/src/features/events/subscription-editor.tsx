import { useId, useRef, useState, type FormEvent } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  Textarea,
} from "@/components/fields";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { ScriptEditor } from "@/components/script-editor";
import { CopyButton } from "@/components/copy-button";
import { useApiQuery } from "@/hooks/use-api";
import { formatDate } from "@/lib/utils";
import {
  exampleScript,
  type Group,
  type Revision,
  type Source,
  type Subscription,
} from "./types";

type EditorProps = {
  base: string;
  projectCode: string;
  subscription?: Subscription;
  readOnly: boolean;
  groups: Group[];
  onClose: () => void;
  onSaved: () => void;
};
export function SubscriptionEditor(props: EditorProps) {
  const { base, subscription } = props;
  const source = useApiQuery<Source>(
    ["event-source", base, subscription?.id, subscription?.revision_id],
    `${base}/event-subscriptions/${subscription?.id}/source`,
    { enabled: Boolean(subscription) },
  );
  if (!subscription || source.data)
    return <Editor {...props} source={source.data?.data} />;
  return (
    <Modal open title={subscription.name} onClose={props.onClose}>
      <AsyncBoundary
        loading={source.isPending}
        error={source.error}
        onRetry={() => source.refetch()}
      />
    </Modal>
  );
}

function Editor({
  base,
  projectCode,
  subscription,
  source,
  readOnly,
  groups,
  onSaved,
  onClose,
}: EditorProps & { source?: Source }) {
  const [draft, setDraft] = useState({
    name: subscription?.name ?? "",
    description: subscription?.description ?? "",
    enabled: subscription?.enabled ?? false,
    event_types: source?.revision.event_types ?? ([] as string[]),
    executor_user_id: source?.revision.executor_user_id ?? "",
    script: source?.script ?? exampleScript,
    timeout_ms: source?.revision.timeout_ms ?? 60000,
    max_retries: source?.revision.max_retries ?? 3,
  });
  const initial = useRef(JSON.stringify(draft));
  const formId = useId();
  const [attempted, setAttempted] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const dirty = initial.current !== JSON.stringify(draft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [historic, setHistoric] = useState("");
  const robots = useApiQuery<{
    items: { id: string; name: string; username: string }[];
  }>(["event-robots", base], `${base}/event-subscriptions/robot-options`);
  const jobs = useApiQuery<{
    items: { id: string; code: string; name: string }[];
  }>(["event-job-paths", base], `${base}/jobs`);
  const revisions = useApiQuery<{ items: Revision[] }>(
    ["event-revisions", base, subscription?.id, subscription?.revision_id],
    `${base}/event-subscriptions/${subscription?.id}/revisions`,
    { enabled: Boolean(subscription) },
  );
  const old = useApiQuery<Source>(
    ["event-historic-source", base, subscription?.id, historic],
    `${base}/event-subscriptions/${subscription?.id}/revisions/${historic}/source`,
    { enabled: Boolean(historic && subscription) },
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly) return;
    setError(undefined);
    setAttempted(true);
    if (
      !draft.name.trim() ||
      !draft.executor_user_id ||
      !draft.event_types.length
    )
      return;
    setPending(true);
    try {
      await request(
        `${base}/event-subscriptions${subscription ? `/${subscription.id}` : ""}`,
        {
          method: subscription ? "PUT" : "POST",
          body: { ...draft, version: subscription?.version ?? "" },
        },
      );
      initial.current = JSON.stringify(draft);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }
  const term = eventSearch.trim().toLocaleLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      types: group.types.filter(
        (type) =>
          !term ||
          `${type.name} ${type.code}`.toLocaleLowerCase().includes(term),
      ),
    }))
    .filter((group) => group.types.length);
  const robotOptions = robots.data?.data.items ?? [];
  return (
    <Modal
      open
      wide
      className="max-w-[min(1320px,calc(100vw-48px))]"
      title={
        subscription
          ? readOnly
            ? subscription.name
            : `编辑 ${subscription.name}`
          : "新建事件订阅"
      }
      description={
        readOnly
          ? "查看订阅配置、脚本和修订历史。"
          : "选择触发事件，并编写事件到达后执行的脚本。"
      }
      onClose={onClose}
      pending={pending}
      dirty={!readOnly && dirty}
      footer={
        <>
          {!readOnly && dirty && (
            <span className="mr-auto text-xs text-muted">有未保存的修改</span>
          )}
          <OverlayCancelButton>
            {readOnly ? "关闭" : "取消"}
          </OverlayCancelButton>
          {!readOnly && (
            <Button type="submit" form={formId} pending={pending}>
              保存订阅
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void save(event)}
        className="space-y-4"
      >
        {Boolean(error) && (
          <div className="sticky top-0 z-10 bg-surface pb-2">
            <ErrorNotice error={error} />
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_410px] items-start gap-5 max-lg:grid-cols-1">
          <div className="min-w-0 space-y-3">
            <section
              className="overflow-hidden rounded-xl border border-border"
              aria-label="消费脚本"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-4 py-3">
                <h2 className="text-sm font-semibold">消费脚本</h2>
                <code className="text-xs text-muted">
                  async function main(ctx)
                </code>
              </header>
              <div className="[&>div]:rounded-none [&>div]:border-0 [&_.cm-editor]:h-[clamp(340px,46dvh,520px)]!">
                <ScriptEditor
                  value={draft.script}
                  onChange={(script) =>
                    setDraft((current) => ({ ...current, script }))
                  }
                  readOnly={readOnly || pending}
                  label="事件消费 JavaScript 脚本"
                />
              </div>
            </section>
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer font-medium">
                脚本 API 与资源路径
              </summary>
              <div className="mt-3 space-y-3 text-sm">
                <p>
                  入口为 async function main(ctx)。ctx.event 是只读事件，ctx.run
                  提供本次消费信息。正常返回表示消费成功，抛出异常进入重试。
                </p>
                <pre className="overflow-auto whitespace-pre-wrap text-xs">{`await ctx.jobs.get("build").start({ inputs: {}, requestKey: "build:" + ctx.event.id });
await ctx.agents.get("platform/reviewer").chat({ message: "审查内容", title: "MR 审查", requestKey: "review:" + ctx.event.id });
const entry = await ctx.state.get("key"); // { value, etag } 或 null
await ctx.state.put("key", { done: true }, { ifAbsent: true });
await ctx.state.delete("key", { ifMatch: entry.etag });
ctx.log.info("处理完成", { eventId: ctx.event.id });
await ctx.sleep(1000);`}</pre>
                <p>
                  路径可省略开头的 /。单段编码指向当前项目；完整路径支持
                  platform/code、team/team-code/code、project/project-code/code。Job
                  仅可启动本项目任务。
                </p>
                <p>
                  requestKey
                  在同一订阅内长期有效；已受理的相同请求返回原结果，参数改变会报冲突。调用返回受理结果，不等待
                  Job
                  或智能体完成。智能体总是开启新会话，其内容仅平台管理员可在控制台查看。
                </p>
                <p>
                  ctx.state
                  仅属于当前订阅。人工重试使用当前配置与原事件，脚本应选择稳定的业务幂等键。
                </p>
                {jobs.data?.data.items.map((job) => (
                  <div key={job.id} className="flex items-center gap-2">
                    <code>{`project/${projectCode}/${job.code}`}</code>
                    <span className="text-muted">{job.name}</span>
                    <CopyButton
                      value={`project/${projectCode}/${job.code}`}
                      label={`复制 ${job.name} 路径`}
                    />
                  </div>
                ))}
              </div>
            </details>
            {subscription && (
              <details className="rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  脚本修订历史
                </summary>
                <div className="mt-3 space-y-3">
                  <ErrorNotice error={revisions.error} />
                  <Field label="查看修订">
                    <Select value={historic} onValueChange={setHistoric}>
                      <option value="">选择历史修订</option>
                      {revisions.data?.data.items.map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          修订 {revision.revision_no} ·{" "}
                          {formatDate(revision.created_at)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {historic && (
                    <AsyncBoundary
                      loading={old.isPending}
                      error={old.error}
                      onRetry={() => old.refetch()}
                    >
                      {old.data && (
                        <ScriptEditor
                          key={old.data.data.revision.id}
                          value={old.data.data.script}
                          onChange={() => {}}
                          readOnly
                          label="历史消费脚本"
                        />
                      )}
                    </AsyncBoundary>
                  )}
                </div>
              </details>
            )}
          </div>

          <fieldset
            disabled={pending || readOnly}
            className="min-w-0 overflow-hidden rounded-xl border border-border"
          >
            <div className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">基本信息</h2>
              <Field
                label="订阅名称"
                required
                error={
                  attempted && !draft.name.trim() ? "请输入订阅名称" : undefined
                }
              >
                <Input
                  value={draft.name}
                  placeholder="例如 合并请求审查"
                  maxLength={100}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <Field label="说明">
                <Textarea
                  rows={2}
                  maxLength={1000}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </Field>
              <Field
                label="执行机器人"
                required
                error={
                  attempted && !draft.executor_user_id
                    ? "请选择执行机器人"
                    : undefined
                }
                hint={
                  robots.isPending
                    ? "正在读取项目机器人…"
                    : !robots.error && !robotOptions.length
                      ? "暂无可用的项目机器人成员。"
                      : undefined
                }
              >
                <Select
                  value={draft.executor_user_id}
                  onValueChange={(value) =>
                    setDraft({ ...draft, executor_user_id: value })
                  }
                >
                  <option value="">选择项目机器人成员</option>
                  {draft.executor_user_id &&
                    !robotOptions.some(
                      (robot) => robot.id === draft.executor_user_id,
                    ) && (
                      <option value={draft.executor_user_id}>
                        机器人 #{draft.executor_user_id}（当前不可用）
                      </option>
                    )}
                  {robotOptions.map((robot) => (
                    <option key={robot.id} value={robot.id}>
                      {robot.name} ({robot.username})
                    </option>
                  ))}
                </Select>
              </Field>
              <ErrorNotice error={robots.error} />
            </div>
            <section
              className="space-y-2 border-t border-border px-4 py-3"
              aria-label="事件类型"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  事件类型 <span className="text-danger">*</span>
                </h2>
                <span className="text-xs text-muted">
                  已选 {draft.event_types.length} 项
                </span>
              </div>
              {attempted && !draft.event_types.length && (
                <p role="alert" className="text-xs text-danger">
                  请选择至少一种事件类型
                </p>
              )}
              {groups.length > 0 && !readOnly && (
                <StandaloneInput
                  aria-label="搜索事件类型"
                  placeholder="搜索事件名称或编码"
                  value={eventSearch}
                  onChange={(event) => setEventSearch(event.target.value)}
                />
              )}
              <div className="max-h-56 space-y-3 overflow-auto pr-1">
                {visibleGroups.map((group) => (
                  <div key={group.code} className="space-y-1">
                    <h3 className="py-1 text-xs font-medium text-muted">
                      {group.name}
                    </h3>
                    {group.types.map((type) => (
                      <label
                        key={type.code}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={draft.event_types.includes(type.code)}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              event_types: event.target.checked
                                ? [...draft.event_types, type.code]
                                : draft.event_types.filter(
                                    (value) => value !== type.code,
                                  ),
                            })
                          }
                        />
                        <span>
                          {type.name}
                          <code
                            className="block text-xs wrap-anywhere text-muted"
                            title={type.description}
                          >
                            {type.code}
                          </code>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
                {term && !visibleGroups.length && (
                  <p className="py-2 text-sm text-muted">
                    没有匹配的事件类型。
                  </p>
                )}
                {!groups.length && (
                  <p className="py-2 text-sm text-muted">
                    暂时没有可选的事件类型。
                  </p>
                )}
              </div>
            </section>
            <details className="border-t border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
                执行设置
                <span className="text-xs font-normal text-muted">
                  {draft.enabled ? "已启用" : "已停用"} · 重试{" "}
                  {draft.max_retries} 次
                </span>
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <Field label="订阅状态">
                  <Select
                    value={String(draft.enabled)}
                    onValueChange={(value) =>
                      setDraft({ ...draft, enabled: value === "true" })
                    }
                  >
                    <option value="false">停用</option>
                    <option value="true">启用</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="超时（秒）">
                    <Input
                      type="number"
                      min={1}
                      max={600}
                      value={draft.timeout_ms / 1000}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          timeout_ms: Number(event.target.value) * 1000,
                        })
                      }
                    />
                  </Field>
                  <Field label="自动重试次数">
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={draft.max_retries}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          max_retries: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="text-xs leading-5 text-muted">
                  每个订阅顺序消费，失败后间隔 30
                  秒重试。停用时暂停待执行记录，重新启用时接收新事件。
                </p>
              </div>
            </details>
          </fieldset>
        </div>
      </form>
    </Modal>
  );
}
