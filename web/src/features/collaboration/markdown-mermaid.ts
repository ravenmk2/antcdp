import mermaid from "mermaid";
import DOMPurify from "dompurify";

let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
export function renderDiagram(source: string, dark: boolean) {
  const task = queue.then(async () => {
    // Document-level directives must not override application rendering policy.
    if (/%%\s*\{|^\s*---/m.test(source))
      throw new Error("图表不支持内嵌配置，请直接填写 Mermaid 图形语法。");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      fontFamily: "MiSans, sans-serif",
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 500,
      flowchart: { htmlLabels: false },
      htmlLabels: false,
    });
    await document.fonts?.load("16px MiSans", source).catch(() => []);
    const { svg } = await mermaid.render(`project-mermaid-${++nextId}`, source);
    const safe = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "image", "a"],
      FORBID_ATTR: ["href", "xlink:href"],
    });
    const root = new DOMParser().parseFromString(
      safe,
      "image/svg+xml",
    ).documentElement;
    // Keep generated local marker references, but never load external CSS resources.
    for (const node of root.querySelectorAll("style, [style]")) {
      const css =
        node.tagName === "style"
          ? node.textContent || ""
          : node.getAttribute("style") || "";
      const withoutLocalReferences = css.replace(
        /url\(\s*(?:"#[^"]+"|'#[^']+'|#[^)\s]+)\s*\)/gi,
        "",
      );
      if (/@import|url\s*\(/i.test(withoutLocalReferences)) {
        if (node.tagName === "style") node.remove();
        else node.removeAttribute("style");
      }
    }
    const bounds = root.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
    if (
      bounds?.length === 4 &&
      bounds.every(Number.isFinite) &&
      bounds[2]! > 0 &&
      bounds[3]! > 0
    ) {
      root.setAttribute("width", "100%");
      root.removeAttribute("height");
      root.setAttribute("preserveAspectRatio", "xMidYMin meet");
      root.setAttribute("style", `max-width:${bounds[2]}px;height:auto`);
    }
    return new XMLSerializer().serializeToString(root);
  });
  queue = task.catch(() => {});
  return task;
}
