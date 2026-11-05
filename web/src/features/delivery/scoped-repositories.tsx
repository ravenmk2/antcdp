import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { deliveryLabel, reasonLabel, resultTone } from "@/domain/labels";
import type { Resource } from "@/types/collaboration";
import type {
  Environment,
  Page,
  ScopedRepository,
  Variant,
} from "@/types/delivery";
import { useSearchParams } from "react-router";

export function ScopedRepositories({
  project,
  variant,
  environment,
}: {
  project: Resource;
  variant: Variant;
  environment?: Environment;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const submission = useSubmission();
  const subject = environment
    ? `/projects/${project.id}/variants/${variant.id}/environments/${environment.id}`
    : `/projects/${project.id}/variants/${variant.id}`;
  const list = useApiQuery<Page<ScopedRepository>>(
    [
      "scoped-repositories",
      project.id,
      variant.id,
      environment?.id,
      page,
      size,
    ],
    `${subject}/repositories?page=${page}&page_size=${size}`,
  );
  const target = environment?.branch_name ?? variant.main_branch;
  const rows = list.data?.data.items ?? [];
  async function check() {
    if (!list.data || !selected.length) return;
    await submission.run(async () => {
      await request(`${subject}/check-branches`, {
        method: "POST",
        etag: environment?.etag ?? variant.etag,
        body: {
          repository_ids: selected,
          scope_token: list.data.data.scope_token,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: [
          "scoped-repositories",
          project.id,
          variant.id,
          environment?.id,
        ],
      });
      setSelected([]);
    });
  }
  return (
    <Panel
      title="仓库与分支"
      action={
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!selected.length || !list.data?.data.can_manage}
            pending={submission.pending}
            onClick={() => void check()}
          >
            <Check />
            校验所选分支
          </Button>
          <Button
            disabled={!variant.can_manage || Boolean(environment)}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("vview", "creations");
                next.set("create", "1");
                return next;
              })
            }
          >
            <Plus />
            创建主干 Git 分支
          </Button>
        </div>
      }
    >
      <Notice className="mb-4">
        当前目标：<code className="mono">{target}</code>
        。读取列表不会访问远端；只有显式校验才查询
        GitLab，旧结果不能证明当前状态。
      </Notice>
      <ErrorNotice error={submission.error} />
      <div className="mb-3 flex items-center gap-3 text-xs text-muted">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="选择本页全部仓库"
            checked={
              rows.length > 0 && rows.every((row) => selected.includes(row.id))
            }
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...new Set([...selected, ...rows.map((row) => row.id)])]
                  : selected.filter((id) => !rows.some((row) => row.id === id)),
              )
            }
          />
          选择本页
        </label>
        <span>已选 {selected.length} 项，单批最多 100 项</span>
      </div>
      <AsyncBoundary
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={!rows.length}
        emptyTitle="当前范围没有仓库"
        emptyDescription="零仓库是合法配置；请调整产品分支范围或联系系统管理员关联仓库。"
      >
        <SimpleTable
          label="仓库与 Git 分支"
          headers={[
            "",
            "仓库",
            "匹配来源",
            "目标 Git 分支",
            "最近校验",
            "提交",
            "详情",
          ]}
        >
          {rows.map((repo) => {
            const check = repo.check;
            const outdated =
              check?.outdated || (check && check.branch_name !== target);
            return (
              <tr key={repo.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${repo.full_path}`}
                    checked={selected.includes(repo.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, repo.id]
                          : selected.filter((id) => id !== repo.id),
                      )
                    }
                  />
                </td>
                <td>
                  <strong className="mono break-all text-xs text-foreground">
                    {repo.full_path}
                  </strong>
                  <small className="mt-1 block text-muted">
                    {repo.connection_name}
                  </small>
                </td>
                <td className="text-xs">{matchSources(repo.match_sources)}</td>
                <td className="mono">{target}</td>
                <td>
                  <StatusBadge
                    tone={
                      outdated
                        ? "warning"
                        : resultTone(check?.status ?? "unchecked")
                    }
                  >
                    {outdated
                      ? "需重新校验"
                      : deliveryLabel(check?.status ?? "unchecked")}
                  </StatusBadge>
                  {check?.reason && (
                    <small className="mt-1 block text-warning">
                      {reasonLabel(check.reason)}
                    </small>
                  )}
                </td>
                <td className="mono break-all text-xs">
                  {check?.commit_id || "—"}
                </td>
                <td>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={`查看 ${repo.full_path} 校验详情`}
                    onClick={() =>
                      setExpanded(expanded === repo.id ? null : repo.id)
                    }
                  >
                    {expanded === repo.id ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                  {expanded === repo.id && (
                    <div className="mt-3 max-w-md rounded-lg bg-surface-subtle p-3 text-xs">
                      <p>检查时间：{check?.finished_at || "尚无"}</p>
                      <p>历史分支：{check?.branch_name || "—"}</p>
                      <p>
                        保护分支：
                        {check?.protected === null ||
                        check?.protected === undefined
                          ? "未知"
                          : check.protected
                            ? "是"
                            : "否"}
                      </p>
                      <p>
                        校验编号：
                        <span className="mono">{check?.check_id || "—"}</span>
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </SimpleTable>
      </AsyncBoundary>
      {list.data && (
        <Pagination
          page={page}
          size={size}
          total={list.data.data.total}
          pending={list.isFetching}
          onChange={(nextPage, nextSize) => {
            setPage(nextPage);
            setSize(nextSize);
          }}
        />
      )}
    </Panel>
  );
}

function matchSources(values: string[]) {
  return (
    values
      .map((value) =>
        value === "all"
          ? "全部项目仓库"
          : value === "inherit"
            ? "继承产品分支"
            : value === "manual"
              ? "手动选择"
              : value.startsWith("rule:")
                ? `匹配规则 ${value.slice(5)}`
                : value,
      )
      .join("、") || "—"
  );
}
