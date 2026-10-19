import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveWorker } from '../lib/worker-live.mjs';
import { createLiveHaltError, liveHaltDiagnosis } from '../lib/worker-live-diagnostics.mjs';
import { createDashboardController } from '../lib/worker-dashboard-controller.mjs';
import { startLocalWorker } from '../lib/worker-live-start.mjs';
const address = 'a'.repeat(64);
const secret = 'PRIVATE_PASSWORD_TOKEN_WALLET_HASH_DETAIL';
function fixture() {
  const snapshot = { address, minimum: '10000000', tipHash: 'b'.repeat(64), bits: { lock: 0, claim: 0 },
    status: { balance: '1', deposit: '0.1', exits: [], tip: 600, counted: 599,
      mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: true },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null } };
  const journal = { history: [], append(record) { this.history.push(structuredClone(record)); } };
  const port = { readSnapshot: async () => structuredClone(snapshot), prepare: async () => ({}),
    solve: async () => ({}), verifySigned: async () => true, submit: async () => { throw Error(secret); } };
  return { port, journal, snapshot };
}
for (const [stage, method] of Object.entries({ 'snapshot-read': 'readSnapshot', prepare: 'prepare',
  solve: 'solve', 'signed-verification': 'verifySigned', submission: 'submit' }))
  test(`diagnosis reports ${stage} only, never raw exceptions`, async () => {
    const x = fixture(); x.port[method] = async () => { throw Error(secret); };
    const worker = new LiveWorker({ address, ...x });
    await assert.rejects(worker.step(), error => {
      assert.equal(liveHaltDiagnosis(error), stage); assert.equal(String(error).includes(secret), false);
      assert.equal('cause' in error, false); return true;
    });
    assert.equal(JSON.stringify(x.journal.history).includes(secret), false);
    assert.equal(worker.stopped, true);
  });
test('refresh callbacks do not mislabel later solve exceptions', async () => {
  const x = fixture(); x.port.solve = async (_packet, _raw, { refresh }) => { await refresh(); throw Error(secret); };
  await assert.rejects(new LiveWorker({ address, ...x }).step(), e => liveHaltDiagnosis(e) === 'solve');
});
test('snapshot validation uses static category, not untrusted fields', async () => {
  const x = fixture(); x.snapshot.minimum = secret;
  await assert.rejects(new LiveWorker({ address, ...x }).step(), e => liveHaltDiagnosis(e) === 'snapshot-validation');
  assert.deepEqual(x.journal.history, [{ type: 'halt', intentWritten: false, failureStage: 'snapshot-validation' }]);
});
test('arbitrary exception properties, getters, codes and messages cannot impersonate trusted diagnosis', () => {
  const fake = { stage: 'submission', failureStage: 'snapshot-read', code: secret,
    get message() { assert.fail('must not read arbitrary exception text'); } };
  for (const e of [null, undefined, 'snapshot-read', 1, fake, Error('snapshot-read'),
    { ...createLiveHaltError('submission') }]) assert.equal(liveHaltDiagnosis(e), null);
  assert.equal(liveHaltDiagnosis(createLiveHaltError(secret)), null);
});
for (const stage of ['startup-history', 'startup-signer-load', 'startup-unlock', 'startup-wallet-identity', 'startup-backend'])
  test(`startup diagnosis ${stage} remains sticky and sanitized`, async () => {
    const records = [], calls = [];
    const api = { unlock: async () => ({}), publicAddress: () => address, wipeWallet() {} };
    const deps = { takePassword: () => 'FAKE', verifyInstallation() {}, verifyRules() {}, walletDirectory: '/synthetic-only',
      openJournal: () => ({ history: stage === 'startup-history' ? [{ type: 'halt' }] : [],
        append(r) { records.push(r); }, close() { calls.push('close'); } }),
      loadSigner: async () => api, createBackend: async () => { throw Error(secret); } };
    if (stage === 'startup-signer-load') deps.loadSigner = async () => { throw Error(secret); };
    if (stage === 'startup-unlock') api.unlock = async () => { throw Error(secret); };
    if (stage === 'startup-wallet-identity') api.publicAddress = () => 'b'.repeat(64);
    await assert.rejects(startLocalWorker({ expectedAddress: address }, deps), e => liveHaltDiagnosis(e) === stage);
    assert.deepEqual(records, [{ type: 'halt', intentWritten: false, failureStage: stage }]);
    assert.deepEqual(calls, ['close']); assert.equal(JSON.stringify(records).includes(secret), false);
  });
for (const trusted of [false, true]) test(`dashboard diagnosis is allowlisted; no auto-retry and same-session error remains blocked; trusted=${trusted}`, async () => {
  let starts = 0, closes = 0;
  const error = trusted ? createLiveHaltError('snapshot-read') : Object.assign(Error(secret), { failureStage: 'submission' });
  const controller = createDashboardController({ address, openSession: async () => {
    starts++; return { worker: { step: async () => { throw error; }, stop() {} }, close: async () => { closes++; } };
  } });
  assert.equal(starts, 0); controller.start({ address, confirm: true });
  // Flush only the finite synthetic lifecycle, not a timer or retry loop.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const status = controller.status();
  assert.equal(status.phase, 'error'); assert.equal(status.blocked, true);
  assert.equal(starts, 1); assert.equal(closes, 1);
  const events = JSON.stringify(status.events);
  assert.equal(events.includes(secret), false); assert.equal(events.includes('Tahap gagal: snapshot-read'), trusted);
  assert.throws(() => controller.start({ address, confirm: true })); assert.equal(starts, 1);
  await controller.close();
});
