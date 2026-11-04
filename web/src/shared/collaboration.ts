export type Kind = "projects" | "teams";
export interface Resource {
  id: string;
  code: string;
  name: string;
  summary: string;
  description: string;
  icon_key: string | null;
  icon_file_id: string | null;
  status: string;
  direct_role: string;
  is_member: boolean;
  can_manage: boolean;
  member_count: number;
  etag: string;
  membership_etag: string;
  dissolve_etag: string;
}
export interface Page {
  items: Resource[];
  total: number;
  page: number;
  page_size: number;
}
export interface Member {
  user_id: string;
  username: string;
  display_name: string;
  account_status: string;
  direct_role: string;
  effective_role: string;
  sources: { type: string; team_id?: string; team_name?: string }[];
}
export interface Option {
  id: string;
  name?: string;
  code?: string;
  display_name?: string;
  username?: string;
}
export const iconKeys = [
  "folder",
  "code",
  "box",
  "globe",
  "bolt",
  "layers",
  "team",
];
export const iconLabels: Record<string, string> = {
  folder: "文件夹",
  code: "代码",
  box: "立方体",
  globe: "地球",
  bolt: "闪电",
  layers: "图层",
  team: "团队",
};
export function statusLabel(status: string) {
  return (
    (
      { active: "正常", archived: "已归档", dissolved: "已解散" } as Record<
        string,
        string
      >
    )[status] ?? status
  );
}
