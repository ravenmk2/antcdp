import { AttachmentTile } from "./attachment-tiles";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Image as ImageIcon,
  Upload,
  X,
  LoaderCircle,
} from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import type {
  CapabilityCatalog,
  InputAccepted,
  ModelOption,
  SessionDetail,
} from "@/types/agents";
import { agentRoot } from "../data/agent-api";
import {
  useAgentRuntime,
  useConversationDraft,
  useConversationSend,
} from "../data/agent-runtime";
import type { SendPlan } from "../data/send-flow";

export function ChatComposer({
  id,
  target,
  imageInput,
  disabled,
  placeholder = "描述你希望完成的任务…",
  children,
  onAccepted,
  onOpenSession,
  queuePaused = false,
  running = false,
  hasQueuedInputs = false,
  variant = "conversation",
  footerLeading,
  primaryAction,
  sendLabel = "发送",
  settings,
}: {
  id: string;
  target: SendPlan["session"] | null;
  imageInput?: ModelOption["image_input"];
  disabled?: boolean;
  placeholder?: string;
  children?: ReactNode;
  onAccepted: (sessionId: string, result: InputAccepted) => void;
  onOpenSession?: (sessionId: string) => void;
  queuePaused?: boolean;
  running?: boolean;
  hasQueuedInputs?: boolean;
  variant?: "conversation" | "start";
  footerLeading?: ReactNode;
  primaryAction?: ReactNode;
  sendLabel?: string;
  settings?: ReactNode;
}) {
  const runtime = useAgentRuntime();
  const { state: draft, draft: editor } = useConversationDraft(id),
    { flow, state, release } = useConversationSend(id);
  const [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false),
    [current, setCurrent] = useState<SessionDetail | null>(null),
    [reading, setReading] = useState(false);
  const handled = useRef<string | null>(null),
    imagePicker = useRef<HTMLInputElement>(null),
    attachmentPicker = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  const caps = useApiQuery<CapabilityCatalog>(
    ["agent-capabilities"],
    `${agentRoot}/capabilities`,
  );
  const locked = state.phase !== "idle",
    pending = state.phase === "sending",
    uncertain = state.phase === "uncertain";
  const value = locked ? (state.plan?.text ?? draft.text) : draft.text;
  const workspaceFiles = state.plan?.workspaceFiles ?? draft.workspaceFiles;
  const sendingLabel = {
    session: "正在建立会话",
    image: `正在上传图片 ${state.uploadIndex + 1} / ${state.plan?.images.length ?? 0}`,
    prepare: "正在准备会话云电脑",
    workspace: `正在上传工作区文件 ${state.workspaceIndex + 1} / ${workspaceFiles.length}`,
    input: "正在发送消息",
  }[state.stage];
  const textBytes = new TextEncoder().encode(value).byteLength;
  const textLimit = caps.data?.data.limits.input_text_bytes ?? 32768;
  const canUseImages = imageInput === "supported";
  const hasMessage = Boolean(
    value.trim() ||
    draft.images.length ||
    draft.file_refs.length ||
    workspaceFiles.length,
  );
  const hasDraft = hasMessage;
  const sendDisabled =
    disabled ||
    !target ||
    locked ||
    textBytes > textLimit ||
    !hasMessage ||
    (!!draft.images.length && !canUseImages);
  const workspaceFailed =
    state.phase === "failed" &&
    (state.stage === "workspace" || state.stage === "prepare");
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 260)}px`;
  }, [value]);
  useLayoutEffect(() => {
    if (
      state.phase !== "accepted" ||
      !state.result ||
      !state.sessionId ||
      handled.current === state.result.input_id
    )
      return;
    handled.current = state.result.input_id;
    const sessionId = state.sessionId,
      result = state.result;
    release();
    editor.clearContent();
    flow.reset();
    onAccepted(sessionId, result);
  }, [state, editor, flow, onAccepted, release]);
  const selectionConflict =
    state.error instanceof ApiError &&
    state.error.code === "MODEL_SELECTION_CHANGED";
  const send = () => {
    if (!target || sendDisabled) return;
    setError(undefined);
    void flow.start({
      placement:
        running || queuePaused || hasQueuedInputs ? "queued" : "transcript",
      session: target,
      text: draft.text,
      textLimit,
      images: draft.images,
      workspaceFiles: draft.workspaceFiles,
      file_refs: draft.file_refs,
    });
  };
  function addFiles(
    files: FileList | null,
    source: "image" | "workspace" | "mixed",
  ) {
    if (!files || !caps.data || disabled || locked) return;
    const added = Array.from(files);
    if (source === "image" && added.some((file) => !isImage(file))) {
      setError("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }
    const images = source === "workspace" ? [] : added.filter(isImage);
    const workspace =
      source === "image"
        ? []
        : added.filter((file) => source === "workspace" || !isImage(file));
    const limits = caps.data.data.limits;
    if (images.length && !canUseImages) {
      setError(
        "当前模型不支持图片输入。工作文件可通过「上传文件到工作区」添加。",
      );
      return;
    }
    if (
      draft.images.length + draft.file_refs.length + images.length >
      limits.input_file_refs
    ) {
      setError(`每次最多 ${limits.input_file_refs} 个文件引用。`);
      return;
    }
    if (images.some((file) => file.size > limits.attachment_file_bytes)) {
      setError(
        `单张图片不能超过 ${limits.attachment_file_bytes.toLocaleString()} 字节。`,
      );
      return;
    }
    const workspaceLimit =
      limits.workspace_file_bytes ?? limits.attachment_file_bytes;
    if (workspace.some((file) => file.size > workspaceLimit)) {
      setError(
        `单个工作区文件不能超过 ${workspaceLimit.toLocaleString()} 字节。`,
      );
      return;
    }
    editor.patch({
      images: [...draft.images, ...images],
      workspaceFiles: [
        ...draft.workspaceFiles,
        ...workspace.map((file) => ({ file })),
      ],
    });
    setError(undefined);
  }
  return (
    <div className="agent-composer" data-variant={variant}>
      <div className="space-y-3">
        <div className="agent-composer-feedback space-y-3">
          <ErrorNotice error={error} />
          <ErrorNotice error={state.receiptMissing ? undefined : state.error} />
          {!canUseImages && draft.images.length > 0 && (
            <Notice tone="warning">
              当前模型不支持草稿中的图片，请切换模型或移除图片。
            </Notice>
          )}
          {uncertain && (
            <Notice tone="warning" title="发送结果尚未确认">
              {state.receiptMissing
                ? "暂未查到回执，不代表原操作没有执行。"
                : "原步骤和请求键仍保留，不会重新创建会话或重复上传已经确认的工作区文件。"}
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => void flow.recover("receipt")}
                >
                  查询原步骤结果
                </Button>
                {(state.stage !== "workspace" || state.receiptMissing) && (
                  <Button
                    variant="outline"
                    onClick={() => void flow.recover("retry")}
                  >
                    重试原步骤
                  </Button>
                )}
              </div>
            </Notice>
          )}
          {state.phase === "failed" && (
            <Notice tone="warning">
              {state.sessionId
                ? "会话已建立，正文与已上传工作区文件仍保留。"
                : "尚未完成会话创建，原输入仍保留。"}
              <div className="mt-3 flex flex-wrap gap-2">
                {selectionConflict ? (
                  <Button
                    variant="outline"
                    pending={reading}
                    onClick={() => {
                      if (!state.sessionId) return;
                      setReading(true);
                      void request<SessionDetail>(
                        `${agentRoot}/sessions/${state.sessionId}`,
                      )
                        .then((response) => setCurrent(response.data))
                        .catch(setError)
                        .finally(() => setReading(false));
                    }}
                  >
                    读取当前模型选择
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void flow.retryKnown()}
                  >
                    继续发送
                  </Button>
                )}
                {workspaceFailed && (
                  <Button
                    variant="outline"
                    onClick={() => void flow.removeFailedWorkspaceFiles()}
                  >
                    {state.stage === "prepare"
                      ? "移除未保存的工作区文件并继续"
                      : "移除失败工作区文件并继续"}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDiscard(true)}>
                  结束本次提交
                </Button>
              </div>
              {current && (
                <div className="mt-3">
                  <p className="mb-2">
                    当前选择：{current.selection.model_name} ·{" "}
                    {current.selection.thinking_label}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void flow.retryKnown(
                        current.selection.model_selection_hash,
                      );
                      setCurrent(null);
                    }}
                  >
                    按当前选择继续发送
                  </Button>
                </div>
              )}
            </Notice>
          )}
          {queuePaused && (
            <p className="text-sm text-warning">
              队列已暂停；发送会加入队列，需要明确恢复后执行。
            </p>
          )}
        </div>
        <div
          className="agent-composer-surface"
          data-dragging={dragging}
          onDragOver={(event) => {
            if (
              !disabled &&
              !locked &&
              event.dataTransfer.types.includes("Files")
            ) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files, "mixed");
          }}
        >
          {children && <div className="agent-composer-config">{children}</div>}
          {(draft.images.length > 0 ||
            workspaceFiles.length > 0 ||
            draft.file_refs.length > 0) && (
            <div className="agent-composer-attachments" aria-label="待发送文件">
              {draft.images.map((file, index) => (
                <AttachmentTile
                  key={`image:${index}:${file.name}`}
                  item={{ kind: "file", filename: file.name, file }}
                  removeLabel={`移除图片 ${file.name}`}
                  disabled={disabled || locked}
                  uploading={
                    pending &&
                    state.stage === "image" &&
                    index === state.uploadIndex
                  }
                  onRemove={() =>
                    editor.patch({
                      images: draft.images.filter((_, i) => i !== index),
                    })
                  }
                />
              ))}
              {workspaceFiles.map(({ file, savedName }, index) => (
                <AttachmentTile
                  key={`workspace:${index}:${file.name}`}
                  item={{
                    kind: "file",
                    filename: savedName ?? file.name,
                    file,
                  }}
                  removeLabel={`移除工作区文件 ${file.name}`}
                  disabled={disabled || locked}
                  saved={Boolean(savedName)}
                  uploading={
                    pending &&
                    state.stage === "workspace" &&
                    index === state.workspaceIndex
                  }
                  onRemove={() =>
                    editor.patch({
                      workspaceFiles: draft.workspaceFiles.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                />
              ))}
              {draft.file_refs.map((ref) => (
                <AttachmentTile
                  key={`${ref.kind}:${ref.id}`}
                  item={{
                    kind: "reference",
                    reference: ref,
                    sessionId:
                      target && "id" in target
                        ? target.id
                        : (state.sessionId ?? undefined),
                  }}
                  removeLabel={`移除文件引用 ${ref.id}`}
                  disabled={disabled || locked}
                  onRemove={() =>
                    editor.patch({
                      file_refs: draft.file_refs.filter((item) => item !== ref),
                    })
                  }
                />
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label="消息内容"
            rows={2}
            className="agent-composer-input resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            placeholder={placeholder}
            value={value}
            disabled={disabled || locked}
            onChange={(event) => {
              editor.patch({ text: event.target.value });
            }}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                addFiles(event.clipboardData.files, "mixed");
              }
            }}
            onKeyDown={(event) => {
              if (
                (!event.shiftKey || event.ctrlKey || event.metaKey) &&
                event.key === "Enter" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
          />

          <div className="agent-composer-footer">
            <div className="agent-composer-tools">
              <input
                ref={imagePicker}
                type="file"
                multiple
                className="hidden"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                aria-label="选择图片"
                onChange={(event) => {
                  addFiles(event.target.files, "image");
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="agent-composer-tool-button agent-composer-picker"
                aria-label="添加消息图片"
                title={canUseImages ? "添加消息图片" : "当前模型不支持图片输入"}
                disabled={disabled || locked || !caps.data || !canUseImages}
                onClick={() => imagePicker.current?.click()}
              >
                <ImageIcon aria-hidden="true" />
              </button>
              <input
                ref={attachmentPicker}
                type="file"
                multiple
                className="hidden"
                aria-label="选择工作区文件"
                onChange={(event) => {
                  addFiles(event.target.files, "workspace");
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="agent-composer-tool-button agent-composer-picker"
                aria-label="上传文件到工作区"
                title="上传文件到工作区"
                disabled={disabled || locked || !caps.data}
                onClick={() => attachmentPicker.current?.click()}
              >
                <Upload aria-hidden="true" />
              </button>
              {hasDraft && (
                <button
                  type="button"
                  className="agent-composer-tool-button"
                  title="清空草稿"
                  disabled={locked}
                  onClick={() => setDiscard(true)}
                >
                  <X className="size-4" />
                  <span className="sr-only">清空草稿</span>
                </button>
              )}
              {footerLeading && (
                <span className="agent-composer-hint">{footerLeading}</span>
              )}
            </div>
            {settings && (
              <div className="agent-composer-settings">{settings}</div>
            )}
            <div className="agent-composer-actions">
              {primaryAction}
              <button
                type="button"
                className="agent-send-button"
                aria-label={
                  pending ? sendingLabel : running ? "发送到下一轮" : sendLabel
                }
                title={
                  pending ? sendingLabel : running ? "发送到下一轮" : sendLabel
                }
                aria-busy={pending}
                disabled={sendDisabled}
                onClick={send}
              >
                {pending ? (
                  <LoaderCircle className="agent-send-pending" />
                ) : (
                  <ArrowUp />
                )}
              </button>
            </div>
          </div>
        </div>
        {textBytes > textLimit && (
          <ErrorNotice
            error={`消息超过 ${textLimit.toLocaleString()} 字节上限，请缩短正文或改用工作区文件。`}
          />
        )}
        <ConfirmDialog
          open={discard}
          title={locked ? "结束本次提交？" : "清空当前草稿？"}
          description={
            locked
              ? "保留正文和文件。若已经创建会话，将进入该会话继续编辑。已保存的工作区文件留在云电脑。"
              : "将移除当前尚未发送的正文与文件选择。"
          }
          danger
          confirmLabel={locked ? "返回编辑" : "清空草稿"}
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            if (locked) {
              const remaining = flow.remainingDraft();
              const sessionId = state.sessionId;
              const created = state.plan && "create" in state.plan.session;
              if (sessionId && created && onOpenSession) {
                runtime.drafts.get(`session:${sessionId}`).patch(remaining);
                editor.clearContent();
                release();
                flow.reset();
                onOpenSession(sessionId);
              } else {
                editor.patch(remaining);
                flow.reset();
              }
            } else editor.clearContent();
            setDiscard(false);
          }}
        />
      </div>
    </div>
  );
}

function isImage(file: File) {
  return (
    /^image\/(png|jpeg|webp)$/.test(file.type) ||
    (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name))
  );
}
