import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveWorker } from '../lib/worker-live.mjs';
import { Simulation } from '../lib/worker-simulation.mjs';
const address = 'a'.repeat(64);
function setup({ deposit = '0', history = [] } = {}) {
  const state = { balance: '1', deposit, exits: [], tip: 600, counted: 599,
    mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: true },
    moves_left: 6, capacity_left: 100, strikes: 0, claim: null };
  const journal = { history: structuredClone(history), append(record) { this.history.push(structuredClone(record)); } };
  const calls = []; let prepared;
  const port = {
    async readSnapshot() { calls.push('read'); return { address, minimum: '10000000', tipHash: 'b'.repeat(64),
      bits: { lock: 12, claim: 12 }, status: structuredClone(state) }; },
    async prepare(action) { calls.push('prepare'); prepared = structuredClone(action); return { synthetic: true }; },
    async solve(packet, snapshot, { refresh, signal }) { calls.push('solve'); signal?.throwIfAborted(); await refresh(); return { synthetic: true }; },
    async verifySigned() { calls.push('verify'); return true; },
    async submit() {
      calls.push('submit');
      if (prepared.kind === 'lock') { state.deposit = '0.1'; state.balance = '0.9'; }
      else state.claim = { deposit: '0.1', level: 1000 };
      state.moves_left--; state.capacity_left--;
      return { ok: true };
    }
  };
  const worker = new LiveWorker({ port, journal, address });
  return { state, journal, calls, port, worker };
}
const halted = async worker => assert.rejects(worker.step(), /halted/);
test('synthetic lock then claim; journal intents precede signing and observations persist', async () => {
  const x = setup();
  const solve = x.port.solve;
  x.port.solve = (...args) => { assert.equal(x.journal.history.at(-1).type, 'intent'); return solve(...args); };
  assert.equal((await x.worker.step()).kind, 'lock');
  assert.equal((await x.worker.step()).kind, 'mine_claim');
  assert.equal((await x.worker.step()).kind, 'wait');
  assert.deepEqual(x.journal.history.map(r => r.type), ['intent', 'observed', 'intent', 'observed']);
  assert.equal(x.calls.filter(c => c === 'submit').length, 2);
  assert.deepEqual(x.journal.history[2].action.args, { level: 1000 });
});
test('clean restart deduplicates prior claim even if gateway loses the claim', async () => {
  const x = setup({ deposit: '0.1' }); await x.worker.step();
  const y = setup({ deposit: '0.1', history: x.journal.history });
  assert.equal((await y.worker.step()).reason, 'already-attempted');
  assert.ok(!y.calls.includes('submit'));
});
test('persistent lock-attempt marker prevents re-lock after deposit disappears', async () => {
  const x = setup(); await x.worker.step();
  const y = setup({ history: x.journal.history });
  await halted(y.worker); assert.ok(!y.calls.includes('prepare'));
});
for (const mode of ['throw-before', 'lost-after', 'rejected', 'missing', 'unapplied']) {
  for (const deposit of ['0', '0.1']) test(`${mode} submission halts and pending intent blocks restart (${deposit})`, async () => {
    const x = setup({ deposit }); const original = x.port.submit;
    x.port.submit = async () => {
      if (mode === 'lost-after') { await original(); throw new Error('private raw message'); }
      if (mode === 'throw-before') throw new Error('private raw message');
      if (mode === 'rejected') return { ok: false };
      if (mode === 'missing') return undefined;
      return { ok: true };
    };
    await halted(x.worker); assert.equal(x.worker.stopped, true);
    assert.throws(() => setup({ history: x.journal.history }), /halted/);
    await halted(x.worker);
  });
}
for (const field of ['address', 'minimum', 'tipHash', 'bits', 'strikes', 'exposure', 'claim']) {
  test(`invalid ${field} fails before prepare/sign/submit`, async () => {
    const x = setup(); const read = x.port.readSnapshot;
    x.port.readSnapshot = async () => {
      const s = await read();
      if (field === 'address') s.address = 'c'.repeat(64);
      if (field === 'minimum') s.minimum = '10000001';
      if (field === 'tipHash') s.tipHash = 'bad';
      if (field === 'bits') s.bits.claim = 33;
      if (field === 'strikes') s.status.strikes = 1;
      if (field === 'exposure') { s.status.deposit = '0.1'; s.status.exits = [{ amount: '0.00000001', release: 700 }]; }
      if (field === 'claim') s.status.claim = { deposit: '0.1', level: 1001 };
      return s;
    };
    await halted(x.worker); assert.ok(!x.calls.includes('prepare'));
  });
}
test('partial deposit and existing exits never top up; excess balance is ignored', async () => {
  for (const mode of ['partial', 'exits', 'low']) {
    const x = setup();
    if (mode === 'partial') x.state.deposit = '0.01';
    if (mode === 'exits') x.state.exits = [{ amount: '0.1', release: 0 }];
    if (mode === 'low') x.state.balance = '0.09999999';
    assert.equal((await x.worker.step()).kind, 'wait'); assert.ok(!x.calls.includes('submit'));
  }
});
test('fresh-state change before intent postpones without journal or signing', async () => {
  const x = setup(); const read = x.port.readSnapshot; let n = 0;
  x.port.readSnapshot = async () => { if (++n === 2) x.state.balance = '2'; return read(); };
  assert.equal((await x.worker.step()).reason, 'state-changed');
  assert.equal(x.journal.history.length, 0); assert.ok(!x.calls.includes('prepare'));
});
for (const phase of ['prepare', 'solve']) test(`state changes during ${phase} halt with pending intent, no submit`, async () => {
  const x = setup(); const old = x.port[phase];
  x.port[phase] = async (...args) => { const result = await old(...args); x.state.deposit = '0.01'; return result; };
  await halted(x.worker); assert.ok(!x.calls.includes('submit'));
  assert.throws(() => setup({ history: x.journal.history }), /halted/);
});
test('signed packet verification failure prevents dispatch', async () => {
  const x = setup(); x.port.verifySigned = async () => false;
  await halted(x.worker); assert.ok(!x.calls.includes('submit'));
});
test('failed journal fsync/append prevents signing and submit', async () => {
  const x = setup(); x.journal.append = () => { throw new Error('disk failed'); };
  await halted(x.worker); assert.ok(!x.calls.includes('prepare'));
});
test('stop and pre-abort never read/sign/submit', async () => {
  const x = setup(); x.worker.stop(); await halted(x.worker); assert.equal(x.calls.length, 0);
  const y = setup(); const c = new AbortController(); c.abort();
  await assert.rejects(y.worker.step({ signal: c.signal }), /halted/); assert.equal(y.calls.length, 0);
});
test('abort during solving stops before submission and blocks restart', async () => {
  const x = setup(); const c = new AbortController();
  x.port.solve = async () => { c.abort(); return {}; };
  await assert.rejects(x.worker.step({ signal: c.signal }), /halted/);
  assert.ok(!x.calls.includes('submit')); assert.throws(() => setup({ history: x.journal.history }), /halted/);
});
test('abort after applied submission remains ambiguous and never replays', async () => {
  const x = setup(); const c = new AbortController(); const submit = x.port.submit;
  x.port.submit = async (...args) => { const r = await submit(...args); c.abort(); return r; };
  await assert.rejects(x.worker.step({ signal: c.signal }), /halted/);
  assert.equal(x.state.deposit, '0.1'); assert.throws(() => setup({ history: x.journal.history }), /halted/);
});
test('concurrent steps are rejected without a second dispatch', async () => {
  const x = setup(); const one = x.worker.step(); await halted(x.worker); await one;
  assert.equal(x.calls.filter(c => c === 'submit').length, 1);
});
for (const regression of ['tip', 'counted', 'round', 'hash', 'boundaries']) test(`state ${regression} regression/change halts`, async () => {
  const x = setup({ deposit: '0.1' }); await x.worker.step();
  const read = x.port.readSnapshot;
  x.port.readSnapshot = async () => {
    const s = await read();
    if (regression === 'tip') s.status.tip--;
    if (regression === 'counted') s.status.counted--;
    if (regression === 'round') s.status.mine.round--;
    if (regression === 'hash') s.tipHash = 'c'.repeat(64);
    if (regression === 'boundaries') { s.status.mine.start--; s.status.mine.claim_end--; s.status.mine.end--; }
    return s;
  };
  await halted(x.worker);
});
test('malformed journal, unresolved intent and halt markers fail closed', async () => {
  const x = setup(); await x.worker.step();
  for (const history of [[{ type: 'halt' }], [x.journal.history[0]], [x.journal.history[1]],
    [{ ...x.journal.history[0], action: { kind: 'transfer', args: {}, round: 100 } }],
    [...x.journal.history, x.journal.history[0]]]) assert.throws(() => setup({ history }), /halted/);
});
test('2000 synthetic heights preserve cap and level1000 across clean restarts', async () => {
  const x = setup(); const sim = new Simulation(); let worker = x.worker; let submitted;
  x.port.readSnapshot = async () => ({ address, minimum: '10000000', tipHash: 'b'.repeat(64), bits: { lock: 0, claim: 0 }, status: await sim.status() });
  x.port.prepare = async a => { submitted = a; return {}; };
  x.port.submit = async () => sim.perform(submitted);
  for (let i = 0; i < 2000; i++) {
    await worker.step();
    if (i % 25 === 0) worker = new LiveWorker({ port: x.port, journal: x.journal, address });
    sim.advance();
  }
  assert.equal(sim.audit.filter(a => a.kind === 'lock').length, 1);
  assert.ok(sim.audit.filter(a => a.kind === 'mine_claim').every(a => a.args.level === 1000 && !('allow_over' in a.args)));
  assert.ok(sim.audit.length > 300);
});

test('state changed by signed verification is caught before dispatch', async () => {
  const x = setup(); x.port.verifySigned = async () => { x.state.deposit = '0.01'; return true; };
  await halted(x.worker); assert.ok(!x.calls.includes('submit'));
});

test('abort while submission is in-flight waits for outcome then halts without replay', async () => {
  const x = setup(), c = new AbortController(); let finish, started;
  const submitting = new Promise(resolve => { started = resolve; });
  x.port.submit = () => { started(); return new Promise(resolve => { finish = resolve; }); };
  const step = x.worker.step({ signal: c.signal });
  await submitting; c.abort(); finish({ ok: true });
  await assert.rejects(step, /halted/);
  assert.throws(() => setup({ history: x.journal.history }), /halted/);
});

test('exposure decrease after imported-deposit claim blocks re-lock across restart', async () => {
  const x = setup({ deposit: '0.1' }); await x.worker.step();
  const y = setup({ history: x.journal.history }); await halted(y.worker);
  assert.ok(!y.calls.includes('prepare'));
});

test('full proof state metadata changes during puzzle halt without dispatch', async () => {
  const x = setup(), read = x.port.readSnapshot; let meta = 1;
  x.port.readSnapshot = async () => ({ ...await read(), proofState: { metadata: meta } });
  x.port.solve = async () => { meta++; return {}; };
  await halted(x.worker); assert.ok(!x.calls.includes('submit'));
});
