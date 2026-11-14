import { useState } from "react";
import { Link } from "react-router";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input } from "@/components/fields";
import { AsyncBoundary } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { AgentDefinition } from "@/types/agents";
import type { CloudTemplate } from "@/types/cloud-computer";
import { agentAdminRoot } from "../data/agent-api";
import { ConfigActions, useResourceSave } from "../resources/admin-shared";
import {
  NetworkPolicyEditor,
  normalizeNetworkDraft,
} from "../sandbox/network-editor";
import { useCloudSave } from "./use-cloud-save";

export function CloudTemplateEditor({
  agent,
  onSaved,
  readOnly = false,
}: {
  agent?: ApiResponse<AgentDefinition>;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = agent
    ? `${agentAdminRoot}/definitions/${agent.data.id}/cloud-computer-template`
    : `${agentAdminRoot}/cloud-computer-template`;
  const query = useApiQuery<CloudTemplate>(["cloud-template", path], path);
  const refresh = () => {
    void query.refetch();
    onSaved();
  };
  return (
    <div className="space-y-6">
      {agent &&
        (readOnly ? (
          <Panel title="专属机器人云电脑池" bodyClassName="p-6">
            <dl className="agent-read-facts">
              <div>
                <dt>池容量</dt>
                <dd>{agent.data.pool_capacity ?? 1} 台</dd>
              </div>
            </dl>
            <Link
              className="mt-4 inline-block text-sm text-primary"
              to={`/admin/cloud-computers?pool_agent_id=${agent.data.id}`}
            >
              查看云电脑
            </Link>
          </Panel>
        ) : (
          <PoolCapacity initial={agent} onSaved={onSaved} />
        ))}
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (readOnly ? (
            <Panel title="云电脑创建配置" bodyClassName="p-6">
              <dl className="agent-read-facts grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt>容器镜像</dt>
                  <dd>{query.data.data.environment.image}</dd>
                </div>
                <div>
                  <dt>CPU（毫核）</dt>
                  <dd>
                    {query.data.data.environment.cpu_millicores.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>内存（MiB）</dt>
                  <dd>
                    {query.data.data.environment.memory_mib.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>默认网络策略</dt>
                  <dd>
                    {query.data.data.environment.network.default_action ===
                    "allow"
                      ? "允许"
                      : "禁止"}
                  </dd>
                </div>
                <div>
                  <dt>网络预设</dt>
                  <dd>
                    {query.data.data.environment.network.preset_ids.join(
                      "、",
                    ) || "无"}
                  </dd>
                </div>
                <div>
                  <dt>允许的目标</dt>
                  <dd className="whitespace-pre-wrap">
                    {query.data.data.environment.network.allow_targets.join(
                      "\n",
                    ) || "无"}
                  </dd>
                </div>
                <div>
                  <dt>禁止的目标</dt>
                  <dd className="whitespace-pre-wrap">
                    {query.data.data.environment.network.deny_targets.join(
                      "\n",
                    ) || "无"}
                  </dd>
                </div>
              </dl>
            </Panel>
          ) : (
            <TemplateForm
              key={path}
              path={path}
              initial={query.data}
              onSaved={refresh}
            />
          ))}
      </AsyncBoundary>
    </div>
  );
}
function PoolCapacity({
  initial,
  onSaved,
}: {
  initial: ApiResponse<AgentDefinition>;
  onSaved: () => void;
}) {
  const [capacity, setCapacity] = useState(initial.data.pool_capacity ?? 1),
    [baseline, setBaseline] = useState(capacity);
  const save = useResourceSave({
    path: `${agentAdminRoot}/definitions/${initial.data.id}`,
    initial,
    dirty: capacity !== baseline,
    adopt: (v) => {
      setCapacity(v.pool_capacity!);
      setBaseline(v.pool_capacity!);
    },
    complete: onSaved,
  });
  return (
    <Panel bodyClassName="p-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.save({ pool_capacity: capacity });
        }}
      >
        {save.recovery}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">专属机器人云电脑池</h2>
            <p className="mt-1 text-sm text-muted">
              电脑按需创建，每轮独占。新会话优先使用空闲最久的电脑，继续会话等待原电脑。
            </p>
          </div>
          <Button
            render={
              <Link
                to={`/admin/cloud-computers?pool_agent_id=${initial.data.id}`}
              >
                查看云电脑
              </Link>
            }
            nativeButton={false}
            role="link"
            variant="outline"
          />
        </div>
        <Field label="池容量" hint="缩小容量不会自动删除已有电脑。">
          <Input
            className="max-w-48"
            type="number"
            min={1}
            max={100}
            required
            value={capacity}
            disabled={save.pending || save.blocked}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </Field>
        <Button
          type="submit"
          pending={save.pending}
          disabled={save.blocked || capacity === baseline}
        >
          保存容量
        </Button>
      </form>
    </Panel>
  );
}
function TemplateForm({
  path,
  initial,
  onSaved,
}: {
  path: string;
  initial: ApiResponse<CloudTemplate>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial.data.environment),
    [baseline, setBaseline] = useState(initial.data.environment);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useCloudSave({
    path,
    initial,
    commandName: "cloud_template.update",
    scope: initial.data.agent_id
      ? `cloud_template:${initial.data.agent_id}`
      : "cloud_template",
    dirty,
    adopt: (v) => {
      setDraft(v.environment);
      setBaseline(v.environment);
    },
    onSaved,
  });
  return (
    <Panel bodyClassName="p-6">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save.save({
            ...draft,
            network: normalizeNetworkDraft(draft.network),
          });
        }}
      >
        <div>
          <h2 className="font-semibold">
            {initial.data.agent_id
              ? "服务型云电脑创建配置"
              : "个人云电脑统一创建配置"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            仅在创建或管理员主动重建时应用。已有电脑继续使用其实际配置；云电脑不会因空闲自动删除。
          </p>
        </div>
        {save.recovery}
        <fieldset disabled={save.pending || save.blocked} className="space-y-6">
          <Field
            label="容器镜像"
            hint="使用明确版本标签或 sha256 摘要。镜像须包含平台要求的运行环境。"
            required
          >
            <Input
              name="image"
              required
              maxLength={512}
              placeholder="registry.example.com/agent-runtime:1.0.0"
              value={draft.image}
              onChange={(e) => setDraft({ ...draft, image: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-6">
            <Field label="CPU（毫核）">
              <Input
                required
                type="number"
                min={100}
                max={32000}
                value={draft.cpu_millicores}
                onChange={(e) =>
                  setDraft({ ...draft, cpu_millicores: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="内存（MiB）">
              <Input
                required
                type="number"
                min={128}
                max={65536}
                value={draft.memory_mib}
                onChange={(e) =>
                  setDraft({ ...draft, memory_mib: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <NetworkPolicyEditor
            value={draft.network}
            onChange={(network) => setDraft({ ...draft, network })}
          />
        </fieldset>
        <ConfigActions
          dirty={dirty}
          pending={save.pending}
          blocked={save.blocked}
        >
          <Button
            type="submit"
            pending={save.pending}
            disabled={!dirty || save.blocked}
          >
            保存创建配置
          </Button>
          <Button
            variant="outline"
            disabled={save.pending || save.blocked}
            onClick={() => setDraft(baseline)}
          >
            取消修改
          </Button>
        </ConfigActions>
      </form>
    </Panel>
  );
}
