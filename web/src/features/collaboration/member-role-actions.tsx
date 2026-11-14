import { useState } from "react";
import { Check, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { request } from "@/api/client";
import { ErrorNotice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import {
  RowAction,
  RowActions,
  RowActionSeparator,
} from "@/components/row-actions";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubmission } from "@/hooks/use-form";
import type { Member, Resource, ResourceKind } from "@/types/collaboration";

export function MemberRoleActions({
  kind,
  resource,
  member,
  etag,
  onSaved,
  onRemove,
}: {
  kind: ResourceKind;
  resource: Resource;
  member: Member;
  etag: string;
  onSaved: () => Promise<void>;
  onRemove: () => void;
}) {
  const [promote, setPromote] = useState(false);
  const submission = useSubmission();
  const team = kind === "teams";
  const roles = [
    {
      value: "member" as const,
      label: team ? "团队成员" : "项目成员",
      icon: <UserRound />,
    },
    {
      value: "admin" as const,
      label: team ? "团队管理员" : "项目管理员",
      icon: <ShieldCheck />,
    },
  ];

  async function changeRole(role: "member" | "admin") {
    if (
      role === member.direct_role ||
      submission.pending ||
      submission.uncertain
    )
      return;
    const ok = await submission.run(async () => {
      await request(`/${kind}/${resource.id}/members/${member.user_id}`, {
        method: "PATCH",
        etag,
        body: { role },
      });
      await onSaved();
    });
    if (ok) setPromote(false);
  }

  function selectRole(role: "member" | "admin") {
    if (
      role === member.direct_role ||
      submission.pending ||
      submission.uncertain
    )
      return;
    if (role === "admin") {
      submission.setError(null);
      setPromote(true);
      return;
    }
    void changeRole(role);
  }

  return (
    <>
      <div className="grid max-w-80 justify-items-end gap-2 text-left whitespace-normal">
        <RowActions
          label={member.display_name}
          disabled={submission.pending || submission.uncertain}
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ShieldCheck />
              更改角色
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40">
              {roles.map((role) => (
                <DropdownMenuItem
                  key={role.value}
                  disabled={member.direct_role === role.value}
                  onClick={() => selectRole(role.value)}
                >
                  {member.direct_role === role.value ? <Check /> : role.icon}
                  {role.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <RowActionSeparator />
          <RowAction
            icon={<Trash2 />}
            variant="destructive"
            onSelect={onRemove}
          >
            {team ? "移除成员" : "移除直接关系"}
          </RowAction>
        </RowActions>
        {!promote && <ErrorNotice error={submission.error} />}
      </div>
      <ConfirmDialog
        open={promote}
        title={team ? "提升为团队管理员" : "提升为项目管理员"}
        description={`${member.display_name} · @${member.username}`}
        confirmLabel="确认提升"
        pending={submission.pending}
        confirmDisabled={submission.uncertain}
        onClose={() => setPromote(false)}
        onConfirm={() => void changeRole("admin")}
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm leading-6 text-muted">
          {team ? "团队" : "项目"}：{resource.name}。确认后，该成员将获得此
          {team ? "团队" : "项目"}的管理员权限，可管理
          {team ? "团队成员和资料" : "成员和项目配置"}。
        </p>
      </ConfirmDialog>
    </>
  );
}
