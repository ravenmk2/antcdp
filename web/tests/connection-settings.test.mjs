import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/features/integrations/HTTPConnectionSettings.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
function controller(type, fail = false) {
 const calls = [];
 const props = { base: '/connection', etag: 'v1', connection: { name: 'Saved', description: 'Description', enabled: true, service_type: type, config: ['mysql','postgresql'].includes(type) ? { host: 'db.example.com', port: 5432, database: 'app', tls_mode: 'disable' } : { base_url: 'https://example.com', ...(type === 'openobserve' ? { default_organization: 'default' } : {}) } } };
 const context = { exports: {}, defineProps: () => props, defineEmits: () => (_, data, etag) => { props.connection = data; props.etag = etag; }, require(name) {
  if (name === 'vue') return { ref: value => ({ value }), reactive: v => v, computed: fn => ({ get value() { return fn(); } }), watch: (source, fn, options) => { if (options?.immediate) fn(); } };
  if (name === './unsaved') return { useUnsaved() {} };
  if (name === './types') return { message: e => e.message };
  if (name === 'element-plus') return { ElMessage: { success() {} }, ElMessageBox: { confirm: async () => {} } };
  if (name === '../../shared/api') return { request: async (path, options) => { if (!options) return { data: { latest: null } }; calls.push(options); if (fail) throw new Error('Conflict'); return { data: { ...props.connection, ...options.body }, etag: 'v2' }; } };
  return {};
 } };
 vm.runInNewContext(ts.transpileModule(source + '\nexports.c = { editing, dirty, form, error, startEditing, cancelEditing, save };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
 return { c: context.exports.c, calls, props };
}
for (const type of ['gitlab','jenkins','openobserve','elasticsearch','mysql','postgresql']) {
 test(`${type}: view, cancel and save preserve connection semantics`, async () => {
  const { c, calls, props } = controller(type);
  assert.equal(c.editing.value, false); assert.equal(c.dirty.value, false);
  c.startEditing(); assert.equal(c.dirty.value, false);
  c.form.name = 'Discard'; c.cancelEditing(); assert.equal(c.form.name, 'Saved'); assert.equal(c.editing.value, false); assert.equal(calls.length, 0);
  c.startEditing(); c.form.name = 'Updated'; await c.save();
  assert.equal(c.editing.value, false); assert.equal(props.connection.name, 'Updated'); assert.equal(calls[0].etag, 'v1');
  assert.equal(calls[0].body.config.host ?? calls[0].body.config.base_url, ['mysql','postgresql'].includes(type) ? 'db.example.com' : 'https://example.com');
 });
}
test('failed save retains editable draft and exposes error', async () => {
 const { c } = controller('gitlab', true); c.startEditing(); c.form.name = 'Draft'; await c.save();
 assert.equal(c.editing.value, true); assert.equal(c.form.name, 'Draft'); assert.equal(c.error.value, 'Conflict');
});
