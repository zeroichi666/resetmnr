import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LiveWorker, validateLiveHistory } from '../lib/worker-live.mjs';
import { parseLiveJournalBytes, openLiveJournal } from '../lib/worker-live-journal.mjs';
import { ROUND400_FORFEIT_ACK, round400AbandonToken } from '../lib/round400-abandon-policy.mjs';
import { inspectRound400Abandon, appendRound400Abandon } from '../lib/round400-recovery.mjs';
const address = 'a'.repeat(64);
const identity = { address, gateway: 'https://reset.openmayhem.ai', pin: '6132e8653d6342f36673eb7426ec8e064960e48e' };
const hash = 'b'.repeat(64);
const cp = (round, tip, start, exposure) => ({ round, tip, counted: tip - 1, start, claimEnd: start + 2, end: start + 5, exposure, hash });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-round400-abandon-'));
  const directory = path.join(root, 'journal'); fs.mkdirSync(directory, { mode: 0o700 });
  const journalFile = path.join(directory, 'journal.ndjson');
  const records = [{ type: 'identity', identity: structuredClone(identity) },
    { type: 'intent', action: { kind: 'lock', args: { amount: '0.1' }, round: 399 }, checkpoint: cp(399, 972096, 972092, '0') },
    { type: 'observed', action: { kind: 'lock', args: { amount: '0.1' }, round: 399 }, checkpoint: cp(399, 972096, 972092, '10000000') },
    { type: 'intent', action: { kind: 'mine_claim', args: { level: 1000 }, round: 400 }, checkpoint: cp(400, 972098, 972098, '10000000') },
    { type: 'halt', intentWritten: true }];
  const save = () => fs.writeFileSync(journalFile, encode(records), { mode: 0o600 });
  save(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, directory, journalFile, records, save, options: { directory, address }, active: path.join(directory, 'active') };
}
const encode = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const bytes = x => fs.readFileSync(x.journalFile);
const inspect = x => inspectRound400Abandon(x.options);
const append = (x, confirmation, acknowledgement) => appendRound400Abandon({ ...x.options, confirmation, acknowledgement });
const apply = x => append(x, inspect(x).confirmation, ROUND400_FORFEIT_ACK);
const parsed = x => parseLiveJournalBytes(bytes(x), identity);
const state = x => validateLiveHistory({ ...parsed(x), address });
function noMutation(x, fn) { const before = bytes(x); assert.throws(fn); assert.deepEqual(bytes(x), before); }
function rewrite(x, records) { fs.writeFileSync(x.journalFile, encode(records)); }
function syntheticPort() {
  const calls = [];
  const snapshot = { address, minimum: '10000000', tipHash: 'c'.repeat(64), bits: { lock: 0, claim: 0 },
    status: { address, balance: '1', deposit: '0.1', exits: [], tip: 972099, counted: 972098,
      mine: { round: 400, start: 972098, claim_end: 972100, end: 972103, window_open: true },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null } };
  const port = { readSnapshot: async () => structuredClone(snapshot),
    prepare: async action => { calls.push(['prepare', action]); return {}; },
    solve: async () => { calls.push(['synthetic-solve']); return {}; },
    verifySigned: async () => { calls.push(['synthetic-verify']); return true; },
    submit: async () => { calls.push(['synthetic-submit']); snapshot.status.claim = { deposit: '0.1', level: 1000 }; return { ok: true }; } };
  const round = r => {
    const start = 972098 + (r - 400) * 6;
    snapshot.status.tip = start; snapshot.status.counted = start - 1;
    snapshot.status.mine = { round: r, start, claim_end: start + 2, end: start + 5, window_open: true };
    snapshot.status.claim = null;
  };
  return { port, snapshot, calls, round };
}

test('inspection is read-only, outcome unknown, no evidence needed, and token binds ALL raw bytes', t => {
  const x = fixture(t), before = bytes(x), plan = inspect(x);
  assert.equal(plan.journalSha256, createHash('sha256').update(before).digest('hex'));
  assert.equal(plan.confirmation, round400AbandonToken(plan.journalSha256));
  assert.equal(plan.acknowledgementRequired, ROUND400_FORFEIT_ACK); assert.equal(plan.outcome, 'unknown');
  assert.equal(plan.manualStartRequired, true); assert.deepEqual(bytes(x), before); assert.equal(fs.existsSync(x.active), false);
});
test('successful append preserves bytes/inode/intent/halt, consumes 400, and releases only the new lease', t => {
  const x = fixture(t), before = bytes(x), inode = fs.statSync(x.journalFile).ino;
  const result = apply(x);
  assert.equal(result.appended, true); assert.equal(result.leaseReleased, true); assert.equal(result.workerStarted, false);
  assert.equal(result.manualStartRequired, true); assert.equal(result.outcome, 'unknown');
  assert.deepEqual(bytes(x).subarray(0, before.length), before); assert.equal(fs.statSync(x.journalFile).ino, inode);
  assert.equal(fs.existsSync(x.active), false);
  const records = bytes(x).toString().trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(records.slice(0, -1), x.records); assert.equal(records.at(-1).type, 'abandon_claim');
  assert.equal(records.filter(r => r.type === 'observed').length, 1);
  const s = state(x); assert.equal(s.minimumFutureRound, 401); assert.equal(s.claimRound, 400); assert.equal(s.lockAttempted, true);
  assert.deepEqual(s.last, x.records[3].checkpoint);
});
test('whitespace is preserved in the hash, not reconstructed; stale confirmation cannot be reused', t => {
  const x = fixture(t), plan = inspect(x);
  fs.writeFileSync(x.journalFile, ' ' + bytes(x).toString());
  const changed = inspect(x); assert.notEqual(changed.confirmation, plan.confirmation);
  noMutation(x, () => append(x, plan.confirmation, ROUND400_FORFEIT_ACK));
  assert.equal(fs.existsSync(x.active), false); assert.equal(apply(x).appended, true); assert.equal(state(x).claimRound, 400);
});
for (const [name, mutate] of Object.entries({
  'identity address': r => r[0].identity.address = 'c'.repeat(64),
  'identity gateway': r => r[0].identity.gateway = 'https://elsewhere.invalid',
  'identity pin': r => r[0].identity.pin = 'c'.repeat(40),
  'pending lock action': r => { r[3].action = { kind: 'lock', args: { amount: '0.1' }, round: 400 }; },
  'round': r => r[3].action.round = 401,
  'level': r => r[3].action.args.level = 999,
  'exposure': r => r[3].checkpoint.exposure = '9999999',
  'tip': r => r[3].checkpoint.tip++,
  'hash': r => r[3].checkpoint.hash = 'bad',
  'halt false': r => r[4].intentWritten = false,
  'halt missing': r => r.pop(),
  'duplicate halt': r => r.push({ type: 'halt', intentWritten: true }),
  'unknown prefix': r => r.splice(2, 0, { type: 'unknown' }),
  'prior lock tip': r => r[2].checkpoint.tip--,
  'evidence hold is terminal': r => r.push({ type: 'reconciliation_hold' }),
})) test(`reject wrong original target: ${name}`, t => {
  const x = fixture(t); mutate(x.records); x.save(); noMutation(x, () => inspect(x)); assert.equal(fs.existsSync(x.active), false);
});
test('confirmation and forfeiture acknowledgment must both be explicit and exact', t => {
  const x = fixture(t), plan = inspect(x);
  for (const confirmation of [undefined, '', 'yes', plan.confirmation.slice(0, -1), round400AbandonToken('d'.repeat(64))])
    noMutation(x, () => append(x, confirmation, ROUND400_FORFEIT_ACK));
  for (const ack of [undefined, '', 'I ACCEPT', ROUND400_FORFEIT_ACK + ' '])
    noMutation(x, () => append(x, plan.confirmation, ack));
  assert.equal(fs.existsSync(x.active), false);
});
test('duplicate abandon is rejected without appending or creating another lease', t => {
  const x = fixture(t), plan = inspect(x); apply(x);
  noMutation(x, () => append(x, plan.confirmation, ROUND400_FORFEIT_ACK)); assert.equal(fs.existsSync(x.active), false);
});
for (const kind of ['directory', 'nonempty-directory', 'file', 'symlink']) test(`existing ${kind} lease is never taken over`, t => {
  const x = fixture(t), plan = inspect(x);
  if (kind.includes('directory')) fs.mkdirSync(x.active, { mode: 0o700 });
  if (kind === 'nonempty-directory') fs.writeFileSync(path.join(x.active, 'owner'), 'other');
  if (kind === 'file') fs.writeFileSync(x.active, 'other');
  if (kind === 'symlink') fs.symlinkSync('/nonexistent', x.active);
  const inode = fs.lstatSync(x.active).ino;
  noMutation(x, () => append(x, plan.confirmation, ROUND400_FORFEIT_ACK)); assert.equal(fs.lstatSync(x.active).ino, inode);
});
for (const [name, mutate] of Object.entries({
  'hash': r => r.journalSha256 = 'd'.repeat(64),
  'token': r => r.confirmation = round400AbandonToken('d'.repeat(64)),
  'acknowledgment': r => r.acknowledgement = 'yes',
  'outcome': r => r.outcome = 'confirmed-failed',
  'retry round': r => r.retryForbiddenRound = 401,
  'future only': r => r.futureRoundsOnly = false,
  'action': r => r.action.round = 401,
  'checkpoint': r => r.checkpoint.tip++,
  'identity': r => r.identity.address = 'd'.repeat(64),
  'success type': r => r.type = 'observed',
  'unknown key': r => r.success = true,
})) test(`worker parser rejects forged abandonment: ${name}`, t => {
  const x = fixture(t); apply(x); const records = bytes(x).toString().trimEnd().split('\n').map(JSON.parse);
  mutate(records.at(-1)); rewrite(x, records); assert.throws(() => state(x));
});
test('worker parser requires raw-prefix metadata and compares the hash before the actual abandon record', t => {
  const x = fixture(t); apply(x); const p = parsed(x);
  assert.throws(() => validateLiveHistory({ history: p.history, address }));
  p.audit.prefixSha256[p.history.length - 1] = 'd'.repeat(64);
  assert.throws(() => validateLiveHistory({ ...p, address }));
  fs.writeFileSync(x.journalFile, ' ' + bytes(x).toString()); assert.throws(() => state(x));
});
test('ordinary later halts, duplicate abandon records, and injected round400 intents remain blocked', t => {
  for (const tail of ['halt', 'duplicate', 'replay']) {
    const x = fixture(t); apply(x); const records = bytes(x).toString().trimEnd().split('\n').map(JSON.parse);
    records.push(tail === 'halt' ? { type: 'halt', intentWritten: false } : tail === 'duplicate' ? records.at(-1) : x.records[3]);
    rewrite(x, records); assert.throws(() => state(x));
  }
});
test('synthetic manual restarts never dispatch round400; claims401/402 remain level1000 and deduplicated', async t => {
  const x = fixture(t); apply(x); const s = syntheticPort();
  let journal = openLiveJournal(x.directory, { identity });
  let worker = new LiveWorker({ address, port: s.port, journal });
  assert.equal((await worker.step()).reason, 'abandoned-round-no-retry'); assert.deepEqual(s.calls, []); journal.close();
  s.round(401); journal = openLiveJournal(x.directory, { identity }); worker = new LiveWorker({ address, port: s.port, journal });
  assert.equal((await worker.step()).kind, 'mine_claim'); journal.close();
  s.snapshot.status.claim = null; journal = openLiveJournal(x.directory, { identity }); worker = new LiveWorker({ address, port: s.port, journal });
  assert.equal((await worker.step()).reason, 'already-attempted'); journal.close();
  s.round(402); journal = openLiveJournal(x.directory, { identity }); worker = new LiveWorker({ address, port: s.port, journal });
  assert.equal((await worker.step()).kind, 'mine_claim'); journal.close();
  const actions = s.calls.filter(c => c[0] === 'prepare').map(c => c[1]);
  assert.deepEqual(actions.map(a => a.round), [401, 402]); assert.ok(actions.every(a => a.kind === 'mine_claim' && a.args.level === 1000));
  assert.equal(state(x).claimRound, 402); assert.equal(state(x).minimumFutureRound, 401);
});
for (const mode of ['zero', 'partial', 'partial-with-exit', 'all-exit', 'over-cap']) test(`no relock/top-up after abandonment: ${mode}`, async t => {
  const x = fixture(t); apply(x); const s = syntheticPort(); s.round(401);
  if (mode === 'zero') s.snapshot.status.deposit = '0';
  if (mode === 'partial' || mode === 'partial-with-exit') s.snapshot.status.deposit = '0.05';
  if (mode === 'partial-with-exit') s.snapshot.status.exits = [{ amount: '0.05', release: 972200 }];
  if (mode === 'all-exit') { s.snapshot.status.deposit = '0'; s.snapshot.status.exits = [{ amount: '0.1', release: 972200 }]; }
  if (mode === 'over-cap') s.snapshot.status.exits = [{ amount: '0.00000001', release: 972200 }];
  const journal = openLiveJournal(x.directory, { identity }), worker = new LiveWorker({ address, port: s.port, journal });
  if (['partial-with-exit', 'all-exit'].includes(mode)) assert.equal((await worker.step()).kind, 'wait');
  else await assert.rejects(worker.step(), /halted/);
  journal.close(); assert.deepEqual(s.calls, []);
});
test('journal audit hashes survive reopen, include exact raw prefixes, and getters cannot mutate stored metadata', t => {
  const x = fixture(t); apply(x);
  const journal = openLiveJournal(x.directory, { identity });
  const original = journal.audit; original.identity.address = 'e'.repeat(64); original.prefixSha256.fill('bad');
  assert.equal(journal.audit.identity.address, address); assert.ok(journal.audit.prefixSha256.every(h => /^[a-f0-9]{64}$/.test(h)));
  const before = bytes(x); journal.append({ type: 'halt', intentWritten: false });
  assert.equal(journal.audit.prefixSha256.at(-1), createHash('sha256').update(before).digest('hex')); journal.close();
  const reopened = openLiveJournal(x.directory, { identity });
  assert.equal(reopened.audit.prefixSha256.length, reopened.history.length);
  assert.equal(reopened.audit.prefixSha256.at(-1), createHash('sha256').update(before).digest('hex')); reopened.close();
});

for (const failure of ['zero-write', 'partial-write', 'directory-fsync', 'file-fsync', 'close', 'rmdir', 'release-fsync'])
  test(`uncertain ${failure} retains a lease and never reports success`, t => {
    const x = fixture(t), plan = inspect(x), before = bytes(x);
    const write = fs.writeSync, sync = fs.fsyncSync, close = fs.closeSync, rmdir = fs.rmdirSync, open = fs.openSync;
    let writes = 0, syncs = 0, injected = false, wrote = false, appendFd;
    try {
      fs.openSync = (p, flags, ...args) => {
        const fd = open(p, flags, ...args);
        if (typeof flags === 'number' && (flags & fs.constants.O_APPEND) && String(p).endsWith('/journal.ndjson')) appendFd = fd;
        return fd;
      };
      fs.writeSync = (...args) => {
        writes++; wrote = true;
        if (failure === 'zero-write') { injected = true; return 0; }
        if (failure === 'partial-write') {
          if (writes > 1) { injected = true; throw Error('synthetic partial write'); }
          args[3] = Math.min(args[3], 3);
        }
        return write(...args);
      };
      fs.fsyncSync = (...args) => {
        syncs++;
        if ((failure === 'directory-fsync' && syncs === 1) || (failure === 'file-fsync' && syncs === 2) ||
            (failure === 'release-fsync' && syncs === 3)) { injected = true; throw Error('synthetic fsync failure'); }
        return sync(...args);
      };
      fs.closeSync = (...args) => {
        if (failure === 'close' && wrote && args[0] === appendFd && !injected) { injected = true; throw Error('synthetic close failure'); }
        return close(...args);
      };
      fs.rmdirSync = (...args) => {
        if (failure === 'rmdir') { injected = true; throw Error('synthetic rmdir failure'); }
        return rmdir(...args);
      };
      assert.throws(() => append(x, plan.confirmation, ROUND400_FORFEIT_ACK));
    } finally { fs.writeSync = write; fs.fsyncSync = sync; fs.closeSync = close; fs.rmdirSync = rmdir; fs.openSync = open; }
    assert.equal(injected, true); assert.deepEqual(bytes(x).subarray(0, before.length), before);
    assert.ok(fs.existsSync(x.active));
    // A subsequent ordinary journal open must refuse the retained lease, even if abandon was durable.
    assert.throws(() => openLiveJournal(x.directory, { identity }), /lease/);
  });
test('short writes complete successfully without losing bytes', t => {
  const x = fixture(t), plan = inspect(x), write = fs.writeSync; let writes = 0;
  try {
    fs.writeSync = (...args) => { writes++; args[3] = Math.min(args[3], 5); return write(...args); };
    assert.equal(append(x, plan.confirmation, ROUND400_FORFEIT_ACK).leaseReleased, true);
  } finally { fs.writeSync = write; }
  assert.ok(writes > 1); assert.equal(state(x).claimRound, 400);
});
test('a concurrent lease acquisition wins safely without append or deletion', t => {
  const x = fixture(t), plan = inspect(x), before = bytes(x), mkdir = fs.mkdirSync;
  try {
    fs.mkdirSync = (p, options) => {
      if (String(p).endsWith('/active')) { mkdir(p, options); return mkdir(p, options); }
      return mkdir(p, options);
    };
    assert.throws(() => append(x, plan.confirmation, ROUND400_FORFEIT_ACK));
  } finally { fs.mkdirSync = mkdir; }
  assert.deepEqual(bytes(x), before); assert.ok(fs.existsSync(x.active));
});
test('changed or nonempty recovery lease is never released', t => {
  for (const change of ['replacement', 'nonempty']) {
    const x = fixture(t), plan = inspect(x), sync = fs.fsyncSync; let syncs = 0, replacement;
    try {
      fs.fsyncSync = (...args) => {
        const result = sync(...args); syncs++;
        if (syncs === 2) {
          if (change === 'replacement') {
            fs.renameSync(x.active, path.join(x.directory, 'retained-original-lease'));
            fs.mkdirSync(x.active, { mode: 0o700 }); replacement = fs.lstatSync(x.active).ino;
          } else fs.writeFileSync(path.join(x.active, 'other-owner'), 'keep');
        }
        return result;
      };
      assert.throws(() => append(x, plan.confirmation, ROUND400_FORFEIT_ACK), /Lease changed|not empty/);
    } finally { fs.fsyncSync = sync; }
    assert.ok(fs.existsSync(x.active));
    if (change === 'replacement') assert.equal(fs.lstatSync(x.active).ino, replacement);
    else assert.equal(fs.readFileSync(path.join(x.active, 'other-owner'), 'utf8'), 'keep');
    assert.equal(state(x).claimRound, 400); // Durable record, but still blocked by retained lease.
  }
});
test('post-write content tampering fails validation and retains the lease', t => {
  const x = fixture(t), plan = inspect(x), sync = fs.fsyncSync; let syncs = 0;
  try {
    fs.fsyncSync = (...args) => {
      const result = sync(...args); syncs++;
      if (syncs === 2) fs.appendFileSync(x.journalFile, JSON.stringify({ type: 'halt', intentWritten: false }) + '\n');
      return result;
    };
    assert.throws(() => append(x, plan.confirmation, ROUND400_FORFEIT_ACK), /Post-append/);
  } finally { fs.fsyncSync = sync; }
  assert.ok(fs.existsSync(x.active)); assert.throws(() => state(x));
});
