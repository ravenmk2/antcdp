import { request } from "@/api/client";

export function authorizeProjectTeam(
  projectId: string,
  teamId: string,
  etag: string,
) {
  return request(`/projects/${projectId}/teams`, {
    method: "POST",
    etag,
    body: { team_id: teamId },
  });
}

export function revokeProjectTeam(
  projectId: string,
  teamId: string,
  etag: string,
) {
  return request(`/projects/${projectId}/teams/${teamId}`, {
    method: "DELETE",
    etag,
  });
}
