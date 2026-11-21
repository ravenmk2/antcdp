import { useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  FileSpreadsheet,
  FileChartColumn,
  FileImage,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  FileDigit,
} from "lucide-react";
import type { Artifact } from "@/types/agents";
import { Drawer, OverlayCancelButton } from "@/components/overlays";
import { FileView } from "./content";
import { useDisclosureMotion } from "./disclosure-motion";
import styles from "./artifact-cards.module.css";

const formats = {
  pdf: { icon: FileText, label: "PDF", tone: "red" },
  document: { icon: FileText, label: "文档", tone: "blue" },
  markdown: { icon: FileText, label: "Markdown", tone: "violet" },
  spreadsheet: { icon: FileSpreadsheet, label: "表格", tone: "green" },
  presentation: { icon: FileChartColumn, label: "演示文稿", tone: "orange" },
  image: { icon: FileImage, label: "图片", tone: "violet" },
  code: { icon: FileCode, label: "代码", tone: "blue" },
  archive: { icon: FileArchive, label: "压缩文件", tone: "orange" },
  audio: { icon: FileAudio, label: "音频", tone: "violet" },
  video: { icon: FileVideo, label: "视频", tone: "violet" },
  text: { icon: FileText, label: "文本", tone: "slate" },
  binary: { icon: FileDigit, label: "二进制文件", tone: "slate" },
} as const;
type Format = keyof typeof formats;
const extensions = new Map<string, Format>();
for (const [kind, names] of Object.entries({
  pdf: "pdf",
  document: "doc docx odt rtf",
  markdown: "md markdown mdx",
  spreadsheet: "xls xlsx ods csv tsv",
  presentation: "ppt pptx odp",
  image: "png jpg jpeg gif webp svg avif bmp ico tif tiff heic",
  code: "js jsx ts tsx json jsonl html htm css scss py go rs java c cpp h hpp cs sh bash ps1 sql yaml yml toml xml vue svelte ipynb",
  archive: "zip tar gz tgz bz2 xz 7z rar",
  audio: "mp3 wav ogg flac m4a aac",
  video: "mp4 mov webm mkv avi",
  text: "txt log",
}))
  for (const extension of names.split(" "))
    extensions.set(extension, kind as Format);

export function artifactFormat(filename: string, mediaType: string) {
  const extension = filename.includes(".")
    ? filename.split(".").at(-1)!.toLowerCase()
    : "";
  const mime = mediaType.split(";", 1)[0].trim().toLowerCase();
  const kind: Format =
    extensions.get(extension) ??
    (mime === "application/pdf"
      ? "pdf"
      : mime.startsWith("image/")
        ? "image"
        : mime.startsWith("audio/")
          ? "audio"
          : mime.startsWith("video/")
            ? "video"
            : mime === "text/markdown"
              ? "markdown"
              : mime === "application/json"
                ? "code"
                : mime === "text/csv"
                  ? "spreadsheet"
                  : mime.startsWith("text/")
                    ? "text"
                    : "binary");
  return { ...formats[kind], kind, extension: extension.toUpperCase() };
}
function fileSize(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactCards({
  files,
  sessionId,
}: {
  files: Artifact[];
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<Artifact | null>(null);
  const motion = useDisclosureMotion();
  if (!files.length) return null;
  const visible = expanded ? files : files.slice(0, 6);
  return (
    <section className={styles.root} aria-label="本轮制品">
      <div className={styles.grid}>
        {visible.map((file) => {
          const format = artifactFormat(file.filename, file.media_type);
          const Icon = format.icon;
          return (
            <button
              key={file.id}
              type="button"
              className={styles.card}
              aria-label={`查看制品：${file.filename}`}
              data-file-kind={format.kind}
              title={[file.filename, file.description]
                .filter(Boolean)
                .join("\n")}
              onClick={() => setPreview(file)}
            >
              <span className={styles.icon} data-tone={format.tone}>
                <Icon aria-hidden="true" />
              </span>
              <span className={styles.body}>
                <span className={styles.name}>{file.filename}</span>
                {file.description && (
                  <span className={styles.description}>{file.description}</span>
                )}
                <span className={styles.meta}>
                  <span>
                    {format.kind === "binary"
                      ? format.label
                      : format.extension || format.label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{fileSize(file.size_bytes)}</span>
                </span>
              </span>
              <ArrowUpRight className={styles.arrow} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {files.length > 6 && (
        <button
          type="button"
          className={`${styles.toggle} agent-artifact-toggle`}
          aria-expanded={expanded}
          onClick={(event) =>
            motion.toggle(event, () => setExpanded(!expanded))
          }
        >
          {expanded ? "收起制品" : `展开其余 ${files.length - 6} 个制品`}
          {expanded ? (
            <ChevronUp aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </button>
      )}
      {preview && (
        <Drawer
          open
          wide
          title={preview.filename}
          onClose={() => setPreview(null)}
          footer={<OverlayCancelButton>关闭</OverlayCancelButton>}
        >
          <FileView id={preview.file_id} sessionId={sessionId} />
        </Drawer>
      )}
    </section>
  );
}
