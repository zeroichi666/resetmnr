import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectRound400Abandon, appendRound400Abandon, inspectSnapshotRead, appendSnapshotRead } from '../lib/round400-recovery.mjs';
import { ROUND400_FORFEIT_ACK } from '../lib/round400-abandon-policy.mjs';
import { snapshotReadToken } from '../lib/snapshot-read-policy.mjs';
import { validateLiveHistory, LiveWorker } from '../lib/worker-live.mjs';
import { parseLiveJournalBytes } from '../lib/worker-live-journal.mjs';
import { main } from '../bin/reset-reconcile-snapshot-read.mjs';
// Hard fail if the prepared offline path tries network or launches a process.
const deny = () => { throw Error('OFFLINE TEST: forbidden external operation'); };
globalThis.fetch = deny; net.Socket.prototype.connect = deny;
for (const x of [http, https]) { x.request = deny; x.get = deny; }
for (const k of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) child[k] = deny;
const address = 'a'.repeat(64);
const identity = { address, gateway: 'https://reset.openmayhem.ai', pin: '6132e8653d6342f36673eb7426ec8e064960e48e' };
const legacy = { type: 'halt', intentWritten: false };
const halt = { ...legacy, failureStage: 'snapshot-read' };
const encode = r => r.map(x => JSON.stringify(x)).join('\n') + '\n';
const cp = (round, tip, start, exposure) => ({ round, tip, counted: tip - 1, start, claimEnd: start + 2,
  end: start + 5, exposure, hash: 'b'.repeat(64) });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-snapshot-read-test-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'journal.ndjson'), active = path.join(directory, 'active');
  const records = [{ type: 'identity', identity },
    { type: 'intent', action: { kind: 'lock', args: { amount: '0.1' }, round: 399 }, checkpoint: cp(399, 972096, 972092, '0') },
    { type: 'observed', action: { kind: 'lock', args: { amount: '0.1' }, round: 399 }, checkpoint: cp(399, 972096, 972092, '10000000') },
    { type: 'intent', action: { kind: 'mine_claim', args: { level: 1000 }, round: 400 }, checkpoint: cp(400, 972098, 972098, '10000000') },
    { type: 'halt', intentWritten: true }];
  fs.writeFileSync(file, encode(records), { mode: 0o600 });
  const options = { directory, address };
  appendRound400Abandon({ ...options, confirmation: inspectRound400Abandon(options).confirmation, acknowledgement: ROUND400_FORFEIT_ACK });
  fs.appendFileSync(file, encode([legacy, halt]));
  return { directory, file, active, options };
}
const bytes = x => fs.readFileSync(x.file);
const records = x => bytes(x).toString().trimEnd().split('\n').map(JSON.parse);
const save = (x, r) => fs.writeFileSync(x.file, encode(r));
const parse = x => validateLiveHistory({ ...parseLiveJournalBytes(bytes(x), identity), address });
const inspect = x => inspectSnapshotRead(x.options);
const apply = x => appendSnapshotRead({ ...x.options, confirmation: inspect(x).confirmation });
function rejectsWithoutMutation(x, fn) {
  const before = bytes(x), lease = fs.existsSync(x.active);
  assert.throws(fn); assert.deepEqual(bytes(x), before); assert.equal(fs.existsSync(x.active), lease);
}
function invoke(args) {
  const out = [], errors = [], log = console.log, error = console.error;
  try { console.log = s => out.push(s); console.error = s => errors.push(s); return { code: main(args), out, errors }; }
  finally { console.log = log; console.error = error; }
}
test('exact target stays blocked until explicit confirmed append; inspection reads only', t => {
  const x = fixture(t), before = bytes(x), ino = fs.statSync(x.file).ino;
  assert.throws(() => parse(x));
  const plan = inspect(x);
  assert.equal(plan.confirmation, snapshotReadToken(createHash('sha256').update(before).digest('hex')));
  assert.equal(plan.cause, 'unknown'); assert.equal(plan.outcome, 'unknown');
  assert.equal(plan.workerStartAuthorized, false); assert.equal(plan.retryForbiddenRound, 400);
  assert.deepEqual(bytes(x), before); assert.equal(fs.existsSync(x.active), false);
  const result = apply(x);
  assert.equal(result.workerStarted, false); assert.equal(result.workerStartAuthorized, false);
  assert.equal(result.leaseReleased, true); assert.equal(result.cause, 'unknown');
  assert.equal(fs.statSync(x.file).ino, ino); assert.deepEqual(bytes(x).subarray(0, before.length), before);
  assert.equal(records(x).at(-1).type, 'reconcile_snapshot_read');
  const state = parse(x);
  assert.equal(state.lockAttempted, true); assert.equal(state.claimRound, 400); assert.equal(state.minimumFutureRound, 401);
  assert.deepEqual(state.last, records(x)[3].checkpoint);
  assert.equal(records(x).filter(r => r.type === 'observed').length, 1);
  assert.equal(fs.existsSync(x.active), false);
  rejectsWithoutMutation(x, () => apply(x));
});
for (const [name, mutate] of Object.entries({
  'another stage': r => r.at(-1).failureStage = 'snapshot-validation',
  'monotonicity': r => r.at(-1).failureStage = 'snapshot-monotonicity',
  'journal intent uncertainty': r => r.at(-1).failureStage = 'journal-intent',
  'submission': r => r.at(-1).failureStage = 'submission',
  'true flag': r => r.at(-1).intentWritten = true,
  'string flag': r => r.at(-1).intentWritten = 'false',
  'missing flag': r => delete r.at(-1).intentWritten,
  'extra halt field': r => r.at(-1).extra = false,
  'missing legacy': r => r.splice(-2, 1),
  'two legacy': r => r.splice(-1, 0, legacy),
  'two snapshot halts': r => r.push(halt),
  'no snapshot': r => r.pop(),
  'pending intent': r => r.splice(-1, 0, structuredClone(r[3])),
  'hold': r => r.splice(-1, 0, { type: 'reconciliation_hold' }),
  'forged abandonment': r => r[5].outcome = 'failed',
  'forged original audit': r => r[5].journalSha256 = 'd'.repeat(64),
  'wrong identity': r => r[0].identity = { ...identity, address: 'c'.repeat(64) },
})) test(`target rejects ${name} without mutation`, t => {
  const x = fixture(t), r = records(x); mutate(r); save(x, r);
  rejectsWithoutMutation(x, () => inspect(x)); rejectsWithoutMutation(x, () => apply(x));
  if (name === 'no snapshot') assert.equal(parse(x).minimumFutureRound, 401); // Existing legacy compatibility unchanged.
  else assert.throws(() => parse(x));
});
test('whitespace binds full bytes, stale token rejected before lease', t => {
  const x = fixture(t), plan = inspect(x);
  fs.writeFileSync(x.file, ' ' + bytes(x));
  // This also changes the independently audited abandonment prefix: invalid, not normalized away.
  rejectsWithoutMutation(x, () => appendSnapshotRead({ ...x.options, confirmation: plan.confirmation }));
});
test('target whitespace after abandonment is valid but invalidates old confirmation', t => {
  const x = fixture(t), plan = inspect(x), lines = bytes(x).toString().trimEnd().split('\n');
  lines[lines.length - 1] = ' ' + lines.at(-1); fs.writeFileSync(x.file, lines.join('\n') + '\n');
  assert.notEqual(inspect(x).confirmation, plan.confirmation);
  rejectsWithoutMutation(x, () => appendSnapshotRead({ ...x.options, confirmation: plan.confirmation }));
  assert.equal(apply(x).appended, true);
});
for (const kind of ['directory', 'nonempty', 'file', 'symlink']) test(`never takes over existing ${kind} lease`, t => {
  const x = fixture(t);
  if (['directory', 'nonempty'].includes(kind)) fs.mkdirSync(x.active, { mode: 0o700 });
  if (kind === 'nonempty') fs.writeFileSync(path.join(x.active, 'owner'), 'other');
  if (kind === 'file') fs.writeFileSync(x.active, 'other');
  if (kind === 'symlink') fs.symlinkSync('/nonexistent', x.active);
  const ino = fs.lstatSync(x.active).ino, before = bytes(x);
  assert.equal(inspect(x).leasePresent, true); assert.throws(() => apply(x));
  assert.equal(fs.lstatSync(x.active).ino, ino); assert.deepEqual(bytes(x), before);
});
for (const [name, mutate] of Object.entries({
  hash: r => r.journalSha256 = 'c'.repeat(64), token: r => r.confirmation += 'x',
  stage: r => r.preservedHalt.failureStage = 'snapshot-validation', cause: r => r.cause = 'network',
  outcome: r => r.outcome = 'failed', retry: r => r.retryForbiddenRound = 401,
  future: r => r.minimumFutureRound = 400, startup: r => r.workerStartAuthorized = true,
  identity: r => r.identity.address = 'c'.repeat(64), extra: r => r.extra = true,
})) test(`parser rejects forged reconciliation ${name}`, t => {
  const x = fixture(t); apply(x); const r = records(x); mutate(r.at(-1)); save(x, r); assert.throws(() => parse(x));
});
test('no metadata, duplicate audit, later halt and replay400 remain blocked', t => {
  const x = fixture(t); apply(x); const original = records(x);
  assert.throws(() => validateLiveHistory({ history: original.slice(1), address }));
  for (const tail of [original.at(-1), legacy, halt, original[3]]) {
    save(x, [...original, tail]); assert.throws(() => parse(x));
  }
});
test('future normal history survives reopen; unchanged round400 produces no dispatch', async t => {
  const x = fixture(t); apply(x);
  const parsed = parseLiveJournalBytes(bytes(x), identity), calls = [];
  const journal = { ...parsed, append: r => { calls.push(r); } };
  const port = { readSnapshot: async () => ({ address, minimum: '10000000', tipHash: 'b'.repeat(64), bits: { lock: 0, claim: 0 },
    status: { address, balance: '1', deposit: '0.1', exits: [], tip: 972099, counted: 972098,
      mine: { round: 400, start: 972098, claim_end: 972100, end: 972103, window_open: true },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null } }), prepare: deny, solve: deny, verifySigned: deny, submit: deny };
  const worker = new LiveWorker({ port, journal, address });
  assert.deepEqual(await worker.step(), { kind: 'wait', reason: 'abandoned-round-no-retry' }); assert.deepEqual(calls, []);
  const action = { kind: 'mine_claim', args: { level: 1000 }, round: 401 }, checkpoint = cp(401, 972104, 972104, '10000000');
  fs.appendFileSync(x.file, encode([{ type: 'intent', action, checkpoint }, { type: 'observed', action, checkpoint }]));
  assert.equal(parse(x).claimRound, 401); assert.equal(parse(x).lockAttempted, true);
  fs.appendFileSync(x.file, encode([halt])); assert.throws(() => parse(x)); rejectsWithoutMutation(x, () => inspect(x));
});
for (const failure of ['zero-write', 'partial-write', 'directory-fsync', 'file-fsync', 'close', 'rmdir', 'release-fsync', 'extra-post-write'])
  test(`uncertain ${failure} never reports success and retains blocking lease`, t => {
    const x = fixture(t), options = { ...x.options, confirmation: inspect(x).confirmation };
    const originals = { open: fs.openSync, write: fs.writeSync, sync: fs.fsyncSync, close: fs.closeSync, rmdir: fs.rmdirSync };
    let fd, writes = 0, syncs = 0, injected = false;
    try {
      fs.openSync = (p, flags, ...args) => {
        const n = originals.open(p, flags, ...args);
        if (typeof flags === 'number' && (flags & fs.constants.O_APPEND)) fd = n;
        return n;
      };
      fs.writeSync = (...args) => {
        writes++;
        if (failure === 'zero-write') { injected = true; return 0; }
        if (failure === 'partial-write') {
          if (writes > 1) { injected = true; throw Error('synthetic write'); }
          args[3] = Math.min(args[3], 3);
        }
        return originals.write(...args);
      };
      fs.fsyncSync = (...args) => {
        syncs++;
        if ((failure === 'directory-fsync' && syncs === 1) || (failure === 'file-fsync' && syncs === 2) ||
            (failure === 'release-fsync' && syncs === 3)) { injected = true; throw Error('synthetic sync'); }
        const result = originals.sync(...args);
        if (failure === 'extra-post-write' && syncs === 2) { injected = true; fs.appendFileSync(x.file, encode([legacy])); }
        return result;
      };
      fs.closeSync = n => {
        if (failure === 'close' && writes && n === fd && !injected) { injected = true; throw Error('synthetic close'); }
        return originals.close(n);
      };
      fs.rmdirSync = p => {
        if (failure === 'rmdir') { injected = true; throw Error('synthetic release'); }
        return originals.rmdir(p);
      };
      assert.throws(() => appendSnapshotRead(options)); assert.equal(injected, true);
    } finally {
      fs.openSync = originals.open; fs.writeSync = originals.write; fs.fsyncSync = originals.sync;
      fs.closeSync = originals.close; fs.rmdirSync = originals.rmdir;
    }
    assert.equal(fs.existsSync(x.active), true);
  });
test('CLI explicit inspect/append only; rejects broad options and never starts worker', t => {
  const x = fixture(t), base = ['--journal-dir', x.directory, '--address', address];
  const plan = invoke(base); assert.equal(plan.code, 0);
  const confirmation = JSON.parse(plan.out[0]).confirmation;
  for (const args of [[], [...base, '--confirm', confirmation], [...base, '--append'],
    [...base, '--stage', 'submission'], [...base, '--start'], [...base, '--append', '--append'],
    [...base, '--evidence', '/not-used'], [...base, '--address', address]]) {
    const before = bytes(x); assert.equal(invoke(args).code, 2); assert.deepEqual(bytes(x), before);
  }
  const result = invoke([...base, '--append', '--confirm', confirmation]);
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.out[0]).workerStarted, false);
  const duplicate = invoke([...base, '--append', '--confirm', confirmation]);
  assert.equal(duplicate.code, 2); assert.equal(JSON.parse(duplicate.errors[0]).reconciliationVerified, false);
  assert.equal(JSON.parse(duplicate.errors[0]).auditAppendOutcome, 'unknown-check-manually-do-not-retry');
});

for (const stage of ['snapshot-consistency', 'policy-decision', 'prepare', 'solve', 'signed-verification',
  'observation-validation', 'journal-observed', 'startup-history', 'startup-signer-load', 'startup-unlock',
  'startup-wallet-identity', 'startup-backend', 'unknown']) test(`never reconciles stage ${stage}`, t => {
  const x = fixture(t), r = records(x); r.at(-1).failureStage = stage; save(x, r);
  rejectsWithoutMutation(x, () => inspect(x)); assert.throws(() => parse(x));
});
test('missing or malformed audit metadata stays blocked', t => {
  const x = fixture(t); apply(x); const p = parseLiveJournalBytes(bytes(x), identity);
  for (const audit of [undefined, {}, { ...p.audit, prefixSha256: [] },
    { ...p.audit, prefixSha256: p.audit.prefixSha256.map(() => 'c'.repeat(64)) }])
    assert.throws(() => validateLiveHistory({ history: p.history, address, audit }));
});
test('journal bytes changed during lease acquisition are not appended; lease retained', t => {
  const x = fixture(t), options = { ...x.options, confirmation: inspect(x).confirmation }, mkdir = fs.mkdirSync;
  let injected = false;
  try {
    fs.mkdirSync = (p, ...args) => {
      const r = mkdir(p, ...args);
      if (String(p).endsWith('/active')) { fs.appendFileSync(x.file, encode([legacy])); injected = true; }
      return r;
    };
    assert.throws(() => appendSnapshotRead(options)); assert.equal(injected, true);
  } finally { fs.mkdirSync = mkdir; }
  assert.equal(fs.existsSync(x.active), true);
  assert.equal(records(x).some(r => r.type === 'reconcile_snapshot_read'), false);
});
test('wrong manual confirmation cannot acquire lease', t => {
  const x = fixture(t);
  for (const confirmation of [undefined, '', 'yes', snapshotReadToken('c'.repeat(64))])
    rejectsWithoutMutation(x, () => appendSnapshotRead({ ...x.options, confirmation }));
  assert.equal(fs.existsSync(x.active), false);
});
test('dashboard reads the same audit without writes or worker startup', async t => {
  const { inspectDashboardJournal } = await import('../lib/worker-dashboard-journal.mjs');
  const x = fixture(t); assert.throws(() => inspectDashboardJournal(x.directory, address));
  apply(x); const before = bytes(x);
  const result = inspectDashboardJournal(x.directory, address);
  assert.equal(result.leasePresent, false); assert.equal(result.lastObserved.round, 399);
  assert.deepEqual(bytes(x), before); assert.equal(fs.existsSync(x.active), false);
});

test('audit metadata hashes exactly all bytes before reconciliation line', t => {
  const x = fixture(t), before = bytes(x); apply(x);
  const p = parseLiveJournalBytes(bytes(x), identity), i = p.history.length - 1;
  assert.equal(p.history[i].type, 'reconcile_snapshot_read');
  assert.equal(p.audit.prefixSha256[i], createHash('sha256').update(before).digest('hex'));
  assert.equal(p.history[i].journalSha256, p.audit.prefixSha256[i]);
});
test('synthetic manually constructed round401 worker can claim once, never relock', async t => {
  const { openLiveJournal } = await import('../lib/worker-live-journal.mjs');
  const x = fixture(t); apply(x); const calls = [];
  const snapshot = { address, minimum: '10000000', tipHash: 'b'.repeat(64), bits: { lock: 0, claim: 0 },
    status: { address, balance: '1', deposit: '0.1', exits: [], tip: 972104, counted: 972103,
      mine: { round: 401, start: 972104, claim_end: 972106, end: 972109, window_open: true },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null } };
  const port = { readSnapshot: async () => structuredClone(snapshot),
    prepare: async action => { calls.push(action); return {}; }, solve: async () => ({}), verifySigned: async () => true,
    submit: async () => { snapshot.status.claim = { deposit: '0.1', level: 1000 }; return { ok: true }; } };
  let journal = openLiveJournal(x.directory, { identity });
  const action = await new LiveWorker({ port, journal, address }).step(); journal.close();
  assert.deepEqual(action, { kind: 'mine_claim', args: { level: 1000 }, round: 401 });
  snapshot.status.claim = null; journal = openLiveJournal(x.directory, { identity });
  assert.equal((await new LiveWorker({ port, journal, address }).step()).reason, 'already-attempted'); journal.close();
  assert.deepEqual(calls, [action]); assert.equal(parse(x).claimRound, 401);
});
test('post-append verification read failure retains lease and reports no success', t => {
  const x = fixture(t), options = { ...x.options, confirmation: inspect(x).confirmation }, read = fs.readSync;
  const originalSize = fs.statSync(x.file).size;
  let injected = false;
  try {
    fs.readSync = (...args) => {
      if (fs.fstatSync(args[0]).size > originalSize) {
        injected = true; throw Error('synthetic verification read failure');
      }
      return read(...args);
    };
    assert.throws(() => appendSnapshotRead(options)); assert.equal(injected, true);
  } finally { fs.readSync = read; }
  assert.equal(fs.existsSync(x.active), true); assert.equal(records(x).at(-1).type, 'reconcile_snapshot_read');
});
