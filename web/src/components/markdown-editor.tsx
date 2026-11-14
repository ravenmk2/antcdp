import { useEffect, useRef, useState, type ReactNode } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
  getSearchQuery,
} from "@codemirror/search";
import { createPortal } from "react-dom";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { MarkdownSearchPanel } from "./markdown-search-panel";
import { useMarkdownScrollSync } from "@/hooks/use-markdown-scroll-sync";
import { Search } from "lucide-react";
import { IconButton } from "./button";
import { MarkdownView } from "./markdown";

export function MarkdownEditor({
  initial,
  onChange,
  onDirty,
  workspace = false,
  disabled = false,
  onSave,
  toolbarStart,
  toolbarEnd,
  notices,
}: {
  initial: string;
  onChange: (value: string) => void;
  onDirty?: (dirty: boolean) => void;
  workspace?: boolean;
  disabled?: boolean;
  onSave?: () => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  notices?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const initialRef = useRef(initial);
  const callbacks = useRef({ onChange, onDirty, onSave });
  callbacks.current = { onChange, onDirty, onSave };
  const [mode, setMode] = useState<"edit" | "preview" | "split">(
    workspace ? "split" : "edit",
  );
  const [source, setSource] = useState(initial);
  const [preview, setPreview] = useState(initial);
  const [ratio, setRatio] = useState(50);
  const panes = useRef<HTMLDivElement>(null);
  const previewScroll = useRef<HTMLDivElement>(null);
  const [searchPanel, setSearchPanel] = useState<{
    dom: HTMLElement;
    view: EditorView;
  } | null>(null);
  const [, setSearchRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setPreview(source), 250);
    return () => clearTimeout(timer);
  }, [source]);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          foldGutter({
            markerDOM: (open) => {
              const marker = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
              );
              marker.setAttribute("class", "markdown-fold-marker");
              marker.setAttribute("viewBox", "0 0 24 24");
              marker.setAttribute("fill", "none");
              marker.setAttribute("stroke", "currentColor");
              marker.setAttribute("stroke-width", "1.5");
              marker.setAttribute("stroke-linecap", "round");
              marker.setAttribute("stroke-linejoin", "round");
              marker.setAttribute("aria-hidden", "true");
              const path = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path",
              );
              path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
              marker.append(path);
              const container = document.createElement("span");
              container.append(marker);
              return container;
            },
          }),
          search({
            top: true,
            createPanel: (view) => {
              const dom = document.createElement("div");
              dom.className = "markdown-search-host";
              return {
                dom,
                top: true,
                mount: () => setSearchPanel({ dom, view }),
                update: (update) => {
                  if (
                    update.docChanged ||
                    update.selectionSet ||
                    update.transactions.some(
                      (transaction) => transaction.effects.length,
                    )
                  )
                    setSearchRevision((version) => version + 1);
                },
                destroy: () => setSearchPanel(null),
              };
            },
          }),
          EditorState.phrases.of({
            Find: "查找",
            Replace: "替换",
            next: "下一个",
            previous: "上一个",
            all: "全部",
            "match case": "区分大小写",
            regexp: "正则表达式",
            "by word": "全词匹配",
            replace: "替换",
            "replace all": "全部替换",
            close: "关闭",
            "Go to line": "跳转到行",
            go: "跳转",
            "Fold line": "折叠行",
            "Unfold line": "展开行",
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
          ]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Markdown 源码",
            spellcheck: "false",
          }),
          editable.current.of([
            EditorState.readOnly.of(false),
            EditorView.editable.of(true),
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const value = update.state.doc.toString();
            setSource(value);
            callbacks.current.onChange(value);
            callbacks.current.onDirty?.(value !== initialRef.current);
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              minHeight: "0",
              background: "var(--surface)",
              color: "var(--text)",
              fontFamily: "var(--markdown-body-font)",
              fontSize: "var(--markdown-body-size)",
            },
            ".cm-content": {
              padding: "16px 8px",
              fontFamily: "var(--markdown-body-font)",
              fontSize: "var(--markdown-body-size)",
              lineHeight: "var(--markdown-body-line-height)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--markdown-body-font)",
              lineHeight: "var(--markdown-body-line-height)",
            },
            ".cm-gutters": {
              background: "var(--surface-subtle)",
              color: "var(--muted)",
              borderColor: "var(--border-subtle)",
            },
            ".cm-activeLine, .cm-activeLineGutter": {
              background: "var(--surface-hover)",
            },
            ".cm-cursor": { borderLeftColor: "var(--text)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              background: "var(--accent-soft)",
            },
            ".cm-panels": {
              background: "transparent",
              color: "var(--text)",
            },
            ".cm-panels-top": { borderBottom: "none" },
            ".cm-textfield, .cm-button": {
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);
  const split = mode === "split";
  useMarkdownScrollSync(
    editor,
    previewScroll,
    split && source === preview,
    preview,
  );
  return (
    <div className={`markdown-editor ${workspace ? "is-workspace" : ""}`}>
      <div
        className="markdown-editor-toolbar"
        role="toolbar"
        aria-label="Markdown 编辑工具栏"
      >
        {toolbarStart}
        <ToggleGroup
          value={[mode]}
          onValueChange={([value]) => {
            if (value === "edit" || value === "split" || value === "preview")
              setMode(value);
          }}
          className="markdown-mode-switch"
          variant="default"
          size="default"
          spacing={1}
          aria-label="编辑显示模式"
        >
          <ToggleGroupItem value="edit">编辑</ToggleGroupItem>
          <ToggleGroupItem value="split">分栏</ToggleGroupItem>
          <ToggleGroupItem value="preview">预览</ToggleGroupItem>
        </ToggleGroup>
        {mode !== "preview" && (
          <IconButton
            label="查找与替换"
            size="iconSm"
            aria-pressed={Boolean(searchPanel)}
            aria-expanded={Boolean(searchPanel)}
            variant={searchPanel ? "secondary" : "ghost"}
            className={searchPanel ? "bg-accent-soft text-primary" : undefined}
            onClick={() => {
              if (!editor.current) return;
              if (searchPanel) {
                closeSearchPanel(editor.current);
                editor.current.focus();
              } else openSearchPanel(editor.current);
            }}
          >
            <Search />
          </IconButton>
        )}
        <span
          className={`ml-auto px-2 text-xs tabular-nums ${new TextEncoder().encode(source).length > 102400 ? "text-danger" : "text-muted"}`}
        >
          {new TextEncoder().encode(source).length.toLocaleString()} / 102,400
          字节
        </span>
        {toolbarEnd}
      </div>
      {searchPanel &&
        createPortal(
          <MarkdownSearchPanel
            view={searchPanel.view}
            query={getSearchQuery(searchPanel.view.state)}
            state={searchPanel.view.state}
          />,
          searchPanel.dom,
        )}
      {notices && <div className="markdown-editor-notices">{notices}</div>}
      <div
        ref={panes}
        className={`markdown-editor-panes ${split ? "is-split" : ""}`}
        style={
          split
            ? {
                gridTemplateColumns: `minmax(0, ${ratio}fr) 1px minmax(0, ${100 - ratio}fr)`,
              }
            : undefined
        }
      >
        <div
          ref={host}
          className="markdown-source-pane"
          hidden={mode === "preview"}
        />
        {split && (
          <div
            role="separator"
            aria-label="调整编辑与预览宽度"
            aria-orientation="vertical"
            aria-valuemin={30}
            aria-valuemax={70}
            aria-valuenow={Math.round(ratio)}
            tabIndex={0}
            className="markdown-resizer"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (
                !event.currentTarget.hasPointerCapture(event.pointerId) ||
                !panes.current
              )
                return;
              const rect = panes.current.getBoundingClientRect();
              setRatio(
                Math.max(
                  30,
                  Math.min(
                    70,
                    ((event.clientX - rect.left) / rect.width) * 100,
                  ),
                ),
              );
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
                event.preventDefault();
                setRatio(
                  event.key === "Home"
                    ? 50
                    : Math.max(
                        30,
                        Math.min(
                          70,
                          ratio + (event.key === "ArrowLeft" ? -2 : 2),
                        ),
                      ),
                );
              }
            }}
          />
        )}
        {mode !== "edit" && (
          <div className="markdown-preview-pane">
            <div
              ref={previewScroll}
              data-markdown-scroll
              className="markdown-preview-scroll"
            >
              <MarkdownView source={preview} compact={split} preview />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
