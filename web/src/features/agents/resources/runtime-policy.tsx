import { useState } from "react";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input } from "@/components/fields";
import { Panel } from "@/components/layout";
import type { AgentDefinition, RuntimePolicy } from "@/types/agents";
import { agentAdminRoot } from "../data/agent-api";
import {
  ConfigActions,
  ResourceSection,
  useResourceSave,
} from "./admin-shared";
const limitGroups: {
  title: string;
  description: string;
  fields: [keyof RuntimePolicy, string, number, number][];
}[] = [
  {
    title: "调用与并行",
    description: "限制单轮任务的执行次数与并发。",
    fields: [
      ["max_steps", "最大推理步数", 1, 200],
      ["max_model_calls", "模型调用上限", 1, 1000],
      ["max_tool_calls", "工具调用上限", 1, 1000],
      ["max_children", "子任务上限", 0, 8],
      ["max_parallel_tools", "同时执行的工具数", 1, 16],
    ],
  },
  {
    title: "等待与截止",
    description: "设置运行、排队和交互的最长等待时间。",
    fields: [
      ["run_timeout_seconds", "运行期限（秒）", 60, 86400],
      ["queue_timeout_seconds", "排队期限（秒）", 60, 86400],
      ["question_timeout_seconds", "问题等待期限（秒）", 5, 600],
      ["approval_timeout_seconds", "审批期限（秒）", 15, 900],
    ],
  },
  {
    title: "Token 预算",
    description: "分别限制本轮累计输入与输出用量。",
    fields: [
      ["max_input_tokens", "输入 Token 预算", 1, 10000000],
      ["max_output_tokens", "输出 Token 预算", 1, 10000000],
    ],
  },
];

export function AgentRuntimePolicy({
  initial,
  onSaved,
  readOnly = false,
}: {
  initial: ApiResponse<AgentDefinition>;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(initial.data.runtime_policy),
    [baseline, setBaseline] = useState(initial.data.runtime_policy);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    enabled: !readOnly,
    path: `${agentAdminRoot}/definitions/${initial.data.id}`,
    initial,
    dirty,
    adopt: (value) => {
      setDraft(value.runtime_policy);
      setBaseline(value.runtime_policy);
    },
    complete: onSaved,
  });
  return (
    <Panel bodyClassName="p-6">
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save.save({ runtime_policy: draft });
        }}
      >
        {save.recovery}
        <ResourceSection
          title="执行预算与期限"
          description="主任务和临时子任务共享本轮预算与截止时间。新轮次在实际开始时读取配置，已开始的轮次不受后续修改影响。"
        >
          <div className="agent-runtime-groups">
            {limitGroups.map((group) => (
              <fieldset
                key={group.title}
                disabled={save.pending || save.blocked}
                className="agent-runtime-group"
              >
                <legend className="px-1 text-sm font-semibold">
                  {group.title}
                </legend>
                <p className="mb-5 text-xs leading-5 text-muted">
                  {group.description}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                  {group.fields
                    .filter(
                      ([key]) =>
                        initial.data.agent_type !== "service" ||
                        key !== "approval_timeout_seconds",
                    )
                    .map(([key, label, min, max]) =>
                      readOnly ? (
                        <dl key={key} className="agent-read-facts">
                          <div>
                            <dt>{label}</dt>
                            <dd className="text-xl font-semibold tabular-nums">
                              {draft[key].toLocaleString()}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <Field
                          key={key}
                          label={label}
                          hint={`${min.toLocaleString()}–${max.toLocaleString()}`}
                        >
                          <Input
                            required
                            type="number"
                            min={min}
                            max={max}
                            step={1}
                            name={key}
                            value={draft[key]}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                [key]: Number(event.target.value),
                              })
                            }
                          />
                        </Field>
                      ),
                    )}
                </div>
              </fieldset>
            ))}
          </div>
        </ResourceSection>
        {!readOnly && (
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
              保存预算
            </Button>
            <Button
              variant="outline"
              disabled={save.pending || save.blocked || !dirty}
              onClick={() => setDraft(baseline)}
            >
              取消修改
            </Button>
          </ConfigActions>
        )}
      </form>
    </Panel>
  );
}
