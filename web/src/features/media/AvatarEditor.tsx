import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";
import { RotateCw, Upload } from "lucide-react";
import { Avatar } from "@/components/platform/avatar";
import { FormDialog } from "@/components/platform/form-dialog";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { request, errorMessage } from "@/lib/api";

type Draft = { id: string; preview_url: string };
export type AvatarHandle = { saved: () => void };
export function AvatarEditor({
  avatar,
  value,
  onChange,
  onProcessing,
  disabled,
  ref,
  uploadPath = "/avatar-uploads",
  label = "头像",
  placeholder,
}: {
  avatar?: { url: string } | null;
  value?: string | null;
  onChange: (id: string | null) => void;
  onProcessing: (pending: boolean) => void;
  disabled?: boolean;
  ref?: Ref<AvatarHandle>;
  uploadPath?: string;
  label?: string;
  placeholder?: ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>();
  const staged = useRef<Draft | undefined>(undefined);
  const [source, setSource] = useState<HTMLImageElement>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [crop, setCrop] = useState({ zoom: 1, angle: 0, x: 0, y: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const objectURL = useRef("");
  const position = useRef({ x: 0, y: 0 });
  const drag = useRef<
    { id: number; left: number; top: number; x: number; y: number } | undefined
  >(undefined);
  async function discard(old?: Draft) {
    if (old)
      await request(`${uploadPath}/${old.id}`, { method: "DELETE" }).catch(
        () => {},
      );
  }
  useImperativeHandle(ref, () => ({
    saved() {
      staged.current = undefined;
    },
  }));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      URL.revokeObjectURL(objectURL.current);
      void discard(staged.current);
    };
    // The endpoint is immutable for an editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onProcessing(busy || !!source);
  }, [busy, source, onProcessing]);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const sideways = crop.angle % 180 !== 0;
    const w = sideways ? source.naturalHeight : source.naturalWidth;
    const h = sideways ? source.naturalWidth : source.naturalHeight;
    const scale = Math.max(320 / w, 320 / h) * crop.zoom;
    const bx = Math.max(0, (w * scale - 320) / 2),
      by = Math.max(0, (h * scale - 320) / 2);
    const x = Math.max(-bx, Math.min(bx, crop.x)),
      y = Math.max(-by, Math.min(by, crop.y));
    position.current = { x, y };
    const ctx = canvas.current.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 640, 640);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.translate(160 + x, 160 + y);
    ctx.rotate((crop.angle * Math.PI) / 180);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      source,
      (-source.naturalWidth * scale) / 2,
      (-source.naturalHeight * scale) / 2,
      source.naturalWidth * scale,
      source.naturalHeight * scale,
    );
  }, [source, crop]);
  async function choose(file?: File) {
    if (!file || disabled || locked.current) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError("请选择不超过 2 MB 的 JPG、PNG 或 WebP 图片。");
      return;
    }
    const token = ++generation.current;
    locked.current = true;
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (
        !img.naturalWidth ||
        !img.naturalHeight ||
        img.naturalWidth > 4096 ||
        img.naturalHeight > 4096
      )
        throw Error("dimensions");
      if (!mounted.current || token !== generation.current) {
        URL.revokeObjectURL(url);
        return;
      }
      URL.revokeObjectURL(objectURL.current);
      objectURL.current = url;
      setCrop({ zoom: 1, angle: 0, x: 0, y: 0 });
      setSource(img);
    } catch {
      URL.revokeObjectURL(url);
      if (mounted.current)
        setError("图片无法读取或尺寸超过 4096 × 4096，请重新选择。");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function close() {
    if (locked.current) return;
    setSource(undefined);
    URL.revokeObjectURL(objectURL.current);
    objectURL.current = "";
    setError("");
  }
  async function apply() {
    if (locked.current || !canvas.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const output = document.createElement("canvas");
      output.width = output.height = 256;
      output.getContext("2d")!.drawImage(canvas.current, 0, 0, 256, 256);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (b) => (b ? resolve(b) : reject(Error("encoding"))),
          "image/png",
        ),
      );
      const body = new FormData();
      body.append("file", blob, "avatar.png");
      const r = await request<Draft>(uploadPath, { method: "POST", body });
      if (!mounted.current) {
        void discard(r.data);
        return;
      }
      void discard(staged.current);
      staged.current = r.data;
      setDraft(r.data);
      onChange(r.data.id);
      setSource(undefined);
      URL.revokeObjectURL(objectURL.current);
      objectURL.current = "";
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const preview =
    value === undefined
      ? avatar?.url
      : value === null
        ? null
        : draft?.preview_url;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {!preview && placeholder ? (
          placeholder
        ) : (
          <Avatar large name={`${label}预览`} url={preview} />
        )}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload />
              选择{label}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || busy || !preview}
              onClick={() => {
                void discard(staged.current);
                staged.current = undefined;
                setDraft(undefined);
                onChange(null);
              }}
            >
              移除
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            JPG、PNG 或 WebP，最大 2 MB；保存资料后生效。
          </p>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`上传${label}文件`}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void choose(file);
        }}
      />
      {!source && <ErrorBox>{error}</ErrorBox>}
      <FormDialog
        open={!!source}
        title={`裁剪${label}`}
        description="拖动图片或使用方向键调整，Shift 加快移动。"
        pending={busy}
        onClose={close}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              取消裁剪
            </Button>
            <Button type="button" disabled={busy} onClick={() => void apply()}>
              {busy ? "正在上传…" : `使用此${label}`}
            </Button>
          </>
        }
      >
        <ErrorBox>{error}</ErrorBox>
        <canvas
          ref={canvas}
          width={640}
          height={640}
          tabIndex={0}
          role="img"
          aria-label={`${label}裁剪区域，方向键移动图片`}
          className="mx-auto aspect-square w-full max-w-80 touch-none rounded-xl border bg-muted"
          onPointerDown={(e) => {
            if (e.button !== 0 || busy) return;
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              id: e.pointerId,
              left: position.current.x,
              top: position.current.y,
              x: e.clientX,
              y: e.clientY,
            };
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId || busy) return;
            const ratio = 320 / e.currentTarget.getBoundingClientRect().width;
            setCrop((c) => ({
              ...c,
              x: d.left + (e.clientX - d.x) * ratio,
              y: d.top + (e.clientY - d.y) * ratio,
            }));
          }}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onKeyDown={(e) => {
            if (
              busy ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            const n = e.shiftKey ? 10 : 2;
            setCrop((c) => ({
              ...c,
              x:
                position.current.x +
                (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0),
              y:
                position.current.y +
                (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0),
            }));
          }}
        />
        <label className="flex items-center gap-4">
          缩放
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={crop.zoom}
            disabled={busy}
            onChange={(e) => {
              const z = Number(e.target.value);
              setCrop((c) => ({
                ...c,
                zoom: z,
                x: (position.current.x * z) / c.zoom,
                y: (position.current.y * z) / c.zoom,
              }));
            }}
            className="min-w-0 flex-1"
          />
        </label>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setCrop((c) => ({
                ...c,
                angle: (c.angle + 90) % 360,
                x: 0,
                y: 0,
              }))
            }
          >
            <RotateCw />
            旋转
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setCrop({ zoom: 1, angle: 0, x: 0, y: 0 })}
          >
            重置裁剪
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            重新选择
          </Button>
        </div>
      </FormDialog>
    </div>
  );
}
