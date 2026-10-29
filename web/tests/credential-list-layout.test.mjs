import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { createSSRApp, h } from 'vue';
import { compile } from '@vue/compiler-dom';
import ts from 'typescript';
import { renderToString } from '@vue/server-renderer';

const { descriptor } = parse(readFileSync(new URL('../src/features/integrations/CredentialsPanel.vue', import.meta.url), 'utf8'));
const { code } = compile(descriptor.template.content, { mode: 'function', expressionPlugins: ['typescript'] });
const render = new Function('Vue', ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(Vue);
render._rc = true;
const row = { id: '1', name: 'Test credential', code: 'test-credential', identity_config: {}, description: '', expires_at: null, is_preferred: false };
async function renderState(overrides = {}) {
  const values = { readonly: false, busy: false, loading: false, error: '', collection: 'v1', search: '', stateFilter: '', stateLabels: { available: '可用' }, rows: [], visibleRows: [], diagnostics: {}, fallbackID: null, system: true, connectionEnabled: true, dialog: false, mode: 'create', clearSecret() {}, open() {}, load() {}, last() {}, menuAction() {}, stateOf: () => 'available', available: () => true, ...overrides };
  const app = createSSRApp({ data: () => values, render });
  const passthrough = { setup: (_, { slots }) => () => h('span', slots.default?.()) };
  for (const name of ['ElTabs', 'ElTabPane', 'ElSwitch', 'ProviderFields', 'ElInput', 'ElSelect', 'ElOption', 'ElButton', 'UiIcon', 'ConnectionCode', 'ClearFiltersButton', 'ElDropdown', 'ElDropdownMenu', 'ElDropdownItem']) app.component(name, passthrough);
  app.component('ElDialog', { render: () => null });
  app.config.warnHandler = message => { throw new Error(message); };
  return renderToString(app);
}
for (const [name, state, text] of [
  ['empty', {}, '尚未添加凭证'],
  ['loading with stale rows', { loading: true, rows: [row], visibleRows: [row] }, '正在加载凭证'],
  ['failed with stale rows', { error: '加载失败', rows: [row], visibleRows: [row] }, '加载失败'],
  ['filtered empty', { rows: [row] }, '没有匹配的凭证'],
]) {
  test(`credential ${name} stays below toolbar and does not render a table`, async () => {
    const html = await renderState(state);
    assert.ok(html.indexOf('credential-filters') < html.indexOf('credential-list-content'));
    assert.ok(html.indexOf('credential-list-content') < html.indexOf(text));
    assert.ok(!html.includes('<table'));
    if (state.loading || state.error) assert.ok(!html.includes('table-footer'));
    else assert.ok(html.indexOf(text) < html.indexOf('table-footer'));
  });
}
test('populated credentials use the same content region between toolbar and footer', async () => {
  const html = await renderState({ rows: [row], visibleRows: [row] });
  assert.ok(html.indexOf('credential-filters') < html.indexOf('credential-list-content'));
  assert.ok(html.indexOf('credential-list-content') < html.indexOf('<table'));
  assert.ok(html.indexOf('</table>') < html.indexOf('table-footer'));
  assert.ok(!html.includes('credential-list-state'));
});
