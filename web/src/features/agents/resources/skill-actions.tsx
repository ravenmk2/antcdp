import { useId, useRef, useState } from "react";
import { Download, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/button";
import { Field, Input, Textarea } from "@/components/fields";
import { AsyncBoundary, Notice } from "@/components/feedback";
import {
  ConfirmDialog,
  Drawer,
  OverlayCancelButton,
} from "@/components/overlays";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors } from "@/hooks/use-form";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import type { ApiResponse } from "@/api/client";
import type { Skill } from "@/types/agent-resources";
import { useResourceSave } from "./admin-shared";

export type SkillAction = "create" | "publish" | "edit" | "delete";
export function SkillMenu({
  name,
  onAction,
  archive,
}: {
  name: string;
  onAction: (action: SkillAction) => void;
  archive?: string;
}) {
  const next = useRef<SkillAction | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu
      onOpenChangeComplete={(open) => {
        if (open) return;
        const action = next.current;
        next.current = null;
        if (action) {
          trigger.current?.focus();
          onAction(action);
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            aria-label={`${name}更多操作`}
          >
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" finalFocus={trigger}>
        <DropdownMenuItem
          onClick={() => {
            next.current = "publish";
          }}
        >
          <Upload />
          发布新版
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            next.current = "edit";
          }}
        >
          <Pencil />
          编辑信息
        </DropdownMenuItem>
        {archive && (
          <DropdownMenuItem
            render={
              <a href={archive} download>
                <Download />
                下载 ZIP
              </a>
            }
          />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            next.current = "delete";
          }}
        >
          <Trash2 />
          删除技能
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SkillEditDrawer({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [restoreFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const query = useApiQuery<Skill>(
    ["agent-resources", "skills", id],
    `${agentAdminRoot}/skills/${id}`,
  );
  if (query.data)
    return (
      <EditForm
        initial={query.data}
        onClose={onClose}
        onSaved={onSaved}
        restoreFocusTo={restoreFocusTo}
      />
    );
  return (
    <Drawer
      open
      title="编辑技能信息"
      onClose={onClose}
      restoreFocusTo={restoreFocusTo}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {null}
      </AsyncBoundary>
    </Drawer>
  );
}
function EditForm({
  initial,
  onClose,
  onSaved,
  restoreFocusTo,
}: {
  initial: ApiResponse<Skill>;
  restoreFocusTo: HTMLElement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const from = (s: Skill) => ({
    title: s.title,
    description: s.description,
    enabled: s.enabled,
  });
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data));
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline),
    formId = useId(),
    errors = useFormErrors();
  const save = useResourceSave({
    initial,
    path: `${agentAdminRoot}/skills/${initial.data.id}`,
    dirty,
    adopt: (s) => {
      setDraft(from(s));
      setBaseline(from(s));
    },
    complete: () => {
      onSaved();
      onClose();
    },
    showError: (error) => errors.show(error, ["title", "description"]),
  });
  return (
    <Drawer
      open
      title="编辑技能信息"
      description={initial.data.name}
      restoreFocusTo={restoreFocusTo}
      pending={save.pending}
      dirty={dirty || save.blocked}
      onClose={() => {
        save.release();
        onClose();
      }}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            form={formId}
            type="submit"
            pending={save.pending}
            disabled={!dirty || save.blocked}
          >
            保存修改
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={errors.formRef}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          errors.clear();
          void save.save(draft);
        }}
      >
        {save.recovery}
        <fieldset disabled={save.pending || save.blocked} className="space-y-5">
          <Field label="展示名称" error={errors.fields.title}>
            <Input
              name="title"
              required
              maxLength={100}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="描述" error={errors.fields.description}>
            <Textarea
              name="description"
              rows={6}
              maxLength={1024}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </Field>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>启用技能</span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </label>
        </fieldset>
        <p className="text-xs leading-6 text-muted">
          这些信息用于管理和展示，不会修改任何已发布版本的 SKILL.md。
        </p>
      </form>
    </Drawer>
  );
}

export function SkillDeleteDialog({
  id,
  onClose,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const query = useApiQuery<Skill>(
    ["agent-resources", "skills", id],
    `${agentAdminRoot}/skills/${id}`,
  );
  const action = useAgentCommand<null>(`skill:${id}:delete`);
  useCommandResult(action.state, () => {
    action.command.reset();
    onDeleted();
  });
  return (
    <ConfirmDialog
      open
      title={`删除技能${query.data ? `“${query.data.data.title}”` : ""}？`}
      description="删除不可撤销。已有版本或活动引用的技能不能直接删除，可改为停用并保留历史。"
      danger
      confirmLabel="确认删除"
      confirmDisabled={!query.data}
      pending={action.pending || action.uncertain}
      onClose={onClose}
      onConfirm={() => {
        if (!query.data) return;
        void action.command.run({
          domain: agentAdminRoot,
          path: `/skills/${id}`,
          scope: `skill:${id}`,
          command: "skill.delete",
          options: { method: "DELETE", etag: query.data.etag },
        });
      }}
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {action.recovery}
      </AsyncBoundary>
      {!query.data && <Notice>正在读取要删除的技能信息。</Notice>}
    </ConfirmDialog>
  );
}
