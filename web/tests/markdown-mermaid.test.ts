import { afterEach, beforeEach, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { renderDiagram } from "@/features/collaboration/markdown-mermaid";
beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 120, height: 30 }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 80,
  });
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("renders an actual flowchart as sanitized SVG", async () => {
  const svg = await renderDiagram("graph LR\nA[开始] --> B[完成]", false);
  expect(svg).toContain("<svg");
  expect(svg).toContain("开始");
  expect(svg).not.toMatch(/<script|<foreignObject|<image|onclick=/i);
}, 15000);
it("rejects configuration overrides and invalid diagram syntax", async () => {
  await expect(
    renderDiagram(
      '%%{init: {"securityLevel":"loose"}}%%\ngraph LR\nA-->B',
      false,
    ),
  ).rejects.toThrow();
  await expect(
    renderDiagram(
      "---\nconfig:\n  securityLevel: loose\n---\ngraph LR\nA-->B",
      false,
    ),
  ).rejects.toThrow();
  await expect(renderDiagram("not a diagram", false)).rejects.toThrow();
});

it("keeps the complete reported flowchart and scales it without a fixed height", async () => {
  const source = `flowchart TD
    A[Christmas] -->|Get money| B(Go shopping)
    B --> C{Let me think}
    C -->|One| D[Laptop]
    C -->|Two| E[iPhone]
    C -->|Three| F[fa:fa-car Car]`;
  const svg = await renderDiagram(source, false);
  const root = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  expect(root.querySelectorAll(".node")).toHaveLength(6);
  for (const label of [
    "Christmas",
    "Go shopping",
    "Let me think",
    "Laptop",
    "iPhone",
    "Car",
    "Get money",
    "One",
    "Two",
    "Three",
  ]) {
    expect(root.textContent).toContain(label);
  }
  expect(root.getAttribute("viewBox")).toBeTruthy();
  expect(root.getAttribute("width")).toBe("100%");
  expect(root.hasAttribute("height")).toBe(false);
  expect(root.getAttribute("preserveAspectRatio")).toBe("xMidYMin meet");
  expect(root.getAttribute("style")).toContain("height:auto");
});

it("preserves quoted local SVG marker styles while removing external resources", async () => {
  vi.spyOn(mermaid, "render").mockResolvedValueOnce({
    diagramType: "flowchart-v2",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><style>.edge { marker-end: url("#arrow"); }</style><style>.remote { fill: url(https://example.test/image.svg); }</style><defs><marker id="arrow" /></defs><path class="edge" d="M0 0L10 10"/></svg>`,
  });
  const svg = await renderDiagram("graph LR\nA-->B", false);
  expect(svg).toContain('url("#arrow")');
  expect(svg).not.toContain("example.test");
  expect(svg).toContain("max-width:400px;height:auto");
});
