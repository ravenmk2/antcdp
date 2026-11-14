import type { SandboxNetworkPolicy } from "./agents";

export interface SandboxNetworkPreset {
  id: string;
  name: string;
  description: string;
  action: "deny";
  targets: string[];
  content_sha256: string;
}
export interface NetworkPresetCatalog {
  items: SandboxNetworkPreset[];
  catalog_version: string;
}
export interface NetworkSnapshot extends SandboxNetworkPolicy {
  resolved_presets: Pick<
    SandboxNetworkPreset,
    "id" | "action" | "targets" | "content_sha256"
  >[];
  policy_sha256: string;
}
