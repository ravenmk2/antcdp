import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MermaidDiagram } from "@/features/collaboration/MermaidDiagram";
import { fitDiagramViewport } from "@/features/collaboration/diagram-viewport";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g id="graph"><text>complete diagram</text></g></svg>';
beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 150, y: 80, width: 800, height: 950 }),
  });
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId || 1;
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
});
it("replaces an undersized generated viewBox with complete final drawing bounds", () => {
  const host = document.createElement("div");
  host.innerHTML = svg;
  const element = host.querySelector("svg")!;
  fitDiagramViewport(element);
  expect(element.getAttribute("viewBox")).toBe("130 60 840 990");
  expect(element.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  expect(element.style.height).toBe("100%");
});
it("opens a modal, zooms, pans, resets and restores focus without duplicate SVG IDs", async () => {
  const user = userEvent.setup();
  render(<MermaidDiagram svg={svg} />);
  await waitFor(() =>
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "130 60 840 990",
    ),
  );
  const trigger = screen.getByRole("button", { name: "放大查看 Mermaid 图表" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.querySelectorAll("#graph")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "放大图形" }));
  expect(screen.getByLabelText("图形缩放比例").textContent).toBe("125%");
  const region = screen.getByRole("region", { name: "图形缩放与移动区域" });
  fireEvent.pointerDown(region, {
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(region, { pointerId: 1, clientX: 160, clientY: 140 });
  fireEvent.pointerUp(region, { pointerId: 1 });
  expect(region.firstElementChild?.getAttribute("style")).toContain(
    "translate(60px, 40px)",
  );
  fireEvent.wheel(region, { deltaY: -100 });
  expect(screen.getByLabelText("图形缩放比例").textContent).toBe("144%");
  await user.click(screen.getByRole("button", { name: "复位" }));
  expect(region.firstElementChild?.getAttribute("style")).toContain(
    "translate(0px, 0px) scale(1)",
  );
  fireEvent.keyDown(region, { key: "ArrowRight" });
  expect(region.firstElementChild?.getAttribute("style")).toContain(
    "translate(40px, 0px)",
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
