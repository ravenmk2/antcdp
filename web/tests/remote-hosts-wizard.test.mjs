import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual wizard controller with transport and Vue lifecycle isolated.
function wizard(failCredential = false) {
  const source = readFileSync(new URL('../src/features/remote-hosts/RemoteHostsPage.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
  const calls = [], routes = [];
  const providersContext = { exports: {}, require: name => name === 'vue' ? { markRaw: v => v } : {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/features/remote-hosts/providers.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, providersContext);
  const context = { exports: {}, URL, console, require(name) {
    if (name === 'vue') return { ref: value => ({ value }), reactive: v => v, computed: fn => ({ get value() { return fn(); } }), watch() {} };
    if (name === 'vue-router') return { useRoute: () => ({ path: '/admin/remote-hosts', params: {}, query: {} }), useRouter: () => ({ push: v => routes.push(v), replace() {} }) };
    if (name === './providers') return providersContext.exports;
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
      return { data: { id: '42', service_type: 'ssh' } };
    } };
    return {};
  } };
  const code = ts.transpileModule(source + '\nexports.controller = { form, providerValues, credential, credentialValues, createdConnection, authMethod, step, formError, nextStep, save, items, visible, page, pageSize, pageCount, pagedConnections, readPage, readPageSize, typeFilter, query };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  const c = context.exports.controller;
  Object.assign(c.form, { service_type: 'ssh', name: 'Test' });
  c.providerValues.value = { base_url: 'https://jenkins.example.com' };
  c.credential.name = 'Robot'; c.credential.code = 'build-bot'; c.credentialValues.value = { username: 'robot', token: 'test-only' };
  return { c, calls, routes };
}
test('SSH wizard uses the dedicated host API and preserves only the selected authentication material', async () => {
 for(const method of ['ssh_password','ssh_private_key','ssh_encrypted_key']) {
 const {c,calls}=wizard();c.form.service_type='ssh';c.authMethod.value=method;c.providerValues.value={host:'ssh.example.com',port:'2222'};c.credentialValues.value={username:'deploy',token:'unused-password',private_key:'test-private-key',passphrase:'test-passphrase'};
 c.step.value=2;c.nextStep();assert.equal(c.step.value,3);await c.save();assert.equal(calls[0].path,'/admin/remote-hosts');assert.equal(calls[0].options.body.config.port,2222);assert.equal(calls[2].path,'/admin/remote-hosts/42/credentials');
 const auth=calls[2].options.body.authentication;assert.equal(auth.auth_method,method);assert.equal(auth.secret.token,method==='ssh_password'?'unused-password':undefined);assert.equal(auth.secret.private_key,method==='ssh_password'?undefined:'test-private-key');assert.equal(auth.secret.passphrase,method==='ssh_encrypted_key'?'test-passphrase':undefined);assert.deepEqual(Object.keys(c.credentialValues.value),[]);
 }
});
test('SSH credential retry clears private key and passphrase without recreating the host', async () => {
 const {c,calls}=wizard(true);c.form.service_type='ssh';c.authMethod.value='ssh_encrypted_key';c.providerValues.value={host:'ssh.example.com'};c.credentialValues.value={username:'deploy',private_key:'test-private-key',passphrase:'test-passphrase'};await c.save();assert.equal(c.credentialValues.value.private_key,'');assert.equal(c.credentialValues.value.passphrase,'');assert.equal(c.credentialValues.value.username,'deploy');assert.equal(calls.filter(x=>x.path==='/admin/remote-hosts').length,1);
});
