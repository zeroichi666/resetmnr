import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../dashboard/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const elements = new Map(), calls = [];
  function element() { return { textContent: '', hidden: false, disabled: false, checked: false, classList: { toggle() {} }, setAttribute() {}, addEventListener(kind, fn) { this[kind] = fn; }, append() {}, appendChild() {} }; }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const initial = { phase: 'idle', address: 'a'.repeat(64), mode: 'demo', csrf: 'f'.repeat(64), events: [], publicStatus: { state: 'unchecked', source: 'demo', data: null, checkedAt: null, lastSuccessAt: null } };
  let state = structuredClone(initial), failLocal = false;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (failLocal) throw new Error('Local offline');
    assert.ok(['/api/status', '/api/refresh'].includes(url), 'UI refresh must not dispatch worker operations');
    return { ok: true, json: async () => structuredClone(state) };
  };
  vm.runInNewContext(source, { document, fetch, Date, BigInt, AbortSignal, setInterval() { throw new Error('No auto refresh'); }, setTimeout() { throw new Error('No scheduled refresh'); } });
  return { elements, calls, set(data) { state = { ...initial, publicStatus: data }; }, offline(v) { failLocal = v; } };
}
test('page load reads local cache once; explicit refresh reads public snapshot without worker operations', async () => {
  const f = fixture(); await tick(); assert.deepEqual(f.calls.map(c => c.url), ['/api/status']);
  await tick(); assert.equal(f.calls.length, 1);
  const publicStatus = { state: 'ready', source: 'demo', checkedAt: '2026-10-19T04:00:00Z', lastSuccessAt: '2026-10-19T04:00:00Z',
    data: { balance: '0.00000000', deposit: '0.10000000', fair_share_estimate: '0.00000001', tip: 2400, counted: 2399,
      mine: { round: 400, start: 2400, claim_end: 2402, end: 2405, window_open: false }, exits: [{ amount: '0.01000000', release: 2600, mature: false }], claim: { deposit: '0.10000000', level: 1000 } } };
  f.set(publicStatus); await f.elements.get('refreshBtn').click();
  assert.deepEqual(f.calls.map(c => c.url), ['/api/status', '/api/status', '/api/refresh']);
  const last = f.calls.at(-1); assert.equal(last.options.method, 'POST'); assert.equal(last.options.body, '{}'); assert.equal(last.options.headers['X-Reset-Token'], 'f'.repeat(64));
  assert.equal(f.elements.get('publicBalance').textContent, '0.00000000 RESET');
  assert.equal(f.elements.get('publicWindow').textContent, 'Tertutup');
  assert.equal(f.elements.get('publicTimes').textContent, 'Blok mulai 2400 · batas claim 2402 · akhir 2405');
  assert.match(f.elements.get('publicExits').textContent, /release blok 2600/);
  assert.equal(f.elements.get('publicRound').textContent, '400');
  const success = f.elements.get('publicLastSuccess').textContent;
  f.set({ state: 'unavailable', source: 'demo', checkedAt: '2026-10-19T04:01:00Z', lastSuccessAt: publicStatus.lastSuccessAt, data: null, error: 'Status publik tidak tersedia.' });
  await f.elements.get('refreshBtn').click();
  assert.equal(f.elements.get('publicBalance').textContent, 'Tidak tersedia');
  assert.equal(f.elements.get('publicLastSuccess').textContent, success);
  assert.ok(!f.elements.get('actionFeedback').textContent.includes('berhasil'));
  assert.equal(f.elements.get('refreshBtn').disabled, false);
});
test('offline refresh stays retryable and reconnects without starting worker', async () => {
  const f = fixture(); await tick(); f.offline(true);
  await f.elements.get('refreshBtn').click();
  assert.equal(f.elements.get('startBtn').disabled, true); assert.equal(f.elements.get('stopBtn').disabled, true);
  assert.equal(f.elements.get('refreshBtn').disabled, false); assert.equal(f.elements.get('publicBalance').textContent, 'Tidak tersedia');
  const count = f.calls.length; f.offline(false); await f.elements.get('refreshBtn').click();
  assert.equal(f.calls.length, count + 2); assert.equal(f.calls.at(-1).url, '/api/refresh');
});
