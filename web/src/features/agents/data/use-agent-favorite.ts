import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";

export function useAgentFavorite() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorited }: { id: string; favorited: boolean }) =>
      request(`/agents/favorites/${id}`, {
        method: favorited ? "DELETE" : "PUT",
      }),
    onSuccess: async () => {
      await Promise.all(
        [
          ["agent-favorites"],
          ["agent-start-catalog"],
          ["agent-start-detail"],
          ["agent-summary"],
        ].map((queryKey) => cache.invalidateQueries({ queryKey })),
      );
    },
  });
}
