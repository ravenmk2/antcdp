import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

export function normalizeDiagram(source: string) {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "image", "a"],
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.tagName !== "svg") throw new Error("无法读取图形尺寸");
  const box = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = box?.[2] ?? parseFloat(svg.getAttribute("width") || "");
  const height = box?.[3] ?? parseFloat(svg.getAttribute("height") || "");
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 100000))
    throw new Error("图形尺寸无效或过大");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("style");
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.endsWith("href") && !attribute.value.startsWith("#"))
        element.removeAttribute(attribute.name);
    }
  }
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

export type MermaidDiagram = ReturnType<typeof normalizeDiagram> & {
  image: string;
};

type RenderResult = { source: string; theme: string } & (
  | { diagram: MermaidDiagram; error?: never }
  | { diagram?: never; error: string }
);

// initialize changes Mermaid's global configuration, so both views share a queue.
let renderQueue = Promise.resolve();
let sequence = 0;

export function useMermaidDiagram(
  source: string,
  theme: "light" | "dark",
  enabled: boolean,
) {
  const [result, setResult] = useState<RenderResult>();
  const current =
    result?.source === source && result.theme === theme ? result : undefined;

  useEffect(() => {
    if (!enabled || current) return;
    let active = true;
    renderQueue = renderQueue.then(async () => {
      if (!active) return;
      try {
        const { default: mermaid } = await import("mermaid");
        if (!active) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: theme === "dark" ? "dark" : "default",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          fontFamily: "Microsoft YaHei UI, Segoe UI, sans-serif",
        });
        const { svg } = await mermaid.render(`diagram-${++sequence}`, source);
        if (!active) return;
        const diagram = normalizeDiagram(svg);
        const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`;
        setResult({ source, theme, diagram: { ...diagram, image } });
      } catch (error) {
        if (active)
          setResult({
            source,
            theme,
            error: error instanceof Error ? error.message : "图表语法无法解析",
          });
      }
    });
    return () => {
      active = false;
    };
  }, [current, enabled, source, theme]);

  return { result: current, retry: () => setResult(undefined) };
}
