import { useEffect, useRef } from "react";
import { EditorState, StateEffect } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export function ScriptEditor({
  value,
  onChange,
  label = "JavaScript 脚本",
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  readOnly?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  const changed = useRef(onChange);
  useEffect(() => {
    initial.current = value;
  }, [value]);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!mount.current) return;
    const view = new EditorView({
      parent: mount.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({
            "aria-label": label,
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changed.current(u.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "440px", fontSize: "14px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono, monospace)",
            },
            ".cm-gutters": { backgroundColor: "transparent", color: "#8892a4" },
          }),
        ],
      }),
    });
    let disposed = false;
    void languages
      .find((l) => l.name === "JavaScript")
      ?.load()
      .then((extension) => {
        if (!disposed)
          view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
      });
    return () => {
      disposed = true;
      view.destroy();
    };
  }, [label, readOnly]);
  return (
    <div
      ref={mount}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    />
  );
}
