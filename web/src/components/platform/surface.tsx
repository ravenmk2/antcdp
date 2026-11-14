import { useLayoutEffect, useState, type ReactNode } from "react";
import { NavigationGuardHost } from "../navigation-guard";
import { ToastHost } from "../toast";
import { SurfaceContext, type SurfaceArea } from "./surface-context";

/** The body-level portal shares the surface's CSS modules without its clipping. */
export function Surface({
  area,
  className,
  children,
}: {
  area: SurfaceArea;
  className: string;
  children: ReactNode;
}) {
  const [portal] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    portal.dataset.area = area;
    portal.dataset.portalHost = "";
    portal.className = className;
    document.body.append(portal);
    return () => portal.remove();
  }, [area, className, portal]);
  return (
    <SurfaceContext value={{ area, portal }}>
      <div data-area={area} className={className}>
        {children}
      </div>
      <ToastHost />
      <NavigationGuardHost />
    </SurfaceContext>
  );
}
