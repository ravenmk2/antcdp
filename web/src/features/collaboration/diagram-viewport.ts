// Measure the final, mounted SVG in its own user coordinate system. Generated
// viewBoxes can be stale after font loading, sanitization or host styling.
export function fitDiagramViewport(svg: SVGSVGElement) {
  const bounds = svg.getBBox();
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return;
  const padding = 20;
  svg.setAttribute(
    "viewBox",
    `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`,
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.maxWidth = "none";
}
