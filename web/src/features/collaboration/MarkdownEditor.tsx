import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

type Props = {
  id: string;
  value: string;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid": boolean;
  onChange: (value: string) => void;
};
const colors = HighlightStyle.define([
  { tag: tags.heading, color: "var(--md-heading)", fontWeight: "600" },
  {
    tag: [tags.keyword, tags.modifier, tags.operator],
    color: "var(--md-keyword)",
  },
  { tag: [tags.string, tags.url, tags.link], color: "var(--md-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--md-number)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted-foreground)" },
  {
    tag: [tags.function(tags.variableName), tags.typeName, tags.tagName],
    color: "var(--md-function)",
  },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);
export function MarkdownEditor(props: Props) {
  const {
    id,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const latest = useRef(props);
  const config = useRef(new Compartment());
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(colors),
          config.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: config.current.reconfigure([
        EditorState.readOnly.of(!!disabled),
        EditorView.editable.of(!disabled),
        EditorView.contentAttributes.of({
          id: id,
          "aria-label": "Markdown 正文",
          "aria-multiline": "true",
          "aria-invalid": String(invalid),
          "aria-disabled": String(!!disabled),
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
        }),
      ]),
    });
  }, [disabled, id, describedBy, invalid]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: props.value },
      });
  }, [props.value]);
  return <div className="markdown-source-editor" ref={host} />;
}
