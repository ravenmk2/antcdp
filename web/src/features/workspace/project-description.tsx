import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { MarkdownEditor, MarkdownView } from "@/components/markdown";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource } from "@/types/collaboration";

export function ProjectDescription({ project }: { project: Resource }) {
  const [edit, setEdit] = useState(false);
  const [source, setSource] = useState(project.description);
  const [dirty, setDirty] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  useUnsaved(edit && dirty, submission.pending);
  async function save() {
    if (new TextEncoder().encode(source).length > 100 * 1024) {
      errors.validate({ description: "项目介绍不能超过 100 KiB UTF-8" });
      return;
    }
    await submission.run(
      async () => {
        await request(`/projects/${project.id}`, {
          method: "PATCH",
          etag: project.etag,
          body: { description: source },
        });
        await queryClient.invalidateQueries({
          queryKey: ["project", project.id],
        });
        setDirty(false);
        setEdit(false);
      },
      (error) => errors.show(error, ["description"]),
    );
  }
  if (!edit)
    return (
      <Panel
        title="项目介绍"
        action={
          project.can_manage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSource(project.description);
                setDirty(false);
                setEdit(true);
              }}
            >
              <Pencil />
              编辑介绍
            </Button>
          )
        }
      >
        <MarkdownView source={project.description} />
      </Panel>
    );
  return (
    <Panel
      title="编辑项目介绍"
      action={
        <span className="text-xs text-muted">
          {dirty ? "有未保存修改" : "内容未变化"}
        </span>
      }
    >
      <ErrorNotice error={errors.error} />
      <ErrorNotice error={submission.error} />
      {submission.uncertain && (
        <Notice tone="warning" className="mb-4">
          保存结果未知。请先只读刷新项目资料，核对当前介绍后再操作；不要自动重发。
        </Notice>
      )}
      <MarkdownEditor
        initial={project.description}
        onChange={setSource}
        onDirty={setDirty}
      />
      <div className="form-actions">
        <Button
          variant="outline"
          disabled={submission.pending}
          onClick={() => {
            if (!dirty || window.confirm("放弃未保存的介绍修改？")) {
              setSource(project.description);
              setDirty(false);
              setEdit(false);
            }
          }}
        >
          取消
        </Button>
        <Button
          disabled={!dirty || submission.uncertain}
          pending={submission.pending}
          onClick={() => void save()}
        >
          保存介绍
        </Button>
      </div>
    </Panel>
  );
}
