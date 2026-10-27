import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  readFileSync(
    new URL("../src/features/collaboration/markdown.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { renderDescription } = await import(
  `data:text/javascript,${encodeURIComponent(source.replace(/(["'])markdown-it\1/, JSON.stringify(import.meta.resolve("markdown-it"))))}`
);
test("Markdown renders structure while blocking executable HTML and unsafe links", () => {
  const result = renderDescription(
    "# 标题\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![tracking](https://example.com/pixel)\n\n**加粗**",
  );
  assert.match(result, /<h1>标题<\/h1>/);
  assert.match(result, /<strong>加粗<\/strong>/);
  assert.ok(!result.includes("<script>"));
  assert.ok(!result.includes('href="javascript:'));
  assert.ok(!result.includes("<img"));
});
