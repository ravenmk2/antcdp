import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import { IconButton } from "./button";
import { StandaloneInput } from "./fields";

export function MarkdownSearchPanel({
  view,
  query,
  state,
}: {
  view: EditorView;
  query: SearchQuery;
  state: EditorState;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const input = root.current?.querySelector<HTMLInputElement>("[main-field]");
    input?.focus();
    input?.select();
  }, []);
  const matches = useMemo(() => {
    if (!query.valid) return { total: 0, current: 0, capped: false };
    const cursor = query.getCursor(state);
    let total = 0,
      current = 0;
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      total++;
      if (
        next.value.from === state.selection.main.from &&
        next.value.to === state.selection.main.to
      )
        current = total;
      if (total === 10000) return { total, current, capped: true };
    }
    return { total, current, capped: false };
    // CodeMirror changes selection/document independently of React.
  }, [query, state]);
  function change(
    patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>,
  ) {
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ ...query, ...patch })),
    });
  }
  const invalid = Boolean(query.search && !query.valid);
  const canReplace = query.valid && matches.total > 0 && !state.readOnly;
  return (
    <div
      ref={root}
      className="markdown-search-panel"
      role="search"
      aria-label="查找与替换"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeSearchPanel(view);
          view.focus();
        }
      }}
    >
      <div className="markdown-search-row">
        <IconButton
          label={expanded ? "收起替换" : "展开替换"}
          size="iconSm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </IconButton>
        <div className="markdown-search-field">
          <StandaloneInput
            main-field="true"
            aria-label="查找内容"
            placeholder="查找"
            value={query.search}
            aria-invalid={invalid}
            onChange={(event) => change({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                (event.shiftKey ? findPrevious : findNext)(view);
              }
            }}
          />
          <div className="markdown-search-options">
            {(
              [
                { key: "caseSensitive", label: "区分大小写", text: "Aa" },
                { key: "wholeWord", label: "全词匹配", text: "ab" },
                { key: "regexp", label: "正则表达式", text: ".*" },
              ] as const
            ).map((option) => (
              <IconButton
                key={option.key}
                label={option.label}
                size="iconSm"
                aria-pressed={query[option.key]}
                className={
                  query[option.key] ? "bg-accent-soft text-primary" : undefined
                }
                onClick={() => change({ [option.key]: !query[option.key] })}
              >
                <span
                  className={
                    option.key === "wholeWord"
                      ? "font-mono underline"
                      : "font-mono"
                  }
                >
                  {option.text}
                </span>
              </IconButton>
            ))}
          </div>
        </div>
        <span
          className="markdown-search-count"
          role="status"
          aria-live="polite"
        >
          {invalid
            ? "无效正则"
            : !query.search
              ? "输入关键词"
              : !matches.total
                ? "无结果"
                : `${matches.current || "—"} / ${matches.total}${matches.capped ? "+" : ""}`}
        </span>
        <div className="markdown-search-actions">
          <IconButton
            label="上一个匹配"
            size="iconSm"
            disabled={!query.valid || !matches.total}
            onClick={() => findPrevious(view)}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label="下一个匹配"
            size="iconSm"
            disabled={!query.valid || !matches.total}
            onClick={() => findNext(view)}
          >
            <ArrowDown />
          </IconButton>
          <IconButton
            label="关闭查找"
            size="iconSm"
            onClick={() => {
              closeSearchPanel(view);
              view.focus();
            }}
          >
            <X />
          </IconButton>
        </div>
      </div>
      {expanded && (
        <div className="markdown-search-row">
          <span />
          <StandaloneInput
            aria-label="替换内容"
            placeholder="替换"
            value={query.replace}
            disabled={state.readOnly}
            onChange={(event) => change({ replace: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (canReplace) replaceNext(view);
              }
            }}
          />
          <span />
          <div className="markdown-search-actions">
            <IconButton
              label="替换当前匹配"
              size="iconSm"
              disabled={!canReplace}
              onClick={() => replaceNext(view)}
            >
              <Replace />
            </IconButton>
            <IconButton
              label="全部替换"
              size="iconSm"
              disabled={!canReplace}
              onClick={() => replaceAll(view)}
            >
              <ReplaceAll />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
