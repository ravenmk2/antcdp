import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { agentRoot } from "../data/agent-api";

type UploadItem = {
  id: number;
  file: File;
  status: "waiting" | "uploading" | "uploaded" | "failed" | "unknown";
  message?: string;
};

const statusText: Record<UploadItem["status"], string> = {
  waiting: "等待上传",
  uploading: "上传中",
  uploaded: "已上传",
  failed: "上传失败",
  unknown: "结果待核实",
};

function canUpload(item: UploadItem) {
  return item.status === "waiting" || item.status === "failed";
}

export function UploadDialog({
  computerId,
  path,
  onClose,
  onChanged,
}: {
  computerId: string;
  path: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const retrying =
    !items.some((item) => item.status === "waiting") && items.some(canUpload);

  function addFiles(files: FileList) {
    const additions = Array.from(files, (file) => ({
      id: nextId.current++,
      file,
      status: "waiting" as const,
    }));
    setItems((current) => [...current, ...additions]);
  }

  function updateItem(
    id: number,
    status: UploadItem["status"],
    message?: string,
  ) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status, message } : item,
      ),
    );
  }

  async function upload() {
    setPending(true);
    let changed = false;
    const endpoint = `${agentRoot}/cloud-computers/${computerId}/file-uploads?${new URLSearchParams({ path })}`;
    for (const { id, file } of items.filter(canUpload)) {
      updateItem(id, "uploading");
      const body = new FormData();
      body.set("file", file);
      try {
        await request(endpoint, { method: "POST", body });
        updateItem(id, "uploaded");
        changed = true;
      } catch (error) {
        const uncertain =
          error instanceof ApiError &&
          (error.uncertain || error.code === "WORKSPACE_IO_OUTCOME_UNKNOWN");
        updateItem(
          id,
          uncertain ? "unknown" : "failed",
          error instanceof ApiError ? error.message : "上传失败，请重试",
        );
        changed ||= uncertain;
      }
    }
    setPending(false);
    if (changed) onChanged();
  }

  return (
    <Modal
      open
      title="上传文件"
      description={
        <span className="break-all">
          保存到 <span className="font-mono">/data{path && `/${path}`}</span>
        </span>
      }
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <OverlayCancelButton>关闭</OverlayCancelButton>
          <Button
            pending={pending}
            disabled={!items.some(canUpload)}
            onClick={() => void upload()}
          >
            {pending ? "正在上传" : retrying ? "重试失败项" : "开始上传"}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-subtle p-5 text-center"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = pending ? "none" : "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!pending) addFiles(event.dataTransfer.files);
        }}
      >
        <Upload className="size-5 text-muted" />
        <p className="text-sm">将文件拖到这里</p>
        <input
          ref={fileInput}
          type="file"
          aria-label="选择要上传的文件"
          multiple
          hidden
          disabled={pending}
          onChange={(event) => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => fileInput.current?.click()}
        >
          选择文件
        </Button>
        <p className="text-xs text-muted">单个文件最大 32 MiB</p>
      </div>
      {items.length > 0 && (
        <ul
          aria-label="上传队列"
          className="mt-3 divide-y divide-border-subtle"
        >
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={item.file.name}>
                  {item.file.name}
                </p>
                {item.message && (
                  <p className="text-xs text-muted">{item.message}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted" role="status">
                {statusText[item.status]}
              </span>
              {!pending && canUpload(item) && (
                <IconButton
                  label={`移除 ${item.file.name}`}
                  size="iconSm"
                  onClick={() =>
                    setItems((current) =>
                      current.filter((entry) => entry.id !== item.id),
                    )
                  }
                >
                  <X />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
