import { request } from "@/lib/api";
import type { Page } from "@/shared/delivery";

export const groups = {
  sql: "数据库脚本",
  object: "对象存储文件",
  config: "配置文件",
  attachment: "附件",
} as const;
export type Kind = keyof typeof groups;
export interface Release {
  id: string;
  name?: string;
  version_label: string;
  tag_name: string;
  description_md: string;
  status: string;
  updated_at: string;
  etag: string;
  needs_attention?: boolean;
}
export interface Material {
  id: string;
  kind: Kind;
  filename: string;
  description_md: string;
  repository_id: string;
  database_name: string;
  bucket_name: string;
  target_path: string;
  config_format: string;
  config_mode: string;
  revision_id: string;
  revision_no: number;
  size_bytes: number;
  sha256: string;
  sql_position: number;
}
export interface MaterialSet {
  items: Material[];
  repositories: {
    id: string;
    full_path: string;
    main_branch: string;
    baseline_sha: string;
    baseline_kind: string;
  }[];
  can_edit: boolean;
}
export async function loadReleases(
  base: string,
  url: URL,
  signal: AbortSignal,
) {
  const id = url.searchParams.get("release");
  if (id) {
    if (!/^[1-9]\d*$/.test(id))
      throw new Response("发布不存在", { status: 404 });
    const detail = await request<Release>(base + "/releases/" + id, { signal });
    const set = await request<MaterialSet>(
      base + "/releases/" + id + "/items",
      { signal },
    );
    if (detail.etag !== set.etag)
      throw new Response("发布已更新，请刷新", { status: 409 });
    const flow = await request<Flow>(base + "/releases/" + id + "/workflow", {
      signal,
    });
    return {
      release: detail.data,
      materials: set.data,
      flow: flow.data,
      list: null,
    };
  }
  const page = Math.max(1, Number(url.searchParams.get("rpage")) || 1),
    size = Number(url.searchParams.get("rsize")) || 20;
  const list = await request<Page<Release>>(
    base +
      "/releases?page=" +
      page +
      "&page_size=" +
      size +
      "&q=" +
      encodeURIComponent(url.searchParams.get("rq") || "") +
      "&status=" +
      encodeURIComponent(url.searchParams.get("rstatus") || "all"),
    { signal },
  );
  return { release: null, materials: null, flow: null, list: list.data };
}
export type ReleaseData = Awaited<ReturnType<typeof loadReleases>>;
export const fileURL = (base: string, m: Material) =>
  "/api/v1" + base + "/items/" + m.id + "/revisions/" + m.revision_id + "/file";

type Repo = MaterialSet["repositories"][number];
export type MR = {
  iid: number;
  title: string;
  state: string;
  sha: string;
  merge_commit_sha?: string;
  squash_commit_sha?: string;
};
type Change = {
  id: string;
  repo_id: string;
  kind: string;
  ref: string;
  status: string;
  evidence: MR;
  note: string;
  reverted_by?: string;
};
export type Manifest = {
  id: string;
  sequence_no: number;
  digest: string;
  decision: string;
  review_note: string;
  created_at: string;
};
export type Op = {
  id: string;
  kind: string;
  status: string;
  created_at: string;
};
export interface Flow {
  changes: Change[];
  manifests: Manifest[];
  operations: Op[];
  steps: {
    kind: string;
    repo_id: string;
    status: string;
    observed: { reason?: string } | null;
  }[];
  can_manage: boolean;
}

export const actions: Record<string, string> = {
  start: "确认范围并开始",
  merge: "合并 MR",
  "create-revert": "创建回退 MR",
  "link-revert": "关联回退 MR",
  archive: "打 Tag 并归档",
  review: "记录验收",
  return: "撤销验收",
  terminate: "终止发布",
  baseline: "确认基线",
  "select-mr": "添加 MR",
  "include-commit": "补录提交",
  "remove-change": "移出变更",
  reconcile: "核实远端结果",
  freeze: "冻结送验",
  "refresh-scope": "更新仓库范围",
};
export type Command = {
  op: string;
  repo?: Repo;
  change?: Change;
  ref?: string;
  decision?: string;
};
