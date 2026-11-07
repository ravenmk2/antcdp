export type ResourceKind = "projects" | "teams";
export interface Resource {
  id: string;
  code: string;
  name: string;
  summary: string;
  description: string;
  icon_key: string | null;
  icon_file_id: string | null;
  created_by_user_id: string;
  version: string;
  membership_version: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  direct_role: "admin" | "member" | "";
  is_member: boolean;
  member_count: number;
  status: "active" | "archived" | "dissolved";
  etag: string;
  membership_etag: string;
  dissolve_etag?: string;
  can_manage: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  mutation_version?: string;
  scope_token?: string;
  can_manage?: boolean;
}
export interface Member {
  avatar_file_id?: string | null;
  user_id: string;
  username: string;
  display_name: string;
  account_status: string;
  direct_role: string;
  effective_role: string;
  sources: { type: string; team_id?: string; team_name?: string }[];
}
export interface MemberPage extends Page<Member> {
  membership_etag: string;
}
export interface UserOption {
  id: string;
  username: string;
  display_name: string;
}
export interface TeamOption {
  id: string;
  code: string;
  name: string;
  summary: string;
}
export interface ShortcutItem {
  id: string;
  code: string;
  name: string;
  icon_key: string | null;
  icon_file_id: string | null;
  status: string;
  sort_order: number;
}
export interface ShortcutGroup {
  items: ShortcutItem[];
  version: string;
  etag: string;
}
export interface Shortcuts {
  projects: ShortcutGroup;
  teams: ShortcutGroup;
}
export type ResourceIconValue =
  | { type: "default" }
  | { type: "builtin"; key: string }
  | { type: "upload"; file_id: string };
