import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicStatusReader, createPublicStatus, PUBLIC_GATEWAY } from '../lib/worker-dashboard-public-status.mjs';

const address = 'a'.repeat(64);
const hash = 'b'.repeat(64);

function fixtures({ windowOpen = true, amount = '0', accountR = 100, stateR = 100 } = {}) {
  const state = { tip: { height: windowOpen ? 600 : 606, hash }, counted: 599,
    bits: { lock: 0, claim: 0, unlock: 0, withdraw: 0, guess: 0 }, capacity_left: 600, per_address: 6,
    params: { capacity: 600, per_address: 6, exit_wait: 144, min_amount: '10000000' },
    lottery: { start: 1, end: 145, blocks: 144, winners: 1, open_targets: [] },
    mine: { r: stateR, start: windowOpen ? 600 : 601, claim_end: windowOpen ? 602 : 603, end: windowOpen ? 605 : 606,
      window_open: windowOpen, S: amount, C: amount, vein_buffer: amount, last_guideline: amount,
      claim_count: 0, claim_deposit: amount, params: { mine_clean_rounds: 24, mine_max_strikes: 10 } } };
  const account = { balance: amount, deposit: amount, exits: [{ amount, release: 599 }], moves_this_height: 0,
    mine: { r: accountR, claim: { d: amount, q: 1000 }, fair_share_estimate: amount, strikes: 0, clean: 0 } };
  return { state, account };
}

function response(value, init = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' }, ...init
  });
}
function mockedFetch(values, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (options.reject) throw options.reject;
    const value = typeof values === 'function' ? values(url, calls.length) : values[calls.length - 1];
    return value instanceof Response ? value : response(value);
  };
  return { fetchImpl, calls };
}
function gateway(values, options) {
  const f = mockedFetch(values, options);
  return { ...f, reader: createPublicStatusReader({ address, fetchImpl: f.fetchImpl }) };
}

function validTrip(options = {}) {
  const x = fixtures(options);
  return { ...gateway([x.state, x.account, x.state]), state: x.state, account: x.account };
}

test('reader is lazy and status refresh is explicit; fixed public GET routes and no capabilities leak', async () => {
  const x = validTrip();
  const status = createPublicStatus({ readSnapshot: x.reader, source: 'demo', now: () => '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(status.status(), { state: 'unchecked', checkedAt: null, lastSuccessAt: null, source: 'demo', error: null, data: null });
  assert.equal(x.calls.length, 0);
  const result = await status.refresh();
  assert.equal(x.calls.length, 3);
  assert.deepEqual(x.calls.map(c => c.url), [`${PUBLIC_GATEWAY}/v1/state`, `${PUBLIC_GATEWAY}/v1/account/${address}`, `${PUBLIC_GATEWAY}/v1/state`]);
  for (const c of x.calls) { assert.equal(c.init.method, 'GET'); assert.equal(c.init.redirect, 'error'); assert.equal(c.init.credentials, 'omit'); assert.equal(c.init.body, undefined); assert.deepEqual(c.init.headers, { Accept: 'application/json' }); assert.ok(c.init.signal instanceof AbortSignal); }
  assert.ok(x.calls.every(c => c.init.signal === x.calls[0].init.signal), 'one shared total timeout for the whole snapshot');
  assert.equal(result.state, 'ready');
  assert.ok(!JSON.stringify(result).match(/sign|wallet|secret|submit|credential/i));
  assert.deepEqual(Object.keys(result.data).sort(), ['balance', 'claim', 'counted', 'deposit', 'exits', 'fair_share_estimate', 'mine', 'tip']);
});

test('exact bigint coin formatting including zero, exits, claim, and closed window are exposed', async () => {
  const x = validTrip({ amount: '100000000000000000000000000000000000000000000000000000000000000001', windowOpen: false });
  const s = await createPublicStatusReader({ address, fetchImpl: mockedFetch([x.state, x.account, x.state]).fetchImpl })();
  assert.equal(s.balance, '1000000000000000000000000000000000000000000000000000000000.00000001');
  assert.equal(s.deposit, s.balance); assert.equal(s.fair_share_estimate, s.balance);
  assert.equal(s.mine.window_open, false); assert.equal(s.mine.claim_end, 603);
  assert.deepEqual(s.exits, [{ amount: s.balance, release: 599, mature: true }]);
  assert.deepEqual(s.claim, { deposit: s.balance, level: 1000 });
  const z = validTrip({ amount: '0' });
  const zero = await createPublicStatusReader({ address, fetchImpl: mockedFetch([z.state, z.account, z.state]).fetchImpl })();
  assert.equal(zero.balance, '0.00000000'); assert.equal(zero.deposit, '0.00000000'); assert.equal(zero.fair_share_estimate, '0.00000000');
});

test('invalid addresses, state/account mismatch, changing state, missing values, and malformed amounts reject', async () => {
  assert.throws(() => createPublicStatusReader({ address: 'A'.repeat(64) }), /Invalid public address/);
  assert.throws(() => createPublicStatusReader({ address: 'a'.repeat(63) }), /Invalid public address/);
  const mismatch = fixtures({ accountR: 99 }); await assert.rejects(gateway([mismatch.state, mismatch.account, mismatch.state]).reader);
  const changing = fixtures(); const other = structuredClone(changing.state); other.tip.height++;
  await assert.rejects(gateway([changing.state, changing.account, other]).reader);
  for (const bad of [{ ...fixtures().state, mine: { ...fixtures().state.mine, S: undefined } },
    { ...fixtures().account, balance: '01' }, null]) {
    const x = fixtures(); await assert.rejects(gateway([bad, x.account, x.state]).reader);
  }
  for (const mutate of [a => { delete a.balance; }, a => { delete a.deposit; }, a => { delete a.mine.fair_share_estimate; }, a => { a.balance = '01'; }]) {
    const x = fixtures(); mutate(x.account);
    await assert.rejects(gateway([x.state, x.account, x.state]).reader);
  }
});

test('HTTP errors, redirects, non-json, invalid JSON, oversized body, and rejected fetch are unavailable', async () => {
  const x = fixtures();
  for (const first of [new Response('', { status: 401 }), new Response('', { status: 500 }),
    new Response('', { status: 302, headers: { location: 'https://example.invalid' } }),
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    response('x'.repeat(262145))]) {
    const status = createPublicStatus({ readSnapshot: createPublicStatusReader({ address, fetchImpl: mockedFetch([first, x.account, x.state]).fetchImpl }) });
    const out = await status.refresh(); assert.equal(out.state, 'unavailable'); assert.equal(out.data, null); assert.match(out.error, /^Status publik tidak tersedia\./);
  }
  const rejected = createPublicStatus({ readSnapshot: createPublicStatusReader({ address, fetchImpl: mockedFetch([], { reject: new Error('SECRET network') }).fetchImpl }) });
  const out = await rejected.refresh(); assert.equal(out.state, 'unavailable'); assert.ok(!out.error.includes('SECRET'));
});

test('timeout abort signal is passed and abort-like fetch failure is sanitized without stale data', async () => {
  let seenSignal; const x = fixtures();
  const fetchImpl = async (_url, init) => { seenSignal = init.signal; throw Object.assign(new Error('timeout SECRET'), { name: 'TimeoutError' }); };
  const status = createPublicStatus({ readSnapshot: createPublicStatusReader({ address, fetchImpl }) });
  const failed = await status.refresh(); assert.ok(seenSignal instanceof AbortSignal); assert.equal(failed.data, null); assert.ok(!JSON.stringify(failed).includes('SECRET'));
});

test('lastSuccessAt is retained after failure; concurrent refresh is singleflight and recovery works', async () => {
  const x = fixtures(); let mode = 'ok'; let calls = 0;
  const fetchImpl = async (url, init) => { calls++; init.signal.throwIfAborted(); if (mode === 'bad') throw new Error('private'); const n = url.endsWith('/state') ? (calls === 1 ? x.state : x.state) : x.account; return response(n); };
  const status = createPublicStatus({ readSnapshot: createPublicStatusReader({ address, fetchImpl }), now: (() => { let n = 0; return () => `t${++n}`; })() });
  const [a, b] = await Promise.all([status.refresh(), status.refresh()]); assert.deepEqual(a, b); assert.equal(calls, 3); assert.equal(a.lastSuccessAt, 't1');
  mode = 'bad'; const failed = await status.refresh(); assert.equal(failed.state, 'unavailable'); assert.equal(failed.lastSuccessAt, 't1'); assert.equal(failed.data, null);
  mode = 'ok'; const recovered = await status.refresh(); assert.equal(recovered.state, 'ready'); assert.equal(recovered.lastSuccessAt, 't3'); assert.equal(calls, 7);
});
