import { OperationStatus } from "@/components/platform/operation-status";
import { useState } from "react";
import type { ProjectRepository } from "@/shared/repositories";
import { ExternalLink, GitBranch } from "lucide-react";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { FormDrawer } from "@/components/platform/form-drawer";
import { AsyncState } from "@/components/platform/feedback";
import { CopyButton } from "@/components/platform/copy-button";
import { Button } from "@/components/ui/button";
type Diagnostic = {
  status: string;
  reason?: string;
  finished_at: string;
  outdated: boolean;
};
const reasons: Record<string, string> = {
  REMOTE_AUTHENTICATION_FAILED: "系统首选凭证认证失败",
  REMOTE_ACCESS_DENIED: "当前凭证无权访问",
  REMOTE_REPOSITORY_UNAVAILABLE: "仓库不存在或凭证无权访问",
  REMOTE_TIMEOUT: "服务请求超时",
  REMOTE_UNAVAILABLE: "暂时无法访问服务",
  REMOTE_INVALID_RESPONSE: "服务返回的信息无效",
  RATE_LIMITED: "请求频率受限",
};
export function RepositoryDetail({
  repo,
  base,
  onClose,
}: {
  repo: ProjectRepository;
  base: string;
  onClose: () => void;
}) {
  const date = useDate(),
    query = useQuery<{ latest: Diagnostic | null }>(
      base + "/" + repo.id + "/diagnostics",
    );
  const [scheme, setScheme] = useState(repo.http_clone_url ? "HTTPS" : "SSH");
  const address = scheme === "HTTPS" ? repo.http_clone_url : repo.ssh_clone_url,
    record = query.data?.latest;
  return (
    <FormDrawer
      title={repo.name}
      description={repo.full_path}
      onClose={onClose}
      footer={(close) => (
        <Button variant="outline" onClick={() => close()}>
          关闭
        </Button>
      )}
    >
      <dl className="grid gap-4 rounded-xl bg-muted/60 p-5 text-sm sm:grid-cols-2">
        {[
          [
            "服务连接",
            repo.connection_name + (repo.connection_enabled ? "" : " · 已停用"),
          ],
          ["远端仓库 ID", repo.repo_id],
          ["默认分支", repo.default_branch || "未提供"],
          [
            "远端状态",
            repo.remote_archived === null
              ? "未知"
              : repo.remote_archived
                ? "已归档"
                : "正常",
          ],
          ["快照更新时间", date(repo.last_synced_at)],
        ].map(([label, text]) => (
          <div key={label}>
            <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
            <dd className="break-all">{text}</dd>
          </div>
        ))}
      </dl>
      {repo.web_url && /^https?:\/\//i.test(repo.web_url) && (
        <a
          className="inline-flex items-center gap-2 text-sm underline"
          href={repo.web_url}
          target="_blank"
          rel="noreferrer"
        >
          在代码平台打开
          <ExternalLink className="size-4" />
        </a>
      )}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-medium">
          <GitBranch className="size-4" />
          克隆地址
        </h3>
        <div className="mb-2 flex gap-1">
          {["HTTPS", "SSH"].map((v) => (
            <Button
              size="sm"
              variant={v === scheme ? "secondary" : "ghost"}
              key={v}
              aria-pressed={v === scheme}
              onClick={() => setScheme(v)}
            >
              {v}
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <code className="break-all text-sm">
            {address || "未提供此协议的地址"}
          </code>
          {address && <CopyButton value={address} label="复制克隆地址" />}
        </div>
      </section>
      <section className="space-y-3 border-t pt-5">
        <h3 className="font-medium">同步诊断</h3>
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.refresh}
        >
          <p className="text-sm">
            {record ? (
              <OperationStatus
                value={record.outdated ? "outdated" : record.status}
              >
                {record.outdated && "历史同步记录 · "}
                {record.status === "succeeded"
                  ? "同步成功"
                  : record.status === "failed"
                    ? "同步失败"
                    : record.status}
              </OperationStatus>
            ) : (
              "尚无同步记录"
            )}
          </p>
          {record && (
            <p className="text-sm text-muted-foreground">
              {date(record.finished_at)}{" "}
              {record.reason && (reasons[record.reason] || record.reason)}
            </p>
          )}
        </AsyncState>
      </section>
    </FormDrawer>
  );
}
