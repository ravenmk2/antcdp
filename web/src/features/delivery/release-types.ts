import type { Resource } from "@/types/collaboration";
import type {
  MaterialSet,
  Release,
  ReleaseFlow,
  Variant,
} from "@/types/delivery";

export interface ReleaseViewProps {
  project: Resource;
  variant: Variant;
  release: Release;
  releaseEtag: string;
  materials: MaterialSet;
  flow: ReleaseFlow;
  onChanged: () => Promise<void>;
}

export function releaseBase(
  props: Pick<ReleaseViewProps, "project" | "variant" | "release">,
) {
  return `/projects/${props.project.id}/variants/${props.variant.id}/releases/${props.release.id}`;
}

export function evidenceString(
  change: { evidence: Record<string, unknown> },
  key: string,
) {
  const value = change.evidence[key];
  return typeof value === "string" ? value : "";
}
