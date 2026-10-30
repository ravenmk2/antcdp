import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { createSSRApp, h } from 'vue';
import { compile } from '@vue/compiler-dom';
import ts from 'typescript';
import { renderToString } from '@vue/server-renderer';

const { descriptor } = parse(readFileSync(new URL('../src/features/remote-hosts/CredentialsPanel.vue', import.meta.url), 'utf8'));
const { code } = compile(descriptor.template.content, { mode: 'function', expressionPlugins: ['typescript'] });
const render = new Function('Vue', ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(Vue);
render._rc = true;
const row = { id: '1', name: 'Test credential', code: 'test-credential', identity_config: {}, description: '', expires_at: null, is_preferred: false };
async function renderState(overrides = {}) {
  const values = { serviceType:"gitlab", readonly: false, busy: false, loading: false, error: '', collection: 'v1', search: '', stateFilter: '', stateLabels: { available: '可用' }, rows: [], visibleRows: [], diagnostics: {}, fallbackID: null, system: true, connectionEnabled: true, dialog: false, mode: 'create', clearSecret() {}, open() {}, load() {}, last() {}, menuAction() {}, stateOf: () => 'available', available: () => true, ...overrides };
  const app = createSSRApp({ data: () => values, render });
  const passthrough = { setup: (_, { slots }) => () => h('span', slots.default?.()) };
  for (const name of ['DiagnosticResult', 'ElTabs', 'ElTabPane', 'ElSwitch', 'ProviderFields', 'ElInput', 'ElSelect', 'ElOption', 'ElButton', 'UiIcon', 'ConnectionCode', 'ClearFiltersButton', 'ElDropdown', 'ElDropdownMenu', 'ElDropdownItem']) app.component(name, passthrough);
  app.component('ElDialog', { render: () => null });
  app.config.warnHandler = message => { throw new Error(message); };
  return renderToString(app);
}
test('SSH credentials display their authentication method', async () => {
 const credential={...row,auth_method:'ssh_encrypted_key'};
 const html=await renderState({serviceType:'ssh',rows:[credential],visibleRows:[credential]});
 assert.ok(html.includes('带口令私钥'));
});
