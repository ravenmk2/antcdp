import { createContext, useContext } from "react";

export type SurfaceArea = "public" | "console" | "workspace" | "account";
export interface SurfaceContextValue {
  area: SurfaceArea;
  portal: HTMLElement;
}
export const SurfaceContext = createContext<SurfaceContextValue | null>(null);

export function usePortalContainer() {
  return useContext(SurfaceContext)?.portal;
}
