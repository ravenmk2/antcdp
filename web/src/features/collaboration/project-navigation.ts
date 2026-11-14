export function isRemovedProjectView(params: URLSearchParams) {
  return (
    ["variants", "releases", "branch-model"].includes(
      params.get("tab") ?? "",
    ) ||
    params.get("section") === "branch-model" ||
    params.has("release")
  );
}
