import { FileText } from "lucide-react";
import { useAuth } from "@/app/auth";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/feedback";
import { MarkdownView } from "@/components/markdown";
import { formatDate } from "@/lib/utils";
import type { Resource, ResourceKind } from "@/types/collaboration";

export function ResourceMetadata({
  resource,
  kind,
}: {
  resource: Resource;
  kind: ResourceKind;
}) {
  const { settings } = useAuth();
  return (
    <>
      <span className="resource-code">
        <span className="mono">{resource.code}</span>
        <CopyButton
          value={resource.code}
          label={`复制${kind === "projects" ? "项目" : "团队"}编码`}
        />
      </span>
      <span>创建于 {formatDate(resource.created_at, settings.timezone)}</span>
      <span>最近更新 {formatDate(resource.updated_at, settings.timezone)}</span>
    </>
  );
}

export function ResourceDocument({
  source,
  kind,
}: {
  source: string;
  kind: ResourceKind;
}) {
  const subject = kind === "projects" ? "项目" : "团队";
  return (
    <div className="resource-document">
      {source.trim() ? (
        <MarkdownView source={source} />
      ) : (
        <EmptyState
          compact
          icon={FileText}
          title={`尚未填写${subject}介绍`}
          description={`可在这里记录${subject}目标、协作约定与必要的背景信息。`}
        />
      )}
    </div>
  );
}
