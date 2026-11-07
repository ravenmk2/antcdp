import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "./button";
import { StandaloneInput } from "./fields";
import { Modal } from "./overlays";
import { Avatar } from "./resource-icon";

export interface SelectableUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
}
interface Props {
  value: SelectableUser[];
  onChange: (users: SelectableUser[]) => void;
  loadOptions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<SelectableUser[]>;
  sourceKey: string;
  multiple?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  label: string;
  name: string;
  error?: string;
  resultLimit?: number;
}
function UserIdentity({ user }: { user: SelectableUser }) {
  return (
    <>
      <Avatar
        name={user.display_name}
        url={user.avatar_url}
        className="size-8"
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm">{user.display_name}</span>
        <span className="block break-all text-xs text-muted">
          @{user.username}
        </span>
      </span>
    </>
  );
}
export function UserPicker(props: Props) {
  const { value, onChange, disabled, label, name, error, min = 0 } = props;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const message =
    error || (value.length < min ? `请至少选择 ${min} 位用户` : "");
  return (
    <div className="grid gap-2">
      <span id={`${name}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {value.slice(0, 3).map((user) => (
          <span
            key={user.id}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-surface-subtle py-1 pl-1 pr-2"
          >
            <Avatar
              name={user.display_name}
              url={user.avatar_url}
              className="size-6"
            />
            <span
              className="max-w-40 truncate text-sm"
              title={`${user.display_name} @${user.username}`}
            >
              {user.display_name}
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              disabled={disabled}
              aria-label={`移除 ${user.display_name}`}
              onClick={() =>
                onChange(value.filter((item) => item.id !== user.id))
              }
            >
              <X />
            </Button>
          </span>
        ))}
        {value.length > 3 && (
          <Button
            variant="link"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            另 {value.length - 3} 人
          </Button>
        )}
        <Button
          ref={trigger}
          name={name}
          variant="outline"
          disabled={disabled}
          aria-labelledby={`${name}-label ${name}-action`}
          aria-describedby={message ? `${name}-error` : undefined}
          aria-invalid={!!message}
          onClick={() => setOpen(true)}
        >
          <span id={`${name}-action`}>
            {value.length ? "修改选择" : "选择用户"}
          </span>
        </Button>
        <span className="text-xs text-muted">已选择 {value.length} 人</span>
      </div>
      {message && (
        <p id={`${name}-error`} className="text-xs text-danger" role="alert">
          {message}
        </p>
      )}
      {open && (
        <PickerDialog
          {...props}
          restoreFocusTo={trigger.current}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
function PickerDialog({
  value,
  onChange,
  loadOptions,
  sourceKey,
  multiple = false,
  min = 0,
  max = 100,
  label,
  resultLimit,
  onClose,
  restoreFocusTo,
}: Props & { onClose: () => void; restoreFocusTo: HTMLElement | null }) {
  const [draft, setDraft] = useState(value);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input, composing]);
  const options = useQuery({
    queryKey: ["user-picker", sourceKey, query],
    queryFn: ({ signal }) => loadOptions(query, signal),
    retry: false,
  });
  const users = options.data ?? [];
  const waiting = composing || query !== input.trim() || options.isFetching;
  const capped = resultLimit !== undefined && users.length >= resultLimit;
  const invalid = draft.length < min || draft.length > max;
  function choose(user: SelectableUser) {
    setNotice("");
    if (!multiple) {
      setDraft([user]);
      return;
    }
    if (draft.some((item) => item.id === user.id))
      setDraft(draft.filter((item) => item.id !== user.id));
    else if (draft.length >= max)
      setNotice(`最多选择 ${max} 位用户，请先移除部分已选人员。`);
    else setDraft([...draft, user]);
  }
  function selectAll() {
    const merged = [
      ...draft,
      ...users.filter((user) => !draft.some((item) => item.id === user.id)),
    ];
    if (merged.length > max) {
      setNotice(`最多选择 ${max} 位用户，请缩小搜索范围或移除部分已选人员。`);
      return;
    }
    setNotice("");
    setDraft(merged);
  }
  return (
    <Modal
      open
      title={`选择${label}`}
      description={
        multiple
          ? "搜索并勾选用户，在右侧核对后确定。"
          : "选择一位用户，核对后确定。"
      }
      wide={multiple}
      onClose={onClose}
      restoreFocusTo={restoreFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={invalid}
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            确定{multiple ? `（${draft.length}）` : ""}
          </Button>
        </>
      }
    >
      <div
        className={
          multiple
            ? "grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4"
            : "grid"
        }
      >
        <section className="min-w-0" aria-label="候选用户">
          <StandaloneInput
            autoFocus
            aria-label="搜索用户"
            placeholder="搜索姓名或账号"
            value={input}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!event.nativeEvent.isComposing && !composing)
                  setQuery(input.trim());
              }
            }}
          />
          <div className="flex h-11 items-center justify-between gap-2 text-xs text-muted">
            <span aria-live="polite">
              {waiting
                ? "搜索中…"
                : options.isError
                  ? "加载失败"
                  : `当前结果 ${users.length} 人`}
            </span>
            {multiple && (
              <Button
                size="sm"
                variant="ghost"
                disabled={waiting || options.isError || !users.length || capped}
                onClick={selectAll}
              >
                全选当前结果（{users.length}）
              </Button>
            )}
          </div>
          <div
            className="h-80 overflow-y-auto rounded-lg border"
            aria-busy={waiting}
          >
            {waiting ? (
              <p className="p-4 text-sm text-muted" role="status">
                正在加载用户…
              </p>
            ) : options.isError ? (
              <div className="p-4 text-sm">
                <p role="alert">用户加载失败，请重试。</p>
                <Button
                  variant="outline"
                  className="mt-2"
                  onClick={() => void options.refetch()}
                >
                  重试
                </Button>
              </div>
            ) : !users.length ? (
              <p className="p-4 text-sm text-muted">
                {query
                  ? "没有匹配的用户，请尝试其他姓名或账号。"
                  : "没有可选用户。"}
              </p>
            ) : (
              users.map((user) => {
                const checked = draft.some((item) => item.id === user.id);
                return (
                  <label
                    key={user.id}
                    className={`flex cursor-pointer items-center gap-2 border-b p-3 last:border-0 hover:bg-surface-hover ${checked ? "bg-accent-soft" : ""}`}
                  >
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name="picker-candidate"
                      className="shrink-0 accent-primary"
                      checked={checked}
                      onChange={() => choose(user)}
                    />
                    <UserIdentity user={user} />
                  </label>
                );
              })
            )}
          </div>
          {resultLimit && (
            <p className="mt-2 text-xs text-muted">
              每次最多返回 {resultLimit} 位候选，请搜索定位更多用户。
              {capped && "结果可能未完整展示，请缩小搜索范围后全选。"}
            </p>
          )}
        </section>
        {multiple && (
          <section className="flex min-w-0 flex-col" aria-label="已选用户">
            <div className="flex h-[83px] shrink-0 items-center justify-between gap-1">
              <span className="text-sm font-medium" aria-live="polite">
                已选 {draft.length} 人
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!draft.length}
                onClick={() => {
                  setDraft([]);
                  setNotice("");
                }}
              >
                清空已选
              </Button>
            </div>
            <div className="h-80 overflow-y-auto rounded-lg border">
              {draft.length ? (
                draft.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-2 border-b p-3 last:border-0"
                  >
                    <UserIdentity user={user} />
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`移除 ${user.display_name}`}
                      onClick={() => {
                        setDraft(draft.filter((item) => item.id !== user.id));
                        setNotice("");
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-muted">从左侧选择用户</p>
              )}
            </div>
          </section>
        )}
      </div>
      {(notice || invalid) && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {notice || `请至少选择 ${min} 位用户`}
        </p>
      )}
    </Modal>
  );
}
