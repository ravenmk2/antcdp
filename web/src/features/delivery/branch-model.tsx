import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, Save } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { reasonLabel } from "@/domain/labels";
import type { BranchModel, BranchRule, Page } from "@/types/delivery";
import type { Resource } from "@/types/collaboration";

interface Classification {
  name: string;
  git_valid: boolean;
  matched_types: string[];
  binding_validity: string;
  reason: string;
}
interface Impact {
  subject_kind: string;
  subject_id: string;
  name: string;
  branch_name: string;
  reason: string;
}
interface Preview {
  samples: Classification[];
  impacts: Page<Impact>;
  impact_token: string;
}

export function BranchModelPanel({ project }: { project: Resource }) {
  const query = useApiQuery<BranchModel>(
    ["branch-model", project.id],
    `/projects/${project.id}/branch-model`,
  );
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <Editor
          key={query.data.etag}
          project={project}
          initial={query.data.data}
          etag={query.data.etag}
          onSaved={() => void query.refetch()}
        />
      )}
    </AsyncBoundary>
  );
}

function Editor({
  project,
  initial,
  etag,
  onSaved,
}: {
  project: Resource;
  initial: BranchModel;
  etag: string;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<BranchRule[]>(
    initial.rules.map((rule) => ({
      ...rule,
      rule: rule.rule ? { ...rule.rule } : null,
    })),
  );
  const [samples, setSamples] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const dirty = JSON.stringify(rules) !== JSON.stringify(initial.rules);
  useUnsaved(dirty, submission.pending);
  function update(type: string, next: Partial<BranchRule>) {
    setRules((current) =>
      current.map((rule) =>
        rule.branch_type === type ? { ...rule, ...next } : rule,
      ),
    );
    setPreview(null);
    setConfirmed(false);
  }
  async function runPreview() {
    const ok = await submission.run(
      async () => {
        const response = await request<Preview>(
          `/projects/${project.id}/branch-model/preview`,
          {
            method: "POST",
            etag,
            body: {
              rules,
              sample_names: samples
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean)
                .slice(0, 50),
            },
          },
        );
        setPreview(response.data);
        setConfirmed(false);
      },
      (error) => errors.show(error, ["rules", "sample_names"]),
    );
    if (!ok) return;
  }
  async function save() {
    if (!dirty) return;
    if (preview && preview.impacts.items.length > 0 && !confirmed) {
      errors.setError("规则变更会影响已有绑定，请先核对影响清单并确认。");
      return;
    }
    const ok = await submission.run(
      async () => {
        await request(`/projects/${project.id}/branch-model`, {
          method: "PUT",
          etag,
          body: {
            rules,
            ...(preview ? { impact_token: preview.impact_token } : {}),
          },
        });
        await queryClient.invalidateQueries({
          queryKey: ["branch-model", project.id],
        });
        onSaved();
      },
      (error) => errors.show(error, ["rules"]),
    );
    if (!ok) return;
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel
        title="七类 Git 分支规则"
        action={
          <span className="text-xs text-muted">
            {initial.can_manage ? "整组替换保存" : "只读"}
          </span>
        }
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <div className="grid gap-4">
          {initial.types.map((type) => {
            const rule = rules.find(
              (item) => item.branch_type === type.branch_type,
            );
            if (!rule) return null;
            return (
              <section key={type.branch_type} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>
                      {type.label}
                      <span className="mono ml-2 text-xs text-muted">
                        {type.branch_type}
                      </span>
                    </strong>
                    <p className="mt-1 text-xs text-muted">
                      {type.description} ·{" "}
                      {type.allow_environment ? "允许绑定环境" : "不可绑定环境"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      disabled={!initial.can_manage}
                      checked={rule.enabled}
                      onChange={(event) =>
                        update(type.branch_type, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    启用
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <Field label="匹配方式">
                    <Select
                      disabled={!initial.can_manage}
                      value={rule.rule?.mode ?? "exact"}
                      onChange={(event) =>
                        update(type.branch_type, {
                          rule: {
                            mode: event.target.value as
                              "exact" | "glob" | "regex",
                            pattern: rule.rule?.pattern ?? "",
                          },
                        })
                      }
                    >
                      <option value="exact">精确匹配</option>
                      <option value="glob">通配符</option>
                      <option value="regex">正则（高级）</option>
                    </Select>
                  </Field>
                  <Field
                    label="命名规则"
                    error={errors.fields[`rules.${type.branch_type}`]}
                  >
                    <Input
                      disabled={!initial.can_manage}
                      className="mono"
                      value={rule.rule?.pattern ?? ""}
                      placeholder={
                        rule.enabled ? "请输入规则" : "可保留规则供以后启用"
                      }
                      onChange={(event) =>
                        update(type.branch_type, {
                          rule: {
                            mode: rule.rule?.mode ?? "exact",
                            pattern: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              </section>
            );
          })}
        </div>
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={!initial.can_manage}
            pending={submission.pending}
            onClick={() => void runPreview()}
          >
            <Eye />
            测试与影响预览
          </Button>
          <Button
            disabled={!initial.can_manage || !dirty}
            pending={submission.pending}
            onClick={() => void save()}
          >
            <Save />
            保存整组规则
          </Button>
        </div>
      </Panel>
      <div className="grid gap-5">
        <Panel title="测试分支名称">
          <Field
            label="每行一个名称"
            hint="最多 50 个；正则结果以服务端 Go 规则为准"
          >
            <Textarea
              value={samples}
              onChange={(event) => setSamples(event.target.value)}
              placeholder={"main\nfeature/example"}
            />
          </Field>
        </Panel>
        {preview && (
          <Panel title="预览结果">
            <div className="grid gap-3">
              {preview.samples.map((sample) => (
                <div key={sample.name} className="rounded-lg border p-3">
                  <strong className="mono break-all text-xs">
                    {sample.name}
                  </strong>
                  <div className="mt-2">
                    <StatusBadge
                      tone={
                        sample.binding_validity === "valid"
                          ? "success"
                          : "warning"
                      }
                    >
                      {sample.binding_validity === "valid"
                        ? `有效 · ${sample.matched_types.join("、")}`
                        : reasonLabel(sample.reason)}
                    </StatusBadge>
                  </div>
                </div>
              ))}
              {!preview.samples.length && (
                <p className="text-sm text-muted">未提供测试名称。</p>
              )}
            </div>
            <div className="mt-5 border-t pt-4">
              <h3 className="mb-2 text-sm font-medium">
                已有绑定影响 · {preview.impacts.total}
              </h3>
              {preview.impacts.items.map((impact) => (
                <div
                  key={`${impact.subject_kind}-${impact.subject_id}`}
                  className="mb-2 rounded-lg bg-warning-soft p-3 text-xs"
                >
                  <strong>{impact.name}</strong>
                  <p className="mono mt-1 break-all">{impact.branch_name}</p>
                  <p className="mt-1 text-warning">
                    {reasonLabel(impact.reason)}
                  </p>
                </div>
              ))}
              {preview.impacts.items.length > 0 && (
                <label className="mt-3 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  我已核对影响；保存不会自动改名或修复旧绑定。
                </label>
              )}
            </div>
          </Panel>
        )}
        <Notice>
          exact/glob 区分大小写；regex 使用 Go
          语法并匹配完整名称。远端存在性不属于配置保存条件。
        </Notice>
      </div>
    </div>
  );
}
