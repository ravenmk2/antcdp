export interface RemoteRepository {
  repo_id: string;
  name: string;
  namespace_path: string;
  full_path: string;
  default_branch: string | null;
  remote_archived: boolean | null;
  web_url: string | null;
  http_clone_url: string | null;
  ssh_clone_url: string | null;
  already_linked?: boolean;
}
export interface ProjectRepository extends RemoteRepository {
  id: string;
  connection_id: string;
  connection_name: string;
  connection_enabled: boolean;
  last_synced_at: string;
  etag: string;
}
export interface RepositoryPage {
  items: ProjectRepository[];
  total: number;
  mutation_version: string;
}
export interface RepositoryConnection {
  id: string;
  name: string;
  enabled: boolean;
}
export interface RepositoryGroup {
  id: string;
  name: string;
  full_path: string;
  parent_id: string | null;
}
export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}
