import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDashboardController } from '../lib/worker-dashboard-controller.mjs';
import { readTerminalPassword } from '../lib/worker-dashboard-password.mjs';
const address = 'a'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  let opened = 0, steps = 0, closes = 0, stopped = false;
  const controller = createDashboardController({ address,
    openSession: async ({ signal }) => { opened++; signal.throwIfAborted(); return { worker: { get stopped() { return stopped; }, stop() { stopped = true; }, async step() { steps++; return { kind: 'wait', reason: 'window-closed' }; } }, async close() { closes++; } }; },
    poll: signal => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }); if (signal.aborted) reject(new Error('abort')); }), ...options });
  return { controller, counts: () => ({ opened, steps, closes }) };
}
const payload = () => ({ confirm: true, address });
test('dashboard stays idle until explicit matching manual start; no auto restart', async () => {
  const f = fixture(); assert.equal(f.controller.status().phase, 'idle'); assert.equal(f.counts().opened, 0);
  for (const p of [{}, { confirm: false, address }, { confirm: true, address: 'b'.repeat(64) }, { ...payload(), amount: '1' }, null]) assert.throws(() => f.controller.start(p));
  f.controller.start(payload()); assert.throws(() => f.controller.start(payload())); await tick();
  assert.equal(f.controller.status().phase, 'running'); assert.equal(f.counts().steps, 1);
  f.controller.stop(); await tick(); assert.equal(f.controller.status().phase, 'stopped');
  assert.deepEqual(f.counts(), { opened: 1, steps: 1, closes: 1 }); await f.controller.close();
});
test('external lease / unreadable journal blocks start without opening wallet', () => {
  for (const inspectJournal of [() => ({ leasePresent: true }), () => { throw Error('private metadata'); }]) {
    const f = fixture({ inspectJournal }); assert.equal(f.controller.status().blocked, true);
    assert.throws(() => f.controller.start(payload())); assert.equal(f.counts().opened, 0);
    assert.ok(!JSON.stringify(f.controller.status()).includes('private metadata'));
  }
});
test('runtime failure is sticky, sanitized, closed once, never retried', async () => {
  let calls = 0, closes = 0;
  const f = fixture({ openSession: async () => { calls++; return { worker: { stop() {}, async step() { throw Error('SECRET'); } }, async close() { closes++; } }; } });
  f.controller.start(payload()); await tick(); assert.equal(f.controller.status().phase, 'error');
  assert.throws(() => f.controller.start(payload())); assert.equal(calls, 1); assert.equal(closes, 1);
  assert.ok(!JSON.stringify(f.controller.status()).includes('SECRET')); await f.controller.close();
});
test('stop during startup aborts before stepping; close waits for cleanup', async () => {
  let stepped = false, closed = false;
  const f = fixture({ openSession: async () => { await tick(); return { worker: { stop() {}, async step() { stepped = true; } }, async close() { closed = true; } }; } });
  f.controller.start(payload()); f.controller.stop(); await f.controller.close();
  assert.equal(stepped, false); assert.equal(closed, true); assert.equal(f.controller.status().phase, 'stopped');
  assert.throws(() => f.controller.start(payload()));
});
test('manual clean restart needs another click; cleanup errors halt', async () => {
  const f = fixture(); f.controller.start(payload()); await tick(); f.controller.stop(); await tick();
  f.controller.start(payload()); await tick(); assert.equal(f.counts().opened, 2); await f.controller.close();
  const bad = fixture({ openSession: async () => ({ worker: { stop() {}, async step() { return { kind: 'wait' }; } }, async close() { throw Error('secret'); } }) });
  bad.controller.start(payload()); await tick(); await bad.controller.close(); assert.equal(bad.controller.status().phase, 'error');
});
function terminal() { const input = new EventEmitter(); input.isTTY = true; input.isRaw = false; input.setRawMode = value => { input.isRaw = value; }; input.setEncoding = () => {}; input.pause = () => {}; input.resume = () => {}; let text = ''; const output = { isTTY: true, write(s) { text += s; } }; return { input, output, text: () => text }; }
test('TTY password never echoes and restores raw mode; abort cancels pending input', async () => {
  const t = terminal(); const p = readTerminalPassword(t); t.input.emit('data', 'secrex\u007ft\r'); assert.equal(await p, 'secret'); assert.ok(!t.text().includes('secret')); assert.equal(t.input.isRaw, false);
  const abort = new AbortController(); const pending = readTerminalPassword({ ...t, signal: abort.signal }); abort.abort(); await assert.rejects(pending); assert.equal(t.input.listenerCount('data'), 0); assert.equal(t.input.isRaw, false);
  await assert.rejects(readTerminalPassword({ input: { isTTY: false }, output: t.output }));
});

test('throwing stop still aborts and closes session, then blocks restart', async () => {
  let closed = 0, signal;
  const f = fixture({ openSession: async o => { signal = o.signal; return { worker: { stop() { throw Error('STOP_SECRET'); }, async step() { return { kind: 'wait' }; } }, async close() { closed++; } }; } });
  f.controller.start(payload()); await tick(); assert.doesNotThrow(() => f.controller.stop()); await f.controller.close();
  assert.equal(signal.aborted, true); assert.equal(closed, 1); assert.equal(f.controller.status().phase, 'error'); assert.throws(() => f.controller.start(payload()));
});
test('TTY input arriving synchronously on resume is captured without echo', async () => {
  const t = terminal(); t.input.resume = () => t.input.emit('data', 'synthetic\r');
  assert.equal(await readTerminalPassword(t), 'synthetic'); assert.equal(t.input.isRaw, false); assert.ok(!t.text().includes('synthetic'));
});
