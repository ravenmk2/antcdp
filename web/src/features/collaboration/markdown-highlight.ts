import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const languages = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mermaid: () => import("shiki/langs/mermaid.mjs"),
};
const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  py: "python",
  golang: "go",
  md: "markdown",
  ps1: "powershell",
  docker: "dockerfile",
};
const highlighter = createHighlighterCore({
  themes: [
    import("shiki/themes/github-light.mjs"),
    import("shiki/themes/github-dark.mjs"),
  ],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
export async function highlight(source: string, language: string) {
  const name = aliases[language.toLowerCase()] || language.toLowerCase();
  if (!(name in languages) || source.length > 102400) return "";
  const h = await highlighter;
  await h.loadLanguage(languages[name as keyof typeof languages]);
  return h.codeToHtml(source, {
    lang: name,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
