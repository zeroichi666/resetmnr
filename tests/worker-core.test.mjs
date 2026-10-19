import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './fixtures/worker-status.mjs';
import { Simulation } from '../lib/worker-simulation.mjs';
import { SimulationWorker } from '../lib/worker-core.mjs';

test('simulation backend mandatory; arbitrary/live adapters refused', () => {
  for (const value of [null, {}, { status() {}, perform() {} }, Object.create(Simulation.prototype)])
    assert.throws(() => new SimulationWorker(value), /offline simulation/);
});
test('lock then claim in separate steps; no second lock or duplicate claim', async () => {
  const sim = new Simulation(); const worker = new SimulationWorker(sim);
  assert.equal((await worker.step()).kind, 'lock');
  assert.equal((await worker.step()).kind, 'mine_claim');
  for (let i = 0; i < 10; i++) assert.equal((await worker.step()).kind, 'wait');
  assert.deepEqual(sim.audit.map(x => x.kind), ['lock', 'mine_claim']);
  assert.equal((await sim.status()).deposit, '0.10000000');
});
test('2000 simulated heights keep lock capped and claim at most once per round', async () => {
  const sim = new Simulation(); const worker = new SimulationWorker(sim);
  for (let i = 0; i < 2000; i++) { await worker.step(); sim.advance(); }
  const locks = sim.audit.filter(x => x.kind === 'lock');
  const claims = sim.audit.filter(x => x.kind === 'mine_claim');
  assert.equal(locks.length, 1); assert.ok(claims.length > 300);
  assert.equal(new Set(claims.map(x => x.round)).size, claims.length);
  assert.ok(claims.every(x => JSON.stringify(x.args) === '{"level":1000}'));
  assert.equal((await sim.status()).deposit, '0.10000000');
});
for (const failure of ['before', 'after', 'rejected', 'unapplied']) {
  for (const deposit of ['0', '0.1']) test(`${failure} lock/claim result halts permanently (deposit ${deposit})`, async () => {
    const sim = new Simulation({ state: snapshot({ deposit }), failure });
    const worker = new SimulationWorker(sim);
    await assert.rejects(worker.step(), /halted/);
    assert.equal(worker.stopped, true);
    await assert.rejects(worker.step(), /stopped/);
    assert.equal(sim.audit.length, 1, 'no automatic retry');
  });
}
test('changed state before dispatch prevents stale claim', async () => {
  const open = snapshot({ deposit: '0.1' });
  const closed = snapshot({ deposit: '0.1', tip: 603, mine: { ...open.mine, window_open: false } });
  const sim = new Simulation({ frames: [open, closed] }); const worker = new SimulationWorker(sim);
  assert.deepEqual(await worker.step(), { kind: 'wait', reason: 'state-changed' });
  assert.equal(sim.audit.length, 0);
});
test('increased exposure before dispatch halts without any submission', async () => {
  const sim = new Simulation({ frames: [snapshot(), snapshot({ deposit: '0.10000001' })] });
  const worker = new SimulationWorker(sim);
  await assert.rejects(worker.step(), /halted/); assert.equal(sim.audit.length, 0);
});
test('regressed round/tip/counted requires review, never another claim', async () => {
  for (const patch of [{ tip: 599 }, { counted: 598 }, { mine: { round: 99, start: 600, claim_end: 602, end: 605, window_open: true } }]) {
    const sim = new Simulation({ frames: [snapshot(), snapshot(patch)] });
    await assert.rejects(new SimulationWorker(sim).step(), /halted/);
    assert.equal(sim.audit.length, 0);
  }
});
test('concurrent steps rejected, stop/abort prevents dispatch', async () => {
  const sim = new Simulation(); const worker = new SimulationWorker(sim);
  const first = worker.step(); await assert.rejects(worker.step(), /already running/);
  await first; assert.equal(sim.audit.length, 1);
  worker.stop(); await assert.rejects(worker.step(), /stopped/);
  const sim2 = new Simulation(); const worker2 = new SimulationWorker(sim2);
  const controller = new AbortController(); const step = worker2.step({ signal: controller.signal });
  controller.abort(); await assert.rejects(step, /halted/); assert.equal(sim2.audit.length, 0);
});
test('simulation fails closed for arbitrary commands or altered claim level', async () => {
  const sim = new Simulation({ state: snapshot({ deposit: '0.1' }) });
  for (const kind of ['transfer', 'lottery_guess', 'unlock', 'withdraw', 'post_headers'])
    await assert.rejects(sim.perform({ kind, args: {} }));
  for (const args of [{ level: 2000, allow_over: true }, { level: 1000, allow_over: false }])
    await assert.rejects(sim.perform({ kind: 'mine_claim', args, round: 100 }));
  assert.equal(sim.audit.length, 0);
});

test('changed round boundaries with identical action halt before dispatch (audit regression)', async () => {
  const first = snapshot({ deposit: '0.1' });
  const changed = snapshot({ deposit: '0.1', mine: { ...first.mine, start: 599, claim_end: 601, end: 604 } });
  const sim = new Simulation({ frames: [first, changed] });
  const worker = new SimulationWorker(sim);
  await assert.rejects(worker.step(), /halted/);
  assert.equal(worker.stopped, true); assert.equal(sim.audit.length, 0);
});
test('balance or tip changes that preserve action still postpone dispatch', async () => {
  for (const patch of [{ balance: '2' }, { tip: 601 }]) {
    const sim = new Simulation({ frames: [snapshot(), snapshot(patch)] });
    assert.deepEqual(await new SimulationWorker(sim).step(), { kind: 'wait', reason: 'state-changed' });
    assert.equal(sim.audit.length, 0);
  }
});
