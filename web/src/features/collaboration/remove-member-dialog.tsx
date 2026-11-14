import { request } from "@/api/client";
import { ErrorNotice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { useSubmission } from "@/hooks/use-form";
import type { Member, Resource, ResourceKind } from "@/types/collaboration";

export function RemoveMemberDialog({
  kind,
  resource,
  member,
  etag,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource: Resource;
  member: Member;
  etag: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const submission = useSubmission();
  return (
    <ConfirmDialog
      open
      danger
      title={kind === "teams" ? "移除团队成员" : "移除直接成员关系"}
      description={`${member.display_name} · @${member.username}`}
      confirmLabel={kind === "teams" ? "移除成员" : "移除直接关系"}
      pending={submission.pending}
      confirmDisabled={submission.uncertain}
      onClose={onClose}
      onConfirm={() => {
        if (submission.pending || submission.uncertain) return;
        void submission.run(async () => {
          await request(`/${kind}/${resource.id}/members/${member.user_id}`, {
            method: "DELETE",
            etag,
          });
          await onSaved();
          onClose();
        });
      }}
    >
      <ErrorNotice error={submission.error} />
      <p className="text-sm text-muted">
        {kind === "teams"
          ? "移除后，该用户将失去通过本团队获得的项目权限；其他直接成员关系或团队来源不受影响。"
          : "其他团队来源不会受影响。"}
        若移除最后一位管理员，之后需由系统管理员接管。
      </p>
    </ConfirmDialog>
  );
}
