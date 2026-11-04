import { useRef, useState } from "react";
import type { Kind, Resource, Member, Option } from "@/shared/collaboration";
import { request } from "@/lib/api";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { useIdentity } from "@/app/identity";
import { FormDialog } from "@/components/platform/form-dialog";
import { Field } from "@/components/platform/field";
import { NativeSelect } from "@/components/platform/native-select";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionPicker } from "./OptionPicker";
export type Command = {
  action:
    | "add-member"
    | "add-team"
    | "role"
    | "remove-member"
    | "remove-team"
    | "leave"
    | "archive"
    | "restore"
    | "dissolve";
  member?: Member;
  team?: Resource;
  tag?: string;
};
export function ResourceCommand({
  kind,
  resource: current,
  command,
  consoleMode,
  onClose,
  onSaved,
}: {
  kind: Kind;
  resource: Resource;
  command: Command;
  consoleMode: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [resource] = useState(current);
  const { session } = useIdentity(),
    action = command.action,
    label = kind === "projects" ? "项目" : "团队";
  const [selected, setSelected] = useState<Option[]>([]),
    [role, setRole] = useState(command.member?.direct_role || "member"),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    locked = useRef(false),
    errors = useFormErrors();
  const titles = {
    "add-member": "添加成员",
    "add-team": "添加团队",
    role: "调整成员角色",
    "remove-member": "移除直接身份",
    "remove-team": "移除团队授权",
    leave: `退出${label}`,
    archive: "归档项目",
    restore: "恢复项目",
    dissolve: "解散团队",
  };
  const lifecycle = ["archive", "restore", "dissolve"].includes(action);
  const allowed =
    action === "leave"
      ? !!current.direct_role
      : lifecycle
        ? consoleMode &&
          session.user.role === "admin" &&
          current.status === (action === "restore" ? "archived" : "active")
        : current.can_manage && current.status === "active";
  const destructive = [
    "remove-member",
    "remove-team",
    "leave",
    "archive",
    "dissolve",
  ].includes(action);
  const dirty =
    selected.length > 0 ||
    !!confirmation ||
    role !== (command.member?.direct_role || "member");
  async function save() {
    if (locked.current || blocked || !allowed) return;
    errors.clear();
    const fields: Record<string, string> = {};
    if (action.startsWith("add-") && !selected.length)
      fields.selection = "请选择一个对象。";
    if (
      action === "dissolve" &&
      confirmation.trim().toLowerCase() !== resource.code.toLowerCase()
    )
      fields.confirmation = "团队编码不匹配。";
    if (!errors.validate(fields)) return;
    const base = `/${kind}/${resource.id}`;
    const tag =
      action === "leave"
        ? undefined
        : action === "dissolve"
          ? resource.dissolve_etag
          : lifecycle
            ? resource.etag
            : command.tag || resource.membership_etag;
    if (action !== "leave" && !tag) {
      errors.setError("版本信息缺失，请重新打开。");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      switch (action) {
        case "add-member":
          await request(`${base}/members`, {
            method: "POST",
            etag: tag,
            body: { user_id: selected[0]!.id, role },
          });
          break;
        case "add-team":
          await request(`${base}/teams`, {
            method: "POST",
            etag: tag,
            body: { team_id: selected[0]!.id },
          });
          break;
        case "role":
          await request(`${base}/members/${command.member!.user_id}`, {
            method: "PATCH",
            etag: tag,
            body: { role },
          });
          break;
        case "remove-member":
          await request(`${base}/members/${command.member!.user_id}`, {
            method: "DELETE",
            etag: tag,
          });
          break;
        case "remove-team":
          await request(`${base}/teams/${command.team!.id}`, {
            method: "DELETE",
            etag: tag,
          });
          break;
        default:
          await request(`${base}/${action}`, {
            method: "POST",
            etag: tag,
            body: {},
          });
      }
      onSaved();
    } catch (e) {
      errors.show(e, ["selection", "role", "confirmation"], {
        user_id: "selection",
        team_id: "selection",
      });
      setBlocked(writeRequiresReview(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      open
      title={titles[action]}
      description={resource.name}
      dirty={dirty}
      pending={busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            type="submit"
            form="resource-command"
            variant={destructive ? "destructive" : "default"}
            disabled={busy || blocked || !allowed}
          >
            {busy ? "正在提交…" : "确认"}
          </Button>
        </>
      )}
    >
      <form
        id="resource-command"
        ref={errors.formRef}
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {blocked && (
          <p role="alert" className="text-sm">
            {writeReviewMessage}
          </p>
        )}
        {action.startsWith("add-") && (
          <Field
            label={action === "add-team" ? "团队" : "用户"}
            required
            error={errors.fields.selection}
          >
            {(props) => (
              <OptionPicker
                controlProps={props}
                path={`/${kind}/${resource.id}/${action === "add-team" ? "team-options" : "member-options"}`}
                selected={selected}
                onChange={setSelected}
                disabled={busy}
              />
            )}
          </Field>
        )}
        {(action === "add-member" || action === "role") && (
          <Field label="直接角色" error={errors.fields.role}>
            {(props) => (
              <NativeSelect
                {...props}
                value={role}
                disabled={busy}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </NativeSelect>
            )}
          </Field>
        )}
        {action === "role" && (
          <p className="text-sm">
            调整 {command.member?.display_name}{" "}
            的直接角色。团队来源权限独立保留。
          </p>
        )}
        {action === "remove-member" && (
          <p className="text-sm">
            移除 {command.member?.display_name}{" "}
            的直接成员身份，团队带来的访问权限仍会保留。
          </p>
        )}
        {action === "remove-team" && (
          <p className="text-sm">
            撤销团队“{command.team?.name}”的项目授权，不影响其他权限来源。
          </p>
        )}
        {action === "leave" && (
          <p className="text-sm">
            移除你在此{label}中的直接身份，其他团队带来的项目访问权限仍会保留。
          </p>
        )}
        {action === "archive" && (
          <p className="text-sm">归档后项目只读，系统管理员可以恢复。</p>
        )}
        {action === "restore" && (
          <p className="text-sm">
            恢复后，项目管理员可以继续编辑资料和管理成员。
          </p>
        )}
        {action === "dissolve" && (
          <>
            <p className="text-sm">
              解散会移除全部成员和项目授权，且不能恢复。
            </p>
            <Field
              label={`输入团队编码 ${resource.code} 确认`}
              required
              error={errors.fields.confirmation}
            >
              {(props) => (
                <Input
                  {...props}
                  value={confirmation}
                  disabled={busy}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
      </form>
    </FormDialog>
  );
}
