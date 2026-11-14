import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { agentQuery } from "@/features/agents/data/agent-api";
import { useListParams } from "./admin-shared";

export function useManagedList<T>(path: string) {
  const { params, page, size, change } = useListParams();
  const q = params.get("q") ?? "";
  const enabled = params.get("enabled") ?? "all";
  const search = useDebouncedSearch(q, (value) =>
    change({ q: value, page: "1" }),
  );
  const query = agentQuery({ page, page_size: size, q, enabled });
  const list = useApiQuery<T[]>(
    ["agent-resources", path, query],
    `${path}?${query}`,
  );
  return { params, page, size, change, enabled, search, list };
}
