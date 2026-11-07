import { useEffect, useRef, useState, type PointerEvent } from "react";
import { RotateCw, Upload } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "./button";
import { ErrorNotice, Notice } from "./feedback";
import { Modal } from "./overlays";

export interface ImageValue {
  id: string;
  preview: string;
}
export function ImageEditor({
  kind,
  current,
  value,
  onChange,
  disabled,
  compact = false,
  onEditingChange,
}: {
  kind: "avatar" | "icon";
  current?: string | null;
  value?: ImageValue | null;
  onChange: (value: ImageValue | null | undefined) => void;
  disabled?: boolean;
  compact?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string>();
  const [error, setError] = useState("");
  const preview = value === undefined ? current : value?.preview;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {!compact &&
        (preview ? (
          <img
            src={preview}
            alt="当前图片预览"
            className="size-16 rounded-xl object-cover"
          />
        ) : (
          <span className="grid size-16 place-items-center rounded-xl bg-surface-subtle text-muted">
            <Upload className="size-5" />
          </span>
        ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {compact ? "上传图片" : "选择并裁剪图片"}
        </Button>
        {!compact && (value !== undefined || current) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            移除图片
          </Button>
        )}
      </div>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择 JPG、PNG 或 WebP 图片"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError("");
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("请选择 JPG、PNG 或 WebP 图片。");
            return;
          }
          onEditingChange?.(true);
          setSource(URL.createObjectURL(file));
        }}
      />
      {error && (
        <p className="w-full text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {source && (
        <CropDialog
          kind={kind}
          source={source}
          onClose={() => {
            setSource(undefined);
            onEditingChange?.(false);
          }}
          onSaved={(result) => {
            onEditingChange?.(false);
            onChange(result);
            setSource(undefined);
          }}
        />
      )}
    </div>
  );
}

function CropDialog({
  kind,
  source,
  onClose,
  onSaved,
}: {
  kind: "avatar" | "icon";
  source: string;
  onClose: () => void;
  onSaved: (value: ImageValue) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = new Image();
    element.onload = () => {
      image.current = element;
      setReady(true);
    };
    element.onerror = () => setError("图片无法解码，请选择其他文件。");
    element.src = source;
    return () => {
      image.current = null;
    };
  }, [source]);
  useEffect(() => {
    draw(canvas.current, image.current, zoom, rotation, offset);
  }, [ready, zoom, rotation, offset]);
  useEffect(() => () => URL.revokeObjectURL(source), [source]);
  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + event.clientX - drag.current.x,
      y: drag.current.oy + event.clientY - drag.current.y,
    });
  }
  async function confirm() {
    const element = canvas.current;
    if (!element || pending) return;
    setPending(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        element.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("图片处理失败，请重试。");
      if (blob.size > 2 * 1024 * 1024)
        throw new Error("裁剪后的图片超过 2 MiB，请缩小或更换原图。");
      const body = new FormData();
      body.append("file", blob, `${kind}.png`);
      const result = await api<{ id: string; preview_url: string }>(
        kind === "avatar" ? "/avatar-uploads" : "/icon-uploads",
        body,
      );
      onSaved({ id: result.id, preview: result.preview_url });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败，请重试。");
      setPending(false);
    }
  }
  return (
    <Modal
      open
      wide
      title="裁剪图片"
      description="输出为 256×256 PNG；保存所属资料后才会正式绑定。"
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            pending={pending}
            disabled={!ready || Boolean(error)}
            onClick={() => void confirm()}
          >
            使用此图片
          </Button>
        </>
      }
    >
      <ErrorNotice error={error} />
      <div className="grid gap-5 sm:grid-cols-[300px_1fr]">
        <canvas
          ref={canvas}
          width={256}
          height={256}
          className="size-[256px] cursor-move touch-none rounded-xl bg-surface-subtle focus:outline-offset-4"
          tabIndex={0}
          aria-label="图片裁剪区域，可拖动或使用方向键微调"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onWheel={(event) => {
            event.preventDefault();
            setZoom((current) =>
              Math.min(10, Math.max(1, current - event.deltaY * 0.001)),
            );
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 2;
            const delta =
              event.key === "ArrowLeft"
                ? { x: -step, y: 0 }
                : event.key === "ArrowRight"
                  ? { x: step, y: 0 }
                  : event.key === "ArrowUp"
                    ? { x: 0, y: -step }
                    : event.key === "ArrowDown"
                      ? { x: 0, y: step }
                      : null;
            if (delta) {
              event.preventDefault();
              setOffset((current) => ({
                x: current.x + delta.x,
                y: current.y + delta.y,
              }));
            }
          }}
        />
        <div className="grid content-start gap-4">
          <label className="grid gap-2 text-xs">
            缩放 {zoom.toFixed(2)}×
            <input
              type="range"
              min="1"
              max="10"
              step="0.01"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <Button
            variant="outline"
            onClick={() => setRotation((current) => (current + 90) % 360)}
          >
            <RotateCw />
            旋转 90°
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setZoom(1);
              setRotation(0);
              setOffset({ x: 0, y: 0 });
            }}
          >
            重置位置
          </Button>
          <Notice>
            可拖动图片、滚轮缩放或使用方向键微调。原图仅在浏览器本地处理。
          </Notice>
        </div>
      </div>
    </Modal>
  );
}

function draw(
  canvas: HTMLCanvasElement | null,
  image: HTMLImageElement | null,
  zoom: number,
  rotation: number,
  offset: { x: number; y: number },
) {
  if (!canvas || !image) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, 256, 256);
  const radians = (rotation * Math.PI) / 180;
  const rotated = rotation % 180 !== 0;
  const width = rotated ? image.naturalHeight : image.naturalWidth;
  const height = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.max(256 / width, 256 / height) * zoom;
  context.save();
  context.translate(128 + offset.x, 128 + offset.y);
  context.rotate(radians);
  context.scale(scale, scale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}
