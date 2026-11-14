import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import postcss from "postcss";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(dir, entry.name))
      : [resolve(dir, entry.name)],
  );
}
const sources = files(root);
const areaOf = (file) =>
  relative(root, file)
    .replaceAll("\\", "/")
    .match(/^areas\/(console|workspace|account)\//)?.[1];
const graph = new Map();
for (const file of sources.filter((file) => /\.tsx?$/.test(file))) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies = [];
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const value = specifier.text;
      if (value.startsWith("@/") || value.startsWith(".")) {
        const base = value.startsWith("@/")
          ? resolve(root, value.slice(2))
          : resolve(dirname(file), value);
        const target = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
          .map((suffix) => base + suffix)
          .find(existsSync);
        assert.ok(
          target,
          `Unresolved local import: ${relative(root, file)} -> ${value}`,
        );
        dependencies.push(target);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, dependencies);
}

test("UI areas cannot depend on another area's implementation, including transitive imports", () => {
  function check(file, owner, trail = new Set()) {
    if (trail.has(file)) return;
    trail.add(file);
    for (const dependency of graph.get(file) ?? []) {
      const target = areaOf(dependency);
      assert.ok(
        !target || target === owner,
        `${relative(root, file)} -> ${relative(root, dependency)}`,
      );
      check(dependency, owner, trail);
    }
  }
  for (const file of graph.keys()) {
    const owner = areaOf(file);
    if (
      owner ||
      /^(features|components|hooks|domain|types|lib|api)[/\\]/.test(
        relative(root, file),
      )
    )
      check(file, owner);
  }
});

test("region styles are local modules and console has no user-theme dependency", () => {
  for (const file of sources.filter(
    (file) => areaOf(file) && extname(file) === ".css",
  )) {
    assert.ok(file.endsWith(".module.css"), file);
    const css = postcss.parse(readFileSync(file, "utf8"));
    css.walkRules((rule) => {
      if (
        rule.parent.type === "atrule" &&
        rule.parent.name.endsWith("keyframes")
      )
        return;
      assert.ok(
        rule.selector.includes(".scope"),
        `Unscoped region selector: ${rule.selector}`,
      );
      assert.ok(
        !/(?:^|[\s,(])(?:html|body|:root)(?:[\s,.):]|$)/.test(rule.selector),
        rule.selector,
      );
      assert.ok(
        !rule.selector.includes("[data-area="),
        "Regions must not target other regions",
      );
    });
    if (areaOf(file) === "console")
      assert.ok(!css.toString().includes("member-theme"));
  }
  const global = readFileSync(resolve(root, "styles/app.css"), "utf8");
  assert.ok(
    !/\.(?:app-layout|sidebar|admin-nav|workspace-|agent-chat-page)\b/.test(
      global,
    ),
  );
});
