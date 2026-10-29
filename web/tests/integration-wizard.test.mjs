import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual wizard controller with transport and Vue lifecycle isolated.
function wizard(failCredential = false) {
  const source = readFileSync(new URL('../src/features/integrations/IntegrationsPage.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
  const calls = [], routes = [];
  const adapter = { connectionBody: v => ({ ...v }), identityBody: v => ({ username: v.username }), secretBody: v => ({ token: v.token }), secretFields: [{ key: 'token' }], validateSecret: v => v.token ? '' : '请输入 API Token', authMethod: 'jenkins_api_token' };
  const context = { exports: {}, URL, console, require(name) {
    if (name === 'vue') return { ref: value => ({ value }), reactive: v => v, computed: fn => ({ get value() { return fn(); } }), watch() {} };
    if (name === 'vue-router') return { useRoute: () => ({ path: '/admin/integrations', params: {}, query: {} }), useRouter: () => ({ push: v => routes.push(v), replace() {} }) };
    if (name === './providers') return { serviceUI: { jenkins: adapter } };
    if (name === './unsaved') return { useUnsaved() {} };
    if (name === './types') return { message: e => e.message };
    if (name === 'element-plus') return { ElMessage: { success() {}, info() {} }, ElMessageBox: { confirm: async () => {} } };
    if (name === '../../shared/api') return { request: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/credentials')) {
        if (!options) return { etag: 'collection-v1', data: {} };
        if (failCredential) { failCredential = false; throw new Error('凭证保存失败'); }
        return { data: {} };
      }
      return { data: { id: '42', service_type: 'jenkins' } };
    } };
    return {};
  } };
  const code = ts.transpileModule(source + '\nexports.controller = { form, providerValues, credential, credentialValues, createdConnection, step, formError, nextStep, save, items, visible, page, pageSize, pageCount, pagedConnections, readPage, readPageSize, typeFilter, query };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  const c = context.exports.controller;
  Object.assign(c.form, { service_type: 'jenkins', name: 'Test' });
  c.providerValues.value = { base_url: 'https://jenkins.example.com' };
  c.credential.name = 'Robot'; c.credential.code = 'build-bot'; c.credentialValues.value = { username: 'robot', token: 'test-only' };
  return { c, calls, routes };
}
test('wizard validates connection before advancing without making requests', () => {
  const { c, calls } = wizard(); c.step.value = 2; c.providerValues.value.base_url = 'file:///tmp';
  c.nextStep(); assert.equal(c.step.value, 2); assert.ok(c.formError.value); assert.equal(calls.length, 0);
  c.providerValues.value.base_url = 'https://example.com'; c.nextStep(); assert.equal(c.step.value, 3);
});
test('skipping first credential creates only a connection', async () => {
  const { c, calls, routes } = wizard(); await c.save(true);
  assert.equal(calls.length, 1); assert.equal(routes.length, 1); assert.equal(Object.keys(c.credentialValues.value).length, 0);
});
test('first credential uses fresh collection ETag and clears secret after success', async () => {
  const { c, calls } = wizard(); await c.save();
  assert.equal(calls[2].options.body.code, 'build-bot'); assert.equal(calls.length, 3); assert.equal(calls[2].options.etag, 'collection-v1');
  assert.equal(calls[2].options.body.authentication.secret.token, 'test-only');
  assert.equal(Object.keys(c.credentialValues.value).length, 0);
});
test('credential retry keeps created connection and identity, but clears secret', async () => {
  const { c, calls, routes } = wizard(true); await c.save();
  assert.equal(c.createdConnection.value.id, '42'); assert.equal(routes.length, 0);
  assert.equal(c.credentialValues.value.username, 'robot'); assert.equal(c.credentialValues.value.token, '');
  c.credentialValues.value.token = 'retry-test-only'; await c.save();
  assert.equal(calls.filter(c => !c.path.endsWith('/credentials')).length, 1); assert.equal(routes.length, 1);
});

test('invalid credential code prevents connection creation, while explicit skip ignores credential draft', async () => {
  const { c, calls } = wizard(); c.credential.code = 'Invalid Code'; await c.save();
  assert.equal(calls.length, 0); assert.ok(c.formError.value);
  await c.save(true); assert.equal(calls.length, 1);
});

test('connection pagination slices filtered results and supports page sizes', () => {
  const { c } = wizard();
  c.items.value = Array.from({ length: 45 }, (_, i) => ({ id: String(i), name: `Connection ${i}`, code: `conn-${i}`, description: '', service_type: i < 25 ? 'jenkins' : 'gitlab', enabled: true }));
  assert.equal(c.pageCount.value, 3); assert.equal(c.pagedConnections.value.length, 20);
  c.page.value = 3; assert.equal(c.pagedConnections.value.length, 5);
  c.typeFilter.value = 'gitlab'; c.page.value = 1;
  assert.equal(c.visible.value.length, 20); assert.equal(c.pagedConnections.value[0].id, '25');
  c.pageSize.value = 10; assert.equal(c.pageCount.value, 2);
  c.query.value = 'conn-44'; assert.equal(c.pagedConnections.value.length, 1);
  assert.equal(c.readPage('-2'), 1); assert.equal(c.readPageSize('999'), 20);
});
