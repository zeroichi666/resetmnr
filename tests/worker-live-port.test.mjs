import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignerPort } from '../lib/worker-live-port.mjs';
import { LiveWorker } from '../lib/worker-live.mjs';
import * as schema from '../vendor/upstream/signer/lib/local-state.mjs';
import * as wire from '../vendor/upstream/signer/lib/wire.mjs';
import { stableStringify } from '../vendor/upstream/signer/lib/pow.mjs';
const address = 'a'.repeat(64), hash = 'b'.repeat(64);
function setup() {
  const state = { tip: { height: 600, hash }, counted: 599, bits: { lock: 0, claim: 0, unlock: 0, withdraw: 0, guess: 0 },
    capacity_left: 600, per_address: 6, params: { capacity: 600, per_address: 6, exit_wait: 144, min_amount: '10000000' },
    lottery: { start: 1, end: 145, blocks: 144, winners: 1, open_targets: [] },
    mine: { r: 100, start: 600, claim_end: 602, end: 605, window_open: true,
      S: '0', C: '0', vein_buffer: '0', last_guideline: '0', claim_count: 0, claim_deposit: '0',
      params: { mine_clean_rounds: 24, mine_max_strikes: 10 } } };
  const account = { balance: '100000000', deposit: '0', exits: [], moves_this_height: 0,
    mine: { r: 100, claim: null, fair_share_estimate: '0', strikes: 0, clean: 0 } };
  const calls = []; const wallet = { syntheticOnly: true }; let options, submitted;
  const api = { ...schema, ...wire, stableStringify, publicAddress: w => { assert.equal(w, wallet); return address; },
    async signAndSolve(w, packet, opts) {
      assert.equal(w, wallet); options = opts; calls.push('mock-sign');
      await opts.refreshState(); opts.signal.throwIfAborted();
      return { prepared: wire.preparedMessage(stableStringify({ ...packet.envelope, w: '0' }), address), signature: 'mock', nonce: 'mock' };
    },
    verifyMove(signed, opts) { calls.push('mock-verify'); assert.equal(opts.state.tip.hash, hash); return true; } };
  const backend = {
    async state() { return structuredClone(state); }, async account() { return structuredClone(account); },
    async prepareMove(t, p, s) { calls.push([t, p]); return wire.prepareMove(address, t, p, s); },
    async submitMove(signed) { calls.push('mock-submit'); submitted = signed; return { ok: true }; }
  };
  const port = createSignerPort({ backend, wallet, api, address });
  return { state, account, calls, api, backend, port, wallet, options: () => options, submitted: () => submitted };
}
const lock = { kind: 'lock', args: { amount: '0.1' }, round: 100 };
const claim = { kind: 'mine_claim', args: { level: 1000 }, round: 100 };
test('official validators map wire units to exact policy view and live minimum', async () => {
  const x = setup(); const snapshot = await x.port.readSnapshot();
  assert.equal(snapshot.status.balance, '1.00000000'); assert.equal(snapshot.status.deposit, '0.00000000');
  assert.equal(snapshot.minimum, '10000000'); assert.equal(snapshot.status.moves_left, 6);
  assert.equal(snapshot.address, address); assert.equal(snapshot.proofState.mine.r, 100);
});
test('inconsistent state/account snapshots fail without retry or signing', async () => {
  const x = setup(); let reads = 0;
  x.backend.state = async () => { reads++; const s = structuredClone(x.state); if (reads === 2) s.counted--; return s; };
  await assert.rejects(x.port.readSnapshot()); assert.equal(reads, 2); assert.equal(x.calls.length, 0);
  const y = setup(); y.account.mine.r = 99; await assert.rejects(y.port.readSnapshot());
});
test('wrong selected address is rejected immediately', () => {
  const x = setup(); assert.throws(() => createSignerPort({ ...x, address: 'c'.repeat(64) }));
});
test('lock and claim prepare exact wire payloads, never allow_over', async () => {
  const x = setup(); const s = await x.port.readSnapshot();
  const p = await x.port.prepare(lock, s); assert.deepEqual(p.envelope.p, { amount: '10000000' });
  const c = await x.port.prepare(claim, s); assert.deepEqual(c.envelope.p, { r: 100, q: 1000 });
  assert.deepEqual(x.calls, [['lock', { amount: '10000000' }], ['claim', { r: 100, q: 1000 }]]);
});
test('unsupported actions, overclaims, extra keys and foreign rounds are rejected', async () => {
  const x = setup(), s = await x.port.readSnapshot();
  for (const a of [{ kind: 'transfer', args: {}, round: 100 }, { ...claim, args: { level: 1001 } },
    { ...claim, args: { level: 1000, allow_over: true } }, { ...lock, args: { amount: '1' } },
    { ...claim, round: 101 }, { ...claim, extra: true }]) await assert.rejects(x.port.prepare(a, s));
});
for (const alteration of ['payload', 'type', 'hash', 'height', 'bits', 'prepared', 'expiry']) test(`altered preparation ${alteration} never reaches mock signer`, async () => {
  const x = setup(), s = await x.port.readSnapshot(), prepare = x.backend.prepareMove;
  x.backend.prepareMove = async (...args) => {
    const p = await prepare(...args);
    if (alteration === 'payload') p.envelope.p.amount = '10000001';
    if (alteration === 'type') p.envelope.t = 'withdraw';
    if (alteration === 'hash') p.envelope.h = 'c'.repeat(64);
    if (alteration === 'height') p.envelope.b--;
    if (alteration === 'bits') p.bits++;
    if (alteration === 'prepared') p.prepared.dispatch.address = 'c'.repeat(64);
    if (alteration === 'expiry') p.expires_at = 0;
    return p;
  };
  await assert.rejects(x.port.prepare(lock, s)); assert.ok(!x.calls.includes('mock-sign'));
});
test('puzzle mock gets bounded attempts/time, abort, fresh-state hook, and exact snapshot', async () => {
  const x = setup(), s = await x.port.readSnapshot(), p = await x.port.prepare(lock, s); let refreshes = 0;
  const signed = await x.port.solve(p, s, { refresh: async () => { refreshes++; return { raw: s }; } });
  assert.equal(refreshes, 1); assert.equal(x.options().maxAttempts, 1000000); assert.ok(x.options().signal instanceof AbortSignal);
  assert.equal(await x.port.verifySigned(signed, lock, s), true);
  await x.port.submit(signed); assert.equal(x.submitted(), signed);
});
test('aborted prepare and submit do not call backend', async () => {
  const x = setup(), s = await x.port.readSnapshot(), c = new AbortController(); c.abort();
  await assert.rejects(x.port.prepare(lock, s, { signal: c.signal }));
  await assert.rejects(x.port.submit({}, { signal: c.signal })); assert.deepEqual(x.calls, []);
});
test('mock signed payload/address/type tampering fails verification before dispatch', async () => {
  const x = setup(), s = await x.port.readSnapshot(), p = await x.port.prepare(claim, s);
  const signed = await x.port.solve(p, s, { refresh: async () => ({ raw: s }) });
  for (const e of [{ ...p.envelope, w: '0', p: { r: 100, q: 1001 } }, { ...p.envelope, w: '0', t: 'withdraw', p: {} }]) {
    const altered = structuredClone(signed); altered.prepared.dispatch.msg = stableStringify(e);
    await assert.rejects(x.port.verifySigned(altered, claim, s));
  }
  signed.prepared.dispatch.address = 'c'.repeat(64); await assert.rejects(x.port.verifySigned(signed, claim, s));
  assert.ok(!x.calls.includes('mock-submit'));
});
test('end-to-end adapter plus real validators uses mock signing/submission only', async () => {
  const x = setup();
  x.backend.submitMove = async signed => {
    const e = JSON.parse(signed.prepared.dispatch.msg);
    if (e.t === 'lock') { x.account.deposit = e.p.amount; x.account.balance = '90000000'; }
    else x.account.mine.claim = { d: '10000000', q: e.p.q };
    return { ok: true };
  };
  const journal = { history: [], append(r) { this.history.push(structuredClone(r)); } };
  const worker = new LiveWorker({ port: x.port, journal, address });
  assert.equal((await worker.step()).kind, 'lock'); assert.equal((await worker.step()).kind, 'mine_claim');
  assert.equal((await worker.step()).kind, 'wait');
  assert.equal(x.calls.filter(c => c === 'mock-sign').length, 2);
});
