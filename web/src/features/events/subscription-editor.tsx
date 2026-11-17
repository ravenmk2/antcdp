import { useRef, useState, type FormEvent } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Panel } from "@/components/layout";
import { Drawer } from "@/components/overlays";
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
    return (
      <Editor
        key={source.data?.data.revision.id ?? "new"}
        {...props}
        source={source.data?.data}
      />
    );
  return (
    <Drawer open title={`订阅：${subscription.name}`} onClose={props.onClose}>
      <AsyncBoundary
        loading={source.isPending}
        error={source.error}
        onRetry={() => source.refetch()}
      />
    </Drawer>
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
    setError(undefined);
    if (
      !draft.name.trim() ||
      !draft.executor_user_id ||
      !draft.event_types.length
    ) {
      setError(new Error("请填写名称，选择执行机器人和至少一种事件类型"));
      return;
    }
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
  return (
    <Drawer
      open
      title={subscription ? `订阅：${subscription.name}` : "新建事件订阅"}
      onClose={onClose}
      pending={pending}
      dirty={!readOnly && initial.current !== JSON.stringify(draft)}
    >
      <form onSubmit={(e) => void save(e)} className="space-y-5">
        <ErrorNotice error={error} />
        <ErrorNotice error={robots.error} />
        <fieldset disabled={pending || readOnly} className="space-y-4">
          <Field label="订阅名称" required>
            <Input
              value={draft.name}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="说明">
            <Textarea
              value={draft.description}
              maxLength={1000}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </Field>
          <Field label="状态">
            <Select
              value={String(draft.enabled)}
              onValueChange={(v) =>
                setDraft({ ...draft, enabled: v === "true" })
              }
            >
              <option value="false">停用</option>
              <option value="true">启用</option>
            </Select>
          </Field>
          <Field label="执行机器人" required>
            <Select
              value={draft.executor_user_id}
              onValueChange={(value) =>
                setDraft({ ...draft, executor_user_id: value })
              }
            >
              <option value="">选择项目机器人成员</option>
              {draft.executor_user_id &&
                !robots.data?.data.items.some(
                  (u) => u.id === draft.executor_user_id,
                ) && (
                  <option value={draft.executor_user_id}>
                    机器人 #{draft.executor_user_id}（当前不可用）
                  </option>
                )}
              {robots.data?.data.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username})
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium">事件类型</legend>
            {groups.map((group) => (
              <div
                key={group.code}
                className="space-y-2 rounded-lg border border-border p-3"
              >
                <h3 className="font-medium">{group.name}</h3>
                {group.types.map((type) => (
                  <label
                    key={type.code}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={draft.event_types.includes(type.code)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          event_types: e.target.checked
                            ? [...draft.event_types, type.code]
                            : draft.event_types.filter((v) => v !== type.code),
                        })
                      }
                    />
                    <span>
                      {type.name}
                      <span className="block text-xs text-muted">
                        {type.code} · {type.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <Field label="超时（秒）">
              <Input
                type="number"
                min={1}
                max={600}
                value={draft.timeout_ms / 1000}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    timeout_ms: Number(e.target.value) * 1000,
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
                onChange={(e) =>
                  setDraft({ ...draft, max_retries: Number(e.target.value) })
                }
              />
            </Field>
          </div>
        </fieldset>
        <Notice>
          每个订阅顺序消费，失败后间隔 30
          秒重试；重试耗尽后继续下一条。停用时暂停待执行记录，重新启用不补发历史事件。
        </Notice>
        <Panel title="消费脚本">
          <ScriptEditor
            value={draft.script}
            onChange={(script) => setDraft({ ...draft, script })}
            readOnly={readOnly || pending}
            label="事件消费 JavaScript 脚本"
          />
        </Panel>
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
        {!readOnly && (
          <Button type="submit" pending={pending}>
            保存订阅
          </Button>
        )}
        {subscription && (
          <Panel title="脚本修订历史">
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
          </Panel>
        )}
      </form>
    </Drawer>
  );
}
