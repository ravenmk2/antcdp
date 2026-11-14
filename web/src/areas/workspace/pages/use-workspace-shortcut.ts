import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { request, type ApiResponse } from "@/api/client";
import { useSession } from "@/app/auth";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type {
  Resource,
  ResourceKind,
  ShortcutGroup,
  Shortcuts,
} from "@/types/collaboration";

export function useWorkspaceShortcut(kind: ResourceKind) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const shortcuts = useApiQuery<Shortcuts>(
    ["shortcuts", session.user.id],
    "/me/sidebar-shortcuts",
  );
  const submission = useSubmission();
  const queryKey = ["shortcuts", session.user.id];

  function selected(id: string) {
    return Boolean(
      shortcuts.data?.data[kind].items.some((item) => item.id === id),
    );
  }

  async function reload() {
    const result = await shortcuts.refetch();
    if (!result.error) submission.setError(null);
  }

  async function toggle(resource: Resource) {
    if (
      !shortcuts.data ||
      submission.pending ||
      submission.uncertain ||
      pendingId
    )
      return false;
    const group = shortcuts.data.data[kind];
    const ids = group.items.map((item) => item.id);
    const next = ids.includes(resource.id)
      ? ids.filter((id) => id !== resource.id)
      : [...ids, resource.id];
    setPendingId(resource.id);
    try {
      const ok = await submission.run(async () => {
        const response = await request<ShortcutGroup>(
          `/me/sidebar-shortcuts/${kind}`,
          {
            method: "PUT",
            etag: group.etag,
            body: { ids: next },
          },
        );
        queryClient.setQueryData<ApiResponse<Shortcuts>>(queryKey, (current) =>
          current
            ? {
                ...current,
                data: { ...current.data, [kind]: response.data },
              }
            : current,
        );
        await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
      });
      if (!ok) await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
      return ok;
    } finally {
      setPendingId(null);
    }
  }

  return {
    shortcuts,
    selected,
    toggle,
    reload,
    pendingId,
    pending: submission.pending,
    error: submission.error,
    uncertain: submission.uncertain,
  };
}
