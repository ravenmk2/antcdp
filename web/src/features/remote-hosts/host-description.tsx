import { DescriptionPreview } from "@/components/description-preview";

export function HostDescription(props: { name: string; description: string }) {
  return <DescriptionPreview {...props} label="主机说明" />;
}
