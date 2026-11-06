import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { Field, Input, Select, StandaloneInput } from "@/components/fields";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Page } from "@/types/collaboration";
import type {
  Scope,
  ScopeRule,
  ScopedRepository,
  Variant,
} from "@/types/delivery";
import type { ProjectRepository as Repo } from "@/types/integrations";

export const emptyScope = (environment = false): Scope => ({
  mode: environment ? "inherit" : "all",
  repository_ids: [],
  rules: [],
});

export function ScopeEditor({
  projectId,
  value,
  onChange,
  environment = false,
  variant,
  disabled,
}: {
  projectId: string;
  value: Scope;
  onChange: (value: Scope) => void;
  environment?: boolean;
  variant?: Variant;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Page<ScopedRepository> | null>(null);
  const submission = useSubmission();
  const repositories = useApiQuery<Page<Repo>>(
    ["scope-repositories", projectId, search, page, size],
    `/projects/${projectId}/repositories?${new URLSearchParams({ page: String(page), page_size: String(size), q: search })}`,
  );
  const connections = useApiQuery<Page<Repo>>(
    ["scope-connections", projectId],
    `/projects/${projectId}/repositories?page=1&page_size=100`,
  );
  const connectionOptions = [
    ...new Map(
      (connections.data?.data.items ?? []).map((repo) => [
        repo.connection_id,
        repo.connection_name,
      ]),
    ).entries(),
  ];
  function update(next: Partial<Scope>) {
    onChange({ ...value, ...next });
    setPreview(null);
  }
  function updateRule(index: number, next: Partial<ScopeRule>) {
    onChange({
      ...value,
      rules: value.rules.map((rule, position) =>
        position === index ? { ...rule, ...next } : rule,
      ),
    });
    setPreview(null);
  }
  async function runPreview() {
    await submission.run(async () => {
      const response = await request<Page<ScopedRepository>>(
        `/projects/${projectId}/repository-scope-preview?page=1&page_size=100`,
        {
          method: "POST",
          body: {
            variant_id: variant?.id,
            repository_scope: value,
            subject_kind: environment ? "environment" : "variant",
          },
        },
      );
      setPreview(response.data);
    });
  }
  return (
    <div className="grid gap-4">
      <Field
        label="仓库范围"
        hint={
          environment
            ? "默认继承产品分支；自定义结果始终与父范围取交集"
            : "默认包含项目全部仓库；手动与规则取并集"
        }
      >
        <Select
          disabled={disabled}
          value={value.mode}
          onChange={(event) =>
            update({
              mode: event.target.value as Scope["mode"],
              ...(event.target.value !== "custom"
                ? { repository_ids: [], rules: [] }
                : {}),
            })
          }
        >
          {environment && <option value="inherit">继承产品分支</option>}
          {!environment && <option value="all">全部项目仓库</option>}
          <option value="custom">自定义范围</option>
        </Select>
      </Field>
      {value.mode === "custom" && (
        <>
          <section className="rounded-lg border">
            <header className="flex items-center justify-between border-b px-3 py-2">
              <strong className="text-xs">
                手动选择 · 已选 {value.repository_ids.length}
              </strong>
              <form
                className="flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(query.trim());
                  setPage(1);
                }}
              >
                <StandaloneInput
                  aria-label="搜索范围内仓库"
                  className="min-h-8 text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索路径"
                />
                <Button type="submit" size="sm" variant="ghost">
                  搜索
                </Button>
              </form>
            </header>
            <div className="max-h-56 overflow-y-auto">
              {repositories.data?.data.items.map((repo) => (
                <RepositoryChoice
                  key={repo.id}
                  repo={repo}
                  selected={value.repository_ids.includes(repo.id)}
                  disabled={disabled}
                  onChange={(checked) =>
                    update({
                      repository_ids: checked
                        ? [...value.repository_ids, repo.id]
                        : value.repository_ids.filter((id) => id !== repo.id),
                    })
                  }
                />
              ))}
            </div>
            {repositories.data && (
              <Pagination
                page={page}
                size={size}
                total={repositories.data.data.total}
                onChange={(nextPage, nextSize) => {
                  setPage(nextPage);
                  setSize(nextSize);
                }}
              />
            )}
          </section>
          <section>
            <header className="mb-2 flex items-center justify-between">
              <strong className="text-xs">
                按规则匹配（高级） · {value.rules.length}/20
              </strong>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || value.rules.length >= 20}
                onClick={() =>
                  update({
                    rules: [
                      ...value.rules,
                      { connection_id: null, mode: "glob", pattern: "" },
                    ],
                  })
                }
              >
                <Plus />
                添加规则
              </Button>
            </header>
            <div className="grid gap-2">
              {value.rules.map((rule, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[150px_110px_minmax(0,1fr)_36px]"
                >
                  <Select
                    aria-label={`规则 ${index + 1} 连接`}
                    disabled={disabled}
                    value={rule.connection_id ?? ""}
                    onChange={(event) =>
                      updateRule(index, {
                        connection_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">全部连接</option>
                    {connectionOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={`规则 ${index + 1} 模式`}
                    disabled={disabled}
                    value={rule.mode}
                    onChange={(event) =>
                      updateRule(index, {
                        mode: event.target.value as ScopeRule["mode"],
                      })
                    }
                  >
                    <option value="glob">glob</option>
                    <option value="regex">regex</option>
                  </Select>
                  <Input
                    aria-label={`规则 ${index + 1} 路径表达式`}
                    className="mono"
                    disabled={disabled}
                    value={rule.pattern}
                    onChange={(event) =>
                      updateRule(index, { pattern: event.target.value })
                    }
                    placeholder="group/custom/**"
                  />
                  <IconButton
                    size="iconSm"
                    label={`删除规则 ${index + 1}`}
                    disabled={disabled}
                    onClick={() =>
                      update({
                        rules: value.rules.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
            </div>
          </section>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              pending={submission.pending}
              onClick={() => void runPreview()}
            >
              预览动态范围
            </Button>
            <ErrorNotice error={submission.error} />
          </div>
          {preview && (
            <Notice tone="info">
              当前草稿匹配 {preview.total} 个仓库。
              {preview.items.slice(0, 8).map((repo) => (
                <div key={repo.id} className="mono mt-1 break-all text-xs">
                  {repo.full_path} · {repo.match_sources.join("、")}
                </div>
              ))}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

function RepositoryChoice({
  repo,
  selected,
  disabled,
  onChange,
}: {
  repo: Repo;
  selected: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 border-b px-3 py-2 last:border-0">
      <input
        type="checkbox"
        disabled={disabled}
        checked={selected}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="min-w-0">
        <strong className="block text-xs">{repo.name}</strong>
        <small className="mono block break-all text-muted">
          {repo.full_path}
        </small>
      </div>
      {selected && <StatusBadge tone="info">已选择</StatusBadge>}
    </label>
  );
}
