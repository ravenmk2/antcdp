import { useState } from "react";
import { Link } from "react-router";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, EmptyState, ErrorNotice } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api";
import type {
  BindingCollection,
  SkillBinding,
  SkillBindingWrite,
} from "@/types/agents";
import type { Skill, SkillVersionSummary } from "@/types/agent-resources";
import { agentAdminRoot, agentKeys } from "../data/agent-api";
import { ConfigActions, EnabledState, useResourceSave } from "./admin-shared";
import { ResourcePicker } from "./resource-picker";

export function AgentSkillBindings({
  agentId,
  onSaved,
  readOnly = false,
}: {
  agentId: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const path = `${agentAdminRoot}/definitions/${agentId}/skill-bindings`;
  const query = useApiQuery<BindingCollection<SkillBinding>>(
    [...agentKeys, agentId, "skills"],
    path,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <SkillBindingsForm
          key={`${agentId}:${readOnly ? query.data.etag : "edit"}`}
          initial={query.data}
          path={path}
          onSaved={onSaved}
          readOnly={readOnly}
        />
      )}
    </AsyncBoundary>
  );
}

function SkillBindingsForm({
  initial,
  path,
  onSaved,
  readOnly = false,
}: {
  initial: ApiResponse<BindingCollection<SkillBinding>>;
  path: string;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const from = (value: BindingCollection<SkillBinding>): SkillBindingWrite[] =>
    value.items.map(({ skill_id, skill_version_id, enabled }) => ({
      skill_id,
      skill_version_id,
      enabled,
    }));
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data));
  const [picking, setPicking] = useState(false),
    [versionSkill, setVersionSkill] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const save = useResourceSave({
    enabled: !readOnly,
    path,
    initial,
    method: "PUT",
    dirty,
    adopt: (value) => {
      setDraft(from(value));
      setBaseline(from(value));
    },
    complete: onSaved,
  });
  const locked = save.pending || save.blocked;
  return (
    <Panel bodyClassName="p-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="font-semibold">
              固定版本技能{" "}
              <span className="text-muted">{draft.length} / 32</span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              选择明确版本后供智能体使用。新版发布不会自动替换，版本切换会等待旧轮次释放对应目录。
            </p>
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              disabled={locked || draft.length >= 32}
              onClick={() => setPicking(true)}
            >
              添加技能
            </Button>
          )}
        </div>
        {save.recovery}
        {draft.length ? (
          <div className="divide-y rounded-lg border">
            {draft.map((item) => (
              <div key={item.skill_id} className="flex items-center gap-5 p-4">
                <SkillLabel item={item} />
                {readOnly ? (
                  <EnabledState enabled={item.enabled} />
                ) : (
                  <>
                    <Switch
                      checked={item.enabled}
                      aria-label={`启用技能 ${item.skill_id}`}
                      disabled={locked}
                      onCheckedChange={(enabled) =>
                        setDraft(
                          draft.map((v) =>
                            v.skill_id === item.skill_id
                              ? { ...v, enabled }
                              : v,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => setVersionSkill(item.skill_id)}
                    >
                      选择版本
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={locked}
                      onClick={() =>
                        setDraft(
                          draft.filter((v) => v.skill_id !== item.skill_id),
                        )
                      }
                    >
                      移除
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="尚未绑定技能"
            description="绑定技能后，每轮执行会固定其内容并准备只读目录。"
          />
        )}
        {!readOnly && (
          <ConfigActions
            dirty={dirty}
            pending={save.pending}
            blocked={save.blocked}
          >
            <Button
              pending={save.pending}
              disabled={
                !dirty || locked || draft.some((item) => !item.skill_version_id)
              }
              onClick={() => void save.save({ items: draft })}
            >
              保存技能
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => setDraft(baseline)}
            >
              取消修改
            </Button>
          </ConfigActions>
        )}
        {picking && (
          <ResourcePicker<Skill>
            title="选择技能"
            path={`${agentAdminRoot}/skills?enabled=true`}
            identify={(item) => item.id}
            label={(item) => item.title || item.name}
            description={(item) => item.description}
            disabled={(item) =>
              draft.some((v) => v.skill_id === item.id) ||
              !item.latest_version_id
            }
            onChoose={(item) => {
              setDraft([
                ...draft,
                {
                  skill_id: item.id,
                  skill_version_id: item.latest_version_id!,
                  enabled: true,
                },
              ]);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
        {versionSkill && (
          <ResourcePicker<SkillVersionSummary>
            title="选择固定版本"
            path={`${agentAdminRoot}/skills/${versionSkill}/versions?state=ready`}
            searchable={false}
            identify={(item) => item.id}
            label={(item) => item.version_label}
            description={(item) => item.change_note}
            onChoose={(item) => {
              setDraft(
                draft.map((v) =>
                  v.skill_id === versionSkill
                    ? { ...v, skill_version_id: item.id }
                    : v,
                ),
              );
              setVersionSkill(null);
            }}
            onClose={() => setVersionSkill(null)}
          />
        )}
      </div>
    </Panel>
  );
}

function SkillLabel({ item }: { item: SkillBindingWrite }) {
  const skill = useApiQuery<Skill>(
    [...agentKeys, "skill", item.skill_id],
    `${agentAdminRoot}/skills/${item.skill_id}`,
  );
  const version = useApiQuery<SkillVersionSummary>(
    [...agentKeys, "skill-version", item.skill_version_id],
    `${agentAdminRoot}/skills/${item.skill_id}/versions/${item.skill_version_id}`,
  );
  return (
    <div className="min-w-0 flex-1">
      <Link
        className="font-medium text-primary"
        to={`/admin/skills/${item.skill_id}`}
      >
        {skill.data?.data.title ||
          skill.data?.data.name ||
          `技能 ${item.skill_id}`}
      </Link>
      <p className="mt-1 text-xs text-muted">
        版本 {version.data?.data.version_label ?? item.skill_version_id}
        {skill.data && !skill.data.data.enabled ? " · 已在技能库停用" : ""}
      </p>
      <ErrorNotice error={skill.error || version.error} />
    </div>
  );
}
