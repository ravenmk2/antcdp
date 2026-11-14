import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUp, FileText, Paperclip, X, LoaderCircle } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import type {
  CapabilityCatalog,
  InputAccepted,
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
  disabled,
  placeholder = "描述你希望完成的任务…",
  children,
  onAccepted,
  onOpenSession,
  queuePaused = false,
  running = false,
  variant = "conversation",
  footerLeading,
  primaryAction,
  sendLabel = "发送",
  settings,
}: {
  id: string;
  target: SendPlan["session"] | null;
  disabled?: boolean;
  placeholder?: string;
  children?: ReactNode;
  onAccepted: (sessionId: string, result: InputAccepted) => void;
  onOpenSession?: (sessionId: string) => void;
  queuePaused?: boolean;
  running?: boolean;
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
    fileInput = useRef<HTMLInputElement>(null);
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
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 260)}px`;
  }, [value]);
  useEffect(() => {
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
    if (
      !target ||
      disabled ||
      locked ||
      textBytes > textLimit ||
      (!draft.text.trim() && !draft.files.length && !draft.file_refs.length)
    )
      return;
    setError(undefined);
    void flow.start({
      session: target,
      text: draft.text,
      files: draft.files,
      file_refs: draft.file_refs,
    });
  };
  const textBytes = new TextEncoder().encode(draft.text).byteLength,
    textLimit = caps.data?.data.limits.input_text_bytes ?? 65536;
  function addFiles(files: FileList | null) {
    if (!files || !caps.data || disabled || locked) return;
    const added = Array.from(files),
      limits = caps.data.data.limits;
    if (
      draft.files.length + draft.file_refs.length + added.length >
      limits.input_file_refs
    ) {
      setError(`每次最多 ${limits.input_file_refs} 个文件引用。`);
      return;
    }
    if (added.some((file) => file.size > limits.attachment_file_bytes)) {
      setError(
        `单个附件不能超过 ${limits.attachment_file_bytes.toLocaleString()} 字节。`,
      );
      return;
    }
    editor.patch({ files: [...draft.files, ...added] });
    setError(undefined);
  }
  return (
    <div className="agent-composer" data-variant={variant}>
      <div className="space-y-3">
        <div className="agent-composer-feedback space-y-3">
          <ErrorNotice error={error} />
          <ErrorNotice error={state.receiptMissing ? undefined : state.error} />
          {pending && (
            <Notice>
              {state.stage === "session"
                ? "正在建立会话…"
                : state.stage === "upload"
                  ? `正在上传附件 ${state.uploadIndex + 1} / ${state.plan?.files.length ?? 0}…`
                  : "正在受理消息…"}
              尚未确认受理前保留正文与文件。
            </Notice>
          )}
          {uncertain && (
            <Notice tone="warning" title="发送结果尚未确认">
              {state.receiptMissing
                ? "暂未查到回执，不代表原操作没有执行。"
                : "原步骤和请求键仍保留，不会重新创建会话或重复上传已经确认的附件。"}
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => void flow.recover("receipt")}
                >
                  查询原步骤结果
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void flow.recover("retry")}
                >
                  重试原步骤
                </Button>
              </div>
            </Notice>
          )}
          {state.phase === "failed" && (
            <Notice tone="warning">
              {state.sessionId
                ? "会话已建立，正文与已上传附件仍保留。"
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
            addFiles(event.dataTransfer.files);
          }}
        >
          {children && <div className="agent-composer-config">{children}</div>}
          {(draft.files.length > 0 || draft.file_refs.length > 0) && (
            <div className="agent-composer-attachments" aria-label="待发送文件">
              {draft.files.map((file, index) => (
                <div
                  key={`${file.name}:${index}`}
                  className={`agent-composer-attachment ${isImage(file) ? "is-image" : ""}`}
                  title={file.name}
                >
                  <AttachmentPreview file={file} />
                  <span
                    className="agent-attachment-name min-w-0 truncate text-xs"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <button
                    type="button"
                    className="agent-attachment-remove"
                    aria-label={`移除附件 ${file.name}`}
                    disabled={disabled || locked}
                    onClick={() =>
                      editor.patch({
                        files: draft.files.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <X />
                  </button>
                </div>
              ))}
              {draft.file_refs.map((ref) => (
                <div
                  className="agent-composer-attachment text-xs"
                  key={`${ref.kind}:${ref.id}`}
                >
                  <span>
                    {ref.kind === "artifact" ? "已有成果" : "已有附件"} {ref.id}
                  </span>
                  <IconButton
                    size="iconSm"
                    label={`移除文件引用 ${ref.id}`}
                    disabled={disabled || locked}
                    onClick={() =>
                      editor.patch({
                        file_refs: draft.file_refs.filter(
                          (item) => item !== ref,
                        ),
                      })
                    }
                  >
                    <X />
                  </IconButton>
                </div>
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
            onChange={(event) => editor.patch({ text: event.target.value })}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                addFiles(event.clipboardData.files);
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
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                aria-label="上传附件"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="agent-composer-tool-button"
                aria-label="添加附件"
                title="添加附件"
                disabled={disabled || locked || !caps.data}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip />
              </button>
              {(draft.text ||
                draft.files.length > 0 ||
                draft.file_refs.length > 0) && (
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
                aria-label={running ? "发送到下一轮" : sendLabel}
                title={running ? "发送到下一轮" : sendLabel}
                aria-busy={pending}
                disabled={
                  disabled ||
                  locked ||
                  !target ||
                  textBytes > textLimit ||
                  (!draft.text.trim() &&
                    !draft.files.length &&
                    !draft.file_refs.length)
                }
                onClick={send}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <ArrowUp />
                )}
              </button>
            </div>
          </div>
        </div>
        {textBytes > textLimit && (
          <ErrorNotice
            error={`消息超过 ${textLimit.toLocaleString()} 字节上限，请缩短正文或改用附件。`}
          />
        )}
        <ConfirmDialog
          open={discard}
          title={locked ? "结束本次提交？" : "清空当前草稿？"}
          description={
            locked
              ? "保留正文和文件。若已经创建会话，将进入该会话继续编辑；已确认上传的附件继续使用原引用。"
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
  return /^image\/(png|jpeg|webp|gif)$/.test(file.type);
}

function AttachmentPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  const previewable = isImage(file);
  useEffect(() => {
    if (!previewable || !image.current) return;
    const url = URL.createObjectURL(file);
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, previewable]);
  return previewable ? (
    <img ref={image} alt={file.name} className="agent-attachment-image" />
  ) : (
    <FileText className="size-5 shrink-0 text-muted" />
  );
}
