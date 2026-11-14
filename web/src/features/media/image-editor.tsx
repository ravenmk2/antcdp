import { api } from "@/api/client";
import { ImageEditor as Cropper } from "@/components/image-editor";
import type { ComponentProps } from "react";
export type { ImageValue } from "@/components/image-editor";
export function ImageEditor({
  kind,
  ...props
}: Omit<ComponentProps<typeof Cropper>, "upload"> & {
  kind: "avatar" | "icon";
}) {
  return (
    <Cropper
      {...props}
      upload={async (blob) => {
        const body = new FormData();
        body.append("file", blob, `${kind}.png`);
        const result = await api<{ id: string; preview_url: string }>(
          kind === "avatar" ? "/avatar-uploads" : "/icon-uploads",
          body,
        );
        return { id: result.id, preview: result.preview_url };
      }}
    />
  );
}
