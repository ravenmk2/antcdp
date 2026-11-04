export function releaseDisplayName(release: {
  name?: string;
  version_label: string;
}) {
  return release.name?.trim() || release.version_label;
}

export const releaseStatusLabels: Record<string, string> = {
  draft: "草稿",
  integrating: "合并与备料",
  reviewing: "待验收",
  accepted: "待归档",
  tagging: "归档中",
  archived: "已归档",
  terminated: "已终止",
};

export function safeProjectReleaseReturn(value: string | null, root: string) {
  if (!value || !/^\/(?:admin\/)?projects\/[1-9]\d*$/.test(root)) return;
  if (!value.startsWith(root) || /[\\#\p{Cc}]/u.test(value)) return;
  try {
    const url = new URL(value, "https://antcdp.invalid");
    if (url.origin !== "https://antcdp.invalid" || url.pathname !== root)
      return;
    const tabs = url.searchParams.getAll("tab");
    if (
      tabs.length > 1 ||
      (tabs.length && !["overview", "releases"].includes(tabs[0]!))
    )
      return;
    url.searchParams.delete("create");
    url.searchParams.delete("return_to");
    return url.pathname + url.search;
  } catch {
    return;
  }
}
