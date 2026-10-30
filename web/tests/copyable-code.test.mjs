import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function clipboard({ write = async () => {}, secure = true, fallback = true } = {}) {
  const source = readFileSync(new URL('../src/shared/CopyableCode.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
  const props = { code: 'build-bot' }, errors = [], timers = new Map(), writes = [], actions = [];
  let changed, unmounted, nextTimer = 0;
  class Element { focus() { actions.push('focus'); } }
  const context = {
    exports: {}, defineProps: () => props, HTMLElement: Element,
    navigator: { clipboard: { writeText: value => { writes.push(value); return write(value); } } },
    window: { isSecureContext: secure },
    document: {
      activeElement: new Element(),
      createElement: () => ({ style: {}, select() { actions.push('select'); }, remove() { actions.push('remove'); } }),
      body: { appendChild() { actions.push('append'); } },
      execCommand: () => fallback,
    },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'vue') return { ref: value => ({ value }), watch: (_, callback) => { changed = callback; }, onUnmounted: callback => { unmounted = callback; } };
      if (name === 'element-plus') return { ElMessage: { error: text => errors.push(text) } };
      return {};
    },
  };
  vm.runInNewContext(ts.transpileModule(source + '\nexports.controller = { copy, copied, copying };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...context.exports.controller, props, errors, timers, writes, actions, change: () => changed(), unmount: () => unmounted() };
}

test('copy feedback lasts two seconds and a repeated copy restarts the timer', async () => {
  const c = clipboard();
  await c.copy();
  assert.equal(c.copied.value, true);
  const first = [...c.timers.keys()][0];
  await c.copy();
  assert.equal(c.timers.has(first), false);
  assert.equal(c.timers.size, 1);
  const timer = [...c.timers.values()][0];
  assert.equal(timer.delay, 2000);
  timer.fn();
  assert.equal(c.copied.value, false);
  assert.deepEqual(c.writes, ['build-bot', 'build-bot']);
});

test('an obsolete pending copy cannot change feedback after code change or unmount', async () => {
  for (const reset of ['change', 'unmount']) {
    let finish;
    const c = clipboard({ write: () => new Promise(resolve => { finish = resolve; }) });
    const pending = c.copy();
    await c.copy();
    assert.equal(c.writes.length, 1);
    c[reset]();
    finish();
    await pending;
    assert.equal(c.copied.value, false);
    assert.equal(c.copying.value, false);
    assert.equal(c.timers.size, 0);
  }
});

test('clipboard failures clear success feedback and allow a retry', async () => {
  const c = clipboard({ write: async () => { throw new Error('denied'); } });
  await c.copy();
  assert.equal(c.copied.value, false);
  assert.equal(c.copying.value, false);
  assert.equal(c.errors.length, 1);
  assert.equal(c.timers.size, 0);
});

test('HTTP clipboard fallback always removes its textarea and restores focus', async () => {
  for (const fallback of [true, false]) {
    const c = clipboard({ secure: false, fallback });
    await c.copy();
    assert.deepEqual(c.actions, ['append', 'select', 'remove', 'focus']);
    assert.equal(c.writes.length, 0);
    assert.equal(c.copied.value, fallback);
    assert.equal(c.errors.length, fallback ? 0 : 1);
    c.unmount();
    assert.equal(c.timers.size, 0);
  }
});
