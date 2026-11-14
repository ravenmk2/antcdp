import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input } from "@/components/fields";
import { ConfirmDialog } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type { Resource } from "@/types/collaboration";

export function TeamDissolveDialog({
  team,
  onClose,
}: {
  team: Resource;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const client = useQueryClient();
  const submission = useSubmission();
  const query = useApiQuery<Resource>(["team", team.id], `/teams/${team.id}`);
  const current = query.data?.data;
  const conflict =
    submission.error instanceof ApiError &&
    ["VERSION_CONFLICT", "PRECONDITION_REQUIRED"].includes(
      submission.error.code,
    );
  const blocked =
    query.isFetching ||
    Boolean(query.error) ||
    !current?.dissolve_etag ||
    current.status !== "active" ||
    submission.uncertain ||
    conflict;
  return (
    <ConfirmDialog
      open
      title="解散团队"
      description={current?.name ?? team.name}
      danger
      confirmLabel="确认解散"
      pending={submission.pending}
      confirmDisabled={
        blocked ||
        confirmation.toLowerCase() !==
          (current?.code ?? team.code).toLowerCase()
      }
      onClose={onClose}
      onConfirm={() => {
        if (
          blocked ||
          submission.pending ||
          !current ||
          confirmation.toLowerCase() !== current.code.toLowerCase()
        )
          return;
        void submission.run(async () => {
          await request(`/teams/${team.id}/dissolve`, {
            method: "POST",
            etag: current.dissolve_etag,
            body: {},
          });
          await client.invalidateQueries();
          onClose();
        });
      }}
    >
      <ErrorNotice error={submission.error || query.error} />
      <p className="text-sm leading-6 text-muted">
        解散不可恢复，将清除团队成员关系、项目授权和固定入口。名称与编码仍保留。
      </p>
      {current?.status === "dissolved" && (
        <Notice>该团队已解散，无需再次操作。</Notice>
      )}
      {submission.uncertain && (
        <Notice>
          操作结果尚未确认，请重新加载团队状态核实；不会自动重复解散。
        </Notice>
      )}
      {(conflict ||
        submission.uncertain ||
        query.error ||
        (!query.isPending && !current?.dissolve_etag)) && (
        <Button
          variant="outline"
          disabled={query.isFetching || submission.pending}
          onClick={async () => {
            const result = await query.refetch();
            if (!result.error && !submission.uncertain)
              submission.setError(null);
          }}
        >
          重新加载团队状态
        </Button>
      )}
      <Field label={`输入团队编码 ${current?.code ?? team.code} 确认`} required>
        <Input
          name="confirmation"
          autoComplete="off"
          value={confirmation}
          disabled={submission.pending}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
