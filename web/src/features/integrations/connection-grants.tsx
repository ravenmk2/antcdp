import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, Notice, StatusBadge } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { SimpleTable } from "@/components/table";
import { ResourcePicker } from "@/features/agents/resources/resource-picker";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Resource } from "@/types/collaboration";
import { IntegrationError } from "./connection-editor";

interface Grant {
  subject_kind: "project" | "team";
  subject_id: string;
  subject_name: string;
  enabled: boolean;
}

export function ConnectionGrants({ path }: { path: string }) {
  const base = `${path}/grants`;
  const query = useApiQuery<{ items: Grant[] }>(
    ["connection-grants", path],
    base,
  );
  const client = useQueryClient();
  const submission = useSubmission();
  const [picking, setPicking] = useState<"project" | "team" | null>(null);
  const saving = useRef(false);
  const busy = submission.pending || query.isFetching;

  async function refresh() {
    const result = await query.refetch();
    if (result.isSuccess) submission.setError(null);
    await client.invalidateQueries({ queryKey: ["service-directory"] });
    await client.invalidateQueries({
      queryKey: ["robot-credential-directory"],
    });
  }

  async function update(
    kind: "project" | "team",
    id: string,
    enabled: boolean,
  ) {
    if (saving.current || busy || submission.uncertain || !query.data?.etag)
      return;
    saving.current = true;
    try {
      await submission.run(async () => {
        await request(base + `/${kind}/${id}`, {
          method: "PUT",
          etag: query.data?.etag,
          body: { enabled },
        });
        await refresh();
      });
    } finally {
      saving.current = false;
    }
  }

  return (
    <Panel
      title="项目与团队授权"
      action={
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || submission.uncertain || !query.data?.etag}
            onClick={() => setPicking("project")}
          >
            授权项目
          </Button>
          <Button
            variant="outline"
            disabled={busy || submission.uncertain || !query.data?.etag}
            onClick={() => setPicking("team")}
          >
            授权团队
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            刷新授权
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Notice>
          授权仅开放连接使用权。凭证单独维护；团队授权不自动覆盖关联项目。撤销后保留已有配置，后续访问将被拒绝。
        </Notice>
        <IntegrationError error={submission.error} />
        {submission.uncertain && (
          <Notice>提交结果待确认，请刷新授权并核对当前状态。</Notice>
        )}
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void refresh()}
          empty={!query.data?.data.items.length}
          emptyTitle="尚未授权项目或团队"
        >
          <SimpleTable
            label="连接授权"
            headers={["类型", "名称", "状态", "操作"]}
            actions
          >
            {query.data?.data.items.map((grant) => (
              <tr key={`${grant.subject_kind}:${grant.subject_id}`}>
                <td>{grant.subject_kind === "project" ? "项目" : "团队"}</td>
                <td>{grant.subject_name || grant.subject_id}</td>
                <td>
                  <StatusBadge tone={grant.enabled ? "success" : "neutral"}>
                    {grant.enabled ? "已授权" : "已撤销"}
                  </StatusBadge>
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy || submission.uncertain || Boolean(query.error)
                    }
                    onClick={() =>
                      void update(
                        grant.subject_kind,
                        grant.subject_id,
                        !grant.enabled,
                      )
                    }
                  >
                    {grant.enabled ? "撤销授权" : "重新授权"}
                  </Button>
                </td>
              </tr>
            ))}
          </SimpleTable>
        </AsyncBoundary>
        {picking && (
          <ResourcePicker<Resource>
            title={picking === "project" ? "选择授权项目" : "选择授权团队"}
            path={`/${picking === "project" ? "projects" : "teams"}?scope=all&status=active`}
            identify={(item) => item.id}
            label={(item) => item.name}
            disabled={(item) =>
              Boolean(
                query.data?.data.items.some(
                  (g) =>
                    g.subject_kind === picking &&
                    g.subject_id === item.id &&
                    g.enabled,
                ),
              )
            }
            onChoose={(item) => {
              const kind = picking;
              setPicking(null);
              void update(kind, item.id, true);
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    </Panel>
  );
}
