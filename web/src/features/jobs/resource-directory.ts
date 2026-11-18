import { useQueries } from "@tanstack/react-query";
import { request } from "@/api/client";
import { useApiQuery } from "@/hooks/use-api";
import type { CredentialSet, ServiceConnection } from "@/types/integrations";
import type { ResourceGrant } from "./types";

export function useJobResourceDirectory(
  projectId: string,
  grants: ResourceGrant[],
  connectionId = "",
  enabled = true,
) {
  const directory = useApiQuery<{ items: ServiceConnection[] }>(
    ["service-directory"],
    "/service-connections",
    { enabled },
  );
  const connections = directory.data?.data.items ?? [];
  const referencedIds = new Set([
    connectionId,
    ...grants.map((g) => g.connection_id),
  ]);
  const referenced = connections.filter((connection) =>
    referencedIds.has(connection.id),
  );
  const results = useQueries({
    queries: referenced.map((connection) => ({
      queryKey: [
        "job-credentials",
        projectId,
        connection.id,
        connection.service_type,
      ],
      queryFn: ({ signal }) =>
        request<CredentialSet>(
          `/projects/${projectId}/service-connections/${connection.service_type}/${connection.id}/credentials`,
          { signal },
        ),
      enabled,
      staleTime: 15_000,
      retry: false,
    })),
  });
  const credentialsByConnection = new Map(
    referenced.map((connection, index) => [
      connection.id,
      results[index]?.data?.data.items ?? [],
    ]),
  );

  return {
    directory,
    connections,
    selectedCredentials: credentialsByConnection.get(connectionId) ?? [],
    selectedQuery:
      results[
        referenced.findIndex((connection) => connection.id === connectionId)
      ],
    connectionName: (id: string) =>
      connections.find((connection) => connection.id === id)?.name ??
      `连接 #${id}`,
    credentialName: (connection: string, id: string) =>
      credentialsByConnection.get(connection)?.find((item) => item.id === id)
        ?.name ?? `凭证 #${id}`,
  };
}
