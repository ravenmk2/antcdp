import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from '@vue/compiler-sfc';
import postcss from 'postcss';
import ts from 'typescript';

const src = fileURLToPath(new URL('../src/', import.meta.url));

// Follow only static local dependencies: a cold account route must not borrow
// styles from another lazy route. Scoped styles cannot affect the account page.
function routeStyles(...pages) {
  const seen = new Set();
  const css = postcss.root();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.css')) {
      const root = postcss.parse(source);
      root.walkAtRules('import', rule => {
        const target = rule.params.match(/^["'](.+?)["']/)?.[1];
        assert.ok(target?.startsWith('.'), `Unsupported CSS import: ${rule.params}`);
        visit(path.resolve(path.dirname(file), target));
        rule.remove();
      });
      css.append(root.nodes);
      return;
    }
    const component = file.endsWith('.vue') ? parse(source).descriptor : null;
    const script = component
      ? [component.script?.content, component.scriptSetup?.content].filter(Boolean).join('\n')
      : source;
    const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const target = statement.moduleSpecifier.text;
      if (!target.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), target);
      const resolved = [base, base + '.ts', base + '/index.ts'].find(candidate => existsSync(candidate));
      assert.ok(resolved, `Missing import: ${target}`);
      visit(resolved);
    }
    for (const style of component?.styles ?? []) {
      if (!style.scoped) css.append(postcss.parse(style.content).nodes);
    }
  }
  for (const file of ['main.ts', ...pages]) visit(path.join(src, file));
  return css;
}

// Inspect the exact layout selectors at each media breakpoint. This checks CSS
// availability and declaration order, not browser geometry or pixel rendering.
function declarations(css, selector, width) {
  const result = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule') continue;
      assert.equal(parent.name, 'media');
      for (const [, bound, limit] of parent.params.matchAll(/(max|min)-width:\s*(\d+)px/g)) {
        if (bound === 'max' ? width > +limit : width < +limit) return;
      }
    }
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

const account = 'features/identity/AccountPage.vue';
const settings = 'features/admin/SettingsPage.vue';
const widths = [375, 600, 601, 850, 851, 1150, 1151, 1440];

test('direct account/profile and security entry loads content spacing and form actions', () => {
  const css = routeStyles(account);
  for (const width of widths) {
    const at = selector => declarations(css, selector, width);
    assert.equal(at('.settings-body').padding, width <= 600 ? '23px 19px' : '25px 28px', `content at ${width}px`);
    assert.equal(at('.settings-body .el-form-item')['max-width'], '550px');
    assert.equal(at('.settings-body > .field-help:last-child')['margin-bottom'], '0');
    const footer = at('.settings-save');
    assert.equal(footer.display, 'flex');
    assert.equal(footer.padding, width <= 600 ? '17px 19px' : '17px 28px');
    assert.equal(footer['align-items'], width <= 600 ? 'flex-start' : 'center');
    assert.equal(footer['justify-content'], 'space-between');
    assert.equal(footer.background, 'var(--surface-subtle)');
    assert.equal(footer.color, 'var(--text-muted)');
    assert.equal(footer.gap, '16px');
    assert.equal(at('.profile-layout')['grid-template-columns'], width <= 850 ? '1fr' : width <= 1150 ? '220px minmax(0, 1fr)' : '250px minmax(0, 1fr)');
    assert.equal(at('.security-row').display, 'flex');
  }
});

test('visiting system settings before or after account does not change account layout', () => {
  const cold = routeStyles(account);
  for (const order of [[settings, account], [account, settings]]) {
    const visited = routeStyles(...order);
    for (const width of widths) {
      for (const selector of ['.settings-body', '.settings-body .el-form-item', '.settings-body > .field-help:last-child', '.settings-save', '.settings-save > span', '.profile-layout', '.security-row']) {
        assert.deepEqual(declarations(visited, selector, width), declarations(cold, selector, width), `${selector} at ${width}px after ${order.join(', ')}`);
      }
    }
  }
});
