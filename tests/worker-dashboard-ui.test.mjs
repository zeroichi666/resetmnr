import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../dashboard/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = { state: 'ready', source: 'demo', checkedAt: '2026-10-19T04:00:00Z', lastSuccessAt: '2026-10-19T04:00:00Z',
  data: { balance: '0.00000000', deposit: '0.10000000', fair_share_estimate: '0.00000001', tip: 2400, counted: 2399,
    mine: { round: 400, start: 2400, claim_end: 2402, end: 2405, window_open: false }, exits: [{ amount: '0.01000000', release: 2600, mature: false }], claim: { deposit: '0.10000000', level: 1000 } } };
function fixture() {
  const elements = new Map(), calls = [], timers = new Map(), listeners = new Map();
  let now = 0, timerId = 0, pending = null;
  function element() { return { textContent: '', hidden: false, disabled: false, checked: false, classList: { toggle() {} }, setAttribute() {}, addEventListener(kind, fn) { this[kind] = fn; }, append() {}, appendChild() {} }; }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const initial = { phase: 'idle', address: 'a'.repeat(64), mode: 'demo', csrf: 'f'.repeat(64), events: [], publicStatus: { state: 'unchecked', source: 'demo', data: null, checkedAt: null, lastSuccessAt: null } };
  let state = structuredClone(initial), failLocal = false, failPublic = false;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.ok(['/api/status', '/api/refresh'].includes(url), 'UI refresh must not dispatch worker operations');
    if (pending?.url === url) await pending.promise;
    if (failLocal || (failPublic && url === '/api/refresh')) throw new Error('Local offline');
    return { ok: true, json: async () => structuredClone(state) };
  };
  vm.runInNewContext(source, { document, fetch, Date, BigInt, AbortSignal,
    window: { addEventListener(kind, fn) { listeners.set(kind, fn); } },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, at: now + ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout() { throw new Error('Unexpected scheduled refresh'); }
  });
  return { elements, calls, timers,
    set(data, phase = 'idle') { state = { ...initial, phase, publicStatus: data }; },
    offline(v) { failLocal = v; }, failPublic(v) { failPublic = v; },
    hold(url) { let release; const promise = new Promise(resolve => { release = resolve; }); pending = { url, promise }; return () => { pending = null; release(); }; },
    event(kind) { listeners.get(kind)?.(); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.values()].filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at; next.at += next.ms; next.fn(); await tick();
      }
      now = end; await tick();
    }
  };
}
test('page load reads local cache once; explicit refresh reads public snapshot without worker operations', async () => {
  const f = fixture(); await tick(); assert.deepEqual(f.calls.map(c => c.url), ['/api/status']);
  await tick(); assert.equal(f.calls.length, 1);
  f.set(ready); await f.elements.get('refreshBtn').click();
  assert.deepEqual(f.calls.map(c => c.url), ['/api/status', '/api/status', '/api/refresh']);
  const last = f.calls.at(-1); assert.equal(last.options.method, 'POST'); assert.equal(last.options.body, '{}'); assert.equal(last.options.headers['X-Reset-Token'], 'f'.repeat(64));
  assert.equal(f.elements.get('publicBalance').textContent, '0.00000000 RESET');
  assert.equal(f.elements.get('publicWindow').textContent, 'Tertutup');
  assert.equal(f.elements.get('publicTimes').textContent, 'Blok mulai 2400 · batas claim 2402 · akhir 2405');
  assert.match(f.elements.get('publicExits').textContent, /release blok 2600/);
  assert.equal(f.elements.get('publicRound').textContent, '400');
  const success = f.elements.get('publicLastSuccess').textContent;
  f.set({ state: 'unavailable', source: 'demo', checkedAt: '2026-10-19T04:01:00Z', lastSuccessAt: ready.lastSuccessAt, data: null, error: 'Status publik tidak tersedia.' });
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
test('automatic refresh uses the protected read-only flow exactly every 180000 ms, never worker actions', async () => {
  const f = fixture(); await tick(); f.set(ready, 'running');
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, 180000);
  await f.advance(179999); assert.equal(f.calls.length, 1);
  await f.advance(1);
  assert.deepEqual(f.calls.map(c => c.url), ['/api/status', '/api/status', '/api/refresh']);
  assert.equal(f.elements.get('publicDeposit').textContent, '0.10000000 RESET');
  await f.advance(179999); assert.equal(f.calls.length, 3);
  await f.advance(1); assert.equal(f.calls.length, 5);
  for (const call of f.calls.filter(c => c.url === '/api/refresh')) {
    assert.equal(call.options.method, 'POST'); assert.equal(call.options.body, '{}');
    assert.equal(call.options.headers['X-Reset-Token'], 'f'.repeat(64));
    assert.equal(call.options.cache, 'no-store');
  }
});
test('manual refresh remains available between ticks and does not reset the automatic cadence', async () => {
  const f = fixture(); await tick(); f.set(ready);
  await f.advance(90000); await f.elements.get('refreshBtn').click();
  assert.equal(f.calls.length, 3);
  await f.advance(89999); assert.equal(f.calls.length, 3);
  await f.advance(1); assert.equal(f.calls.length, 5);
});
test('manual and automatic refresh share singleflight across both token and public requests; missed ticks are not queued', async () => {
  for (const endpoint of ['/api/status', '/api/refresh']) {
    const f = fixture(); await tick(); f.set(ready);
    const release = f.hold(endpoint);
    const manual = f.elements.get('refreshBtn').click(); await tick();
    assert.equal(f.elements.get('refreshBtn').disabled, true);
    assert.equal(f.elements.get('publicDeposit').textContent, 'Tidak tersedia');
    const count = f.calls.length;
    await f.advance(360000); await f.elements.get('refreshBtn').click();
    assert.equal(f.calls.length, count);
    release(); await manual; await tick(); assert.equal(f.calls.length, 3);
    assert.equal(f.elements.get('refreshBtn').disabled, false);
    await f.advance(179999); assert.equal(f.calls.length, 3);
    await f.advance(1); assert.equal(f.calls.length, 5);
    const releaseAuto = f.hold(endpoint);
    await f.advance(180000); const automaticCount = f.calls.length;
    await f.elements.get('refreshBtn').click(); await f.advance(180000);
    assert.equal(f.calls.length, automaticCount);
    releaseAuto(); await tick(); assert.equal(f.calls.length, 7);
  }
});
test('initial local read cannot overlap with automatic or manual refresh', async () => {
  const f = fixture(); // Initial fetch is awaiting its JSON continuation.
  await f.elements.get('refreshBtn').click();
  assert.equal(f.calls.length, 1);
  await tick(); await f.advance(180000); assert.equal(f.calls.length, 3);
});
test('automatic failures clear stale values and retry on the next tick without worker calls', async () => {
  for (const failure of ['offline', 'public', 'unavailable']) {
    const f = fixture(); await tick(); f.set(ready); await f.advance(180000);
    const success = f.elements.get('publicLastSuccess').textContent;
    if (failure === 'offline') f.offline(true);
    else if (failure === 'public') f.failPublic(true);
    else f.set({ ...ready, state: 'unavailable', data: null, error: 'Status publik tidak tersedia.' });
    await f.advance(180000);
    assert.equal(f.elements.get('publicStatePill').textContent, 'TIDAK TERSEDIA');
    for (const id of ['publicBalance', 'publicDeposit', 'publicFairShare', 'publicTip', 'publicRound', 'publicWindow', 'publicTimes', 'publicExits', 'publicClaim']) {
      assert.equal(f.elements.get(id).textContent, 'Tidak tersedia');
    }
    assert.equal(f.elements.get('publicLastSuccess').textContent, success);
    assert.equal(f.elements.get('refreshBtn').disabled, false);
    f.offline(false); f.failPublic(false); f.set(ready);
    const count = f.calls.length; await f.advance(180000);
    assert.equal(f.calls.length, count + 2); assert.equal(f.elements.get('publicStatePill').textContent, 'SNAPSHOT');
  }
});
test('pagehide stops the timer; pageshow restores one timer with no immediate or catch-up requests', async () => {
  const f = fixture(); await tick(); f.set(ready);
  f.event('pageshow'); f.event('pageshow'); assert.equal(f.timers.size, 1);
  f.event('pagehide'); assert.equal(f.timers.size, 0);
  await f.advance(540000); assert.equal(f.calls.length, 1);
  f.event('pageshow'); f.event('pageshow'); assert.equal(f.timers.size, 1);
  await f.advance(179999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 3);
});
