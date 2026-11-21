import { Check, Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Modal } from "@/components/overlays";
import type { FileRef } from "@/types/agents";
import { agentRoot, workspaceFileURL } from "../data/agent-api";
import type { MessageWorkspaceFile } from "../data/send-flow";
import { artifactFormat } from "./artifact-cards";
import { FileReference, useFileReference } from "./content";
import styles from "./attachment-tiles.module.css";

type Item =
  | { kind: "file"; filename: string; file?: File; url?: string }
  | { kind: "reference"; reference: FileRef; sessionId?: string };

interface TileProps {
  item: Item;
  uploading?: boolean;
  saved?: boolean;
  disabled?: boolean;
  removeLabel?: string;
  onRemove?: () => void;
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void;
  inList?: boolean;
}

function Thumbnail({
  name,
  mediaType,
  file,
  url,
}: {
  name: string;
  mediaType: string;
  file?: File;
  url?: string;
}) {
  const format = artifactFormat(name, mediaType);
  const Icon = format.icon;
  const preview = format.kind === "image";
  const image = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState<File | string>();
  useEffect(() => {
    if (
      !file ||
      !preview ||
      !image.current ||
      typeof URL.createObjectURL !== "function"
    )
      return;
    const source = URL.createObjectURL(file);
    image.current.src = source;
    return () => URL.revokeObjectURL(source);
  }, [file, preview]);
  return (
    <span className={styles.thumb} data-tone={format.tone} aria-hidden="true">
      <Icon />
      {format.kind !== "image" && format.extension && (
        <span className={styles.extension}>{format.extension.slice(0, 6)}</span>
      )}
      {preview && (file || url) && failed !== (file ?? url) && (
        <img
          ref={image}
          src={file ? undefined : url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(file ?? url)}
        />
      )}
    </span>
  );
}

function ResolvedTile({
  name,
  mediaType = "",
  file,
  url,
  item,
  onOpen,
  inList,
  uploading,
  saved,
  disabled,
  removeLabel,
  onRemove,
}: TileProps & {
  name: string;
  mediaType?: string;
  file?: File;
  url?: string;
}) {
  const thumb = (
    <Thumbnail name={name} mediaType={mediaType} file={file} url={url} />
  );
  if (inList)
    return (
      <li className={styles.row}>
        {thumb}
        {item.kind === "reference" &&
        item.sessionId &&
        artifactFormat(name, mediaType).kind !== "image" ? (
          <FileReference
            reference={item.reference}
            sessionId={item.sessionId}
          />
        ) : (
          <span className={styles.fullName}>{name}</span>
        )}
        {url && (
          <a
            href={url}
            download={name}
            className={styles.download}
            aria-label={`下载 ${name}`}
          >
            <Download size={16} />
          </a>
        )}
      </li>
    );
  const caption = <span className={styles.caption}>{name}</span>;
  return (
    <div className={styles.tile} title={name}>
      {onOpen ? (
        <button
          type="button"
          className={styles.open}
          aria-label={`查看附件 ${name}`}
          onClick={onOpen}
        >
          {thumb}
          {caption}
        </button>
      ) : (
        <>
          {thumb}
          {caption}
        </>
      )}
      {uploading && (
        <span
          className={styles.uploading}
          role="status"
          aria-label={`正在上传 ${name}`}
        >
          <LoaderCircle />
        </span>
      )}
      {saved && !uploading && (
        <span className={styles.saved} aria-label="已保存" title="已保存">
          <Check size={10} />
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function ReferenceTile(
  props: TileProps & { item: Extract<Item, { kind: "reference" }> },
) {
  const { reference, sessionId } = props.item;
  const query = useFileReference(reference, sessionId);
  const file = query.data?.data;
  const name =
    file?.filename ?? (query.isError ? "文件暂不可用" : "正在读取文件…");
  const available =
    file &&
    ("state" in file
      ? ["bound", "staged"].includes(file.state)
      : !file.deleted_at);
  const url = available
    ? `/api/v1${agentRoot}/files/${encodeURIComponent(file.file_id)}/content`
    : undefined;
  return (
    <ResolvedTile
      {...props}
      name={name}
      mediaType={file?.media_type}
      url={url}
    />
  );
}

export function AttachmentTile(props: TileProps) {
  const { item } = props;
  if (item.kind === "reference")
    return <ReferenceTile {...props} item={item} />;
  return (
    <ResolvedTile
      {...props}
      name={item.filename}
      file={item.file}
      mediaType={item.file?.type}
      url={item.url}
    />
  );
}

export function MessageAttachments({
  references,
  files = [],
  sessionId,
  computerId,
}: {
  references: FileRef[];
  files?: MessageWorkspaceFile[];
  sessionId: string;
  computerId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items: Item[] = [
    ...references.map((reference) => ({
      kind: "reference" as const,
      reference,
      sessionId,
    })),
    ...files.map((file) => ({
      kind: "file" as const,
      filename: file.filename,
      file: file.file,
      url:
        computerId && file.path?.startsWith("/data/")
          ? workspaceFileURL(computerId, file.path.slice(6))
          : undefined,
    })),
  ];
  if (!items.length) return null;
  const visible = items.length > 4 ? items.slice(0, 3) : items;
  const remaining = items.length - visible.length;
  const show = (event: MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setOpen(true);
  };
  const key = (item: Item, index: number) =>
    item.kind === "reference"
      ? `${item.reference.kind}:${item.reference.id}`
      : `file:${index}:${item.filename}`;
  return (
    <>
      <div className={styles.strip} role="group" aria-label="消息附件">
        {visible.map((item, index) => (
          <AttachmentTile key={key(item, index)} item={item} onOpen={show} />
        ))}
        {remaining > 0 && (
          <button
            type="button"
            className={styles.more}
            onClick={show}
            aria-label={`查看全部 ${items.length} 个附件，另有 ${remaining} 个`}
          >
            +{remaining}
          </button>
        )}
      </div>
      {open && (
        <Modal
          open
          title={`消息附件（${items.length}）`}
          finalFocus={trigger}
          onClose={() => setOpen(false)}
        >
          <ul className={styles.list}>
            {items.map((item, index) => (
              <AttachmentTile key={key(item, index)} item={item} inList />
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
