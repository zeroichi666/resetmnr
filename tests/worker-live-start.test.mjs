import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalWorker } from '../lib/worker-live-start.mjs';
const address = 'a'.repeat(64);
function fixture() {
  const calls = [], wallet = { synthetic: true };
  const journal = { history: [], append(r) { calls.push(['journal', r.type]); }, close() { calls.push('journal-close'); } };
  const api = { async unlock(args) { calls.push('mock-unlock'); assert.deepEqual(args, { directory: '/synthetic-only', password: 'FAKE' }); return wallet; },
    publicAddress(w) { assert.equal(w, wallet); return address; }, wipeWallet(w) { assert.equal(w, wallet); calls.push('mock-wipe'); } };
  const backend = { async close() { calls.push('backend-close'); } };
  const deps = { walletDirectory: '/synthetic-only', takePassword() { calls.push('password'); return 'FAKE'; },
    verifyInstallation() { calls.push('pin'); }, verifyRules() { calls.push('rules'); },
    openJournal(a) { assert.equal(a, address); calls.push('journal-open'); return journal; },
    async loadSigner() { calls.push('mock-load'); return api; },
    async createBackend(w) { assert.equal(w, wallet); calls.push('mock-backend'); return backend; } };
  return { calls, wallet, journal, api, backend, deps };
}
test('startup order and clean close use only injected synthetic dependencies', async () => {
  const x = fixture(); const session = await startLocalWorker({ expectedAddress: address }, x.deps);
  assert.deepEqual(x.calls, ['password', 'pin', 'rules', 'journal-open', 'mock-load', 'mock-unlock', 'mock-backend']);
  await session.close(); await session.close();
  assert.equal(session.worker.stopped, true);
  assert.deepEqual(x.calls.slice(-3), ['backend-close', 'mock-wipe', 'journal-close']);
});
for (const stage of ['takePassword', 'verifyInstallation', 'verifyRules', 'openJournal']) test(`${stage} failure happens before signer import or mock-unlock`, async () => {
  const x = fixture(); x.deps[stage] = () => { throw new Error('private error'); };
  await assert.rejects(startLocalWorker({ expectedAddress: address }, x.deps));
  assert.ok(!x.calls.includes('mock-load')); assert.ok(!x.calls.includes('mock-unlock'));
});
test('missing password and invalid address never open a journal or load signer', async () => {
  const x = fixture(); x.deps.takePassword = () => '';
  await assert.rejects(startLocalWorker({ expectedAddress: address }, x.deps)); assert.deepEqual(x.calls, []);
  await assert.rejects(startLocalWorker({ expectedAddress: 'bad' }, x.deps)); assert.deepEqual(x.calls, []);
});
test('halted or unresolved journal is refused before importing signer or mock-unlock', async () => {
  const x = fixture(); x.journal.history = [{ type: 'halt' }];
  await assert.rejects(startLocalWorker({ expectedAddress: address }, x.deps), /halted/);
  assert.ok(!x.calls.includes('mock-load')); assert.ok(x.calls.includes('journal-close'));
});
test('wrong public address wipes mock wallet and closes journal without backend/network', async () => {
  const x = fixture(); x.api.publicAddress = () => 'b'.repeat(64);
  await assert.rejects(startLocalWorker({ expectedAddress: address }, x.deps), /halted/);
  assert.ok(x.calls.includes('mock-wipe')); assert.ok(x.calls.includes('journal-close'));
  assert.ok(!x.calls.includes('mock-backend'));
});
test('aborted startup before verification has zero effects', async () => {
  const x = fixture(), c = new AbortController(); c.abort();
  await assert.rejects(startLocalWorker({ expectedAddress: address, signal: c.signal }, x.deps));
  assert.deepEqual(x.calls, []);
});
test('abort during mock unlock wipes wallet and closes journal', async () => {
  const x = fixture(), c = new AbortController(), unlock = x.api.unlock;
  x.api.unlock = async a => { const w = await unlock(a); c.abort(); return w; };
  await assert.rejects(startLocalWorker({ expectedAddress: address, signal: c.signal }, x.deps));
  assert.ok(x.calls.includes('mock-wipe')); assert.ok(x.calls.includes('journal-close')); assert.ok(!x.calls.includes('mock-backend'));
});
test('backend close failure still wipes mock wallet and closes journal', async () => {
  const x = fixture(); x.backend.close = async () => { throw new Error('close failed'); };
  const s = await startLocalWorker({ expectedAddress: address }, x.deps);
  await assert.rejects(s.close()); assert.ok(x.calls.includes('mock-wipe')); assert.ok(x.calls.includes('journal-close'));
});
