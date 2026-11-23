import { useState } from "react";
import { Link } from "react-router";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input, Select } from "@/components/fields";
import { AsyncBoundary } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import type { AgentDefinition } from "@/types/agents";
import type { SpecBinding, SandboxSpec } from "@/types/cloud-computer";
import { agentAdminRoot, sandboxAdminRoot } from "../data/agent-api";
import { ConfigActions, useResourceSave } from "../resources/admin-shared";
import { useCloudSave } from "./use-cloud-save";

export function CloudSpecBindingEditor({
  agent,
  onSaved,
  readOnly = false,
}: {
  agent?: ApiResponse<AgentDefinition>;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = agent
    ? `${agentAdminRoot}/definitions/${agent.data.id}/cloud-computer-spec`
    : `${agentAdminRoot}/cloud-computer-spec`;
  const query = useApiQuery<SpecBinding>(["cloud-spec-binding", path], path);
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
              to={`/admin/cloud-computers?pool_robot_id=${agent.data.robot_user_id}`}
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
            <Panel title="云电脑创建规格" bodyClassName="p-6">
              <SpecSummary spec={query.data.data.spec} />
            </Panel>
          ) : (
            <BindingForm
              key={path}
              agentId={agent?.data.id}
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
                to={`/admin/cloud-computers?pool_robot_id=${initial.data.robot_user_id}`}
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
export function SpecSummary({ spec }: { spec: SandboxSpec | null }) {
  if (!spec) return <p>尚未选择沙箱规格</p>;
  const n = spec.network;
  return (
    <dl className="agent-read-facts grid gap-4 sm:grid-cols-2">
      {[
        ["规格", spec.name],
        ["版本", spec.config_version],
        ["容器镜像", spec.image],
        ["CPU（毫核）", spec.cpu_millicores],
        ["内存（MiB）", spec.memory_mib],
        ["默认网络策略", n.default_action === "allow" ? "允许" : "禁止"],
        ["网络预设", n.preset_ids.join("、") || "无"],
        ["允许的目标", n.allow_targets.join("、") || "无"],
        ["禁止的目标", n.deny_targets.join("、") || "无"],
      ].map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
export function SpecPicker({
  value,
  onChange,
  showSummary = false,
}: {
  value: string;
  onChange: (id: string) => void;
  showSummary?: boolean;
}) {
  const q = useApiQuery<SandboxSpec[]>(
    ["sandbox-specs"],
    sandboxAdminRoot + "/specs",
  );
  return (
    <AsyncBoundary
      loading={q.isPending}
      error={q.error}
      onRetry={() => q.refetch()}
    >
      <Field label="沙箱规格">
        <Select value={value} onValueChange={onChange}>
          <option value="">尚未选择</option>
          {q.data?.data.map((v) => (
            <option value={v.id} key={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      </Field>
      {showSummary && (
        <SpecSummary spec={q.data?.data.find((v) => v.id === value) ?? null} />
      )}
      {q.data?.data.length === 0 && (
        <Link to="/admin/sandboxes?tab=specs">创建沙箱规格</Link>
      )}
    </AsyncBoundary>
  );
}
function BindingForm({
  agentId,
  path,
  initial,
  onSaved,
}: {
  path: string;
  agentId?: string;
  initial: ApiResponse<SpecBinding>;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial.data.spec_id ?? ""),
    [baseline, setBaseline] = useState(value);
  const dirty = value !== baseline;
  const save = useCloudSave({
    path,
    initial,
    onSaved,
    dirty,
    commandName: "cloud_spec_binding.update",
    scope: agentId ? `cloud_spec_binding:${agentId}` : "cloud_spec_binding",
    adopt(v) {
      setValue(v.spec_id ?? "");
      setBaseline(v.spec_id ?? "");
    },
  });
  return (
    <Panel title="云电脑创建规格" bodyClassName="space-y-5 p-6">
      {save.recovery}
      <fieldset disabled={save.pending || save.blocked} className="space-y-4">
        <SpecPicker value={value} onChange={setValue} showSummary />
      </fieldset>
      <ConfigActions
        dirty={dirty}
        pending={save.pending}
        blocked={save.blocked}
      >
        <Button
          disabled={!dirty || save.blocked}
          pending={save.pending}
          onClick={() => void save.save({ spec_id: value || null })}
        >
          保存规格选择
        </Button>
      </ConfigActions>
    </Panel>
  );
}
