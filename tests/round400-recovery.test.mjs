import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRound400, appendRound400Hold } from '../lib/round400-recovery.mjs';
import { main } from '../bin/reset-reconcile-round400.mjs';
import { LiveWorker } from '../lib/worker-live.mjs';

const address = 'a'.repeat(64), now = 1_800_000_000_000;
const identity = { address, gateway: 'https://reset.openmayhem.ai', pin: '6132e8653d6342f36673eb7426ec8e064960e48e' };
const cp = (round, tip, start, exposure) => ({ round, tip, counted: tip - 1, hash: 'b'.repeat(64), start, claimEnd: start + 2, end: start + 5, exposure });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-round400-test-'));
  const directory = path.join(root, 'journal'); fs.mkdirSync(directory, { mode: 0o700 });
  const journalFile = path.join(directory, 'journal.ndjson'), evidenceFile = path.join(root, 'evidence.json');
  const lock = { kind: 'lock', args: { amount: '0.1' }, round: 399 };
  const action = { kind: 'mine_claim', args: { level: 1000 }, round: 400 };
  const records = [ { type: 'identity', identity: structuredClone(identity) },
    { type: 'intent', action: lock, checkpoint: cp(399, 972096, 972092, '0') },
    { type: 'observed', action: lock, checkpoint: cp(399, 972096, 972092, '10000000') },
    { type: 'intent', action, checkpoint: cp(400, 972098, 972098, '10000000') },
    { type: 'halt', intentWritten: true } ];
  const evidence = { schema: 'reset-round400-status-v1', capturedAt: now - 1000,
    source: 'externally-captured-read-only-status', tipHash: 'c'.repeat(64), ...identity,
    status: { address, balance: '0.10000000', deposit: '0.10000000', exits: [], tip: 972102, counted: 972101,
      mine: { round: 400, start: 972098, claim_end: 972100, end: 972103, window_open: false },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null } };
  const save = () => {
    fs.writeFileSync(journalFile, records.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    fs.writeFileSync(evidenceFile, JSON.stringify(evidence), { mode: 0o600 });
  };
  save(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, directory, journalFile, evidenceFile, records, evidence, save,
    options: { directory, address, evidenceFile, now } };
}
function rejectedWithoutMutation(x, run = () => inspectRound400(x.options)) {
  const before = fs.readFileSync(x.journalFile); assert.throws(run);
  assert.deepEqual(fs.readFileSync(x.journalFile), before);
}
function parserMustBlock(x) {
  let calls = 0; const deny = () => { calls++; throw Error('no port calls permitted'); };
  const port = Object.fromEntries(['readSnapshot', 'prepare', 'solve', 'verifySigned', 'submit'].map(k => [k, deny]));
  const text = fs.readFileSync(x.journalFile, 'utf8');
  if (!text.endsWith('\n')) {
    assert.throws(() => inspectRound400(x.options), /Incomplete journal/);
    assert.equal(calls, 0); return;
  }
  const history = text.trimEnd().split('\n').map(JSON.parse).slice(1);
  assert.throws(() => new LiveWorker({ address, port, journal: { history, append: deny } }), /halted/);
  assert.equal(calls, 0);
}

test('inspection is read-only; exact confirmed annotation preserves every byte and permanently blocks replay', t => {
  const x = fixture(t), before = fs.readFileSync(x.journalFile), stat = fs.statSync(x.journalFile);
  const plan = inspectRound400(x.options);
  assert.equal(plan.workerBlocked, true); assert.equal(plan.replayForbiddenRound, 400);
  assert.equal(plan.leasePresent, false); assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
  assert.deepEqual(fs.readFileSync(x.journalFile), before); parserMustBlock(x);
  const result = appendRound400Hold({ ...x.options, confirmation: plan.confirmation });
  assert.equal(result.workerBlocked, true); assert.equal(result.leaseRetained, true);
  const after = fs.readFileSync(x.journalFile); assert.deepEqual(after.subarray(0, before.length), before);
  assert.equal(fs.statSync(x.journalFile).ino, stat.ino);
  const records = after.toString().trimEnd().split('\n').map(JSON.parse), annotation = records.at(-1);
  assert.equal(annotation.type, 'reconciliation_hold'); assert.equal(annotation.workerBlocked, true);
  assert.equal(annotation.disposition, 'expired-not-observed-in-supplied-status-NOT-finality');
  assert.deepEqual(records.slice(0, -1), x.records);
  assert.equal(records.filter(r => r.type === 'observed').length, 1); // Original lock only.
  const lease = fs.statSync(path.join(x.directory, 'active'));
  assert.equal(lease.mode & 0o777, 0o700); parserMustBlock(x);
  rejectedWithoutMutation(x, () => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }));
  assert.equal(fs.statSync(path.join(x.directory, 'active')).ino, lease.ino);
});

const journalCases = {
  'wrong intent round': r => r[3].action.round = 401,
  'wrong intent action': r => r[3].action.kind = 'lock',
  'wrong level': r => r[3].action.args.level = 1001,
  'wrong intent exposure': r => r[3].checkpoint.exposure = '9999999',
  'wrong intent tip': r => r[3].checkpoint.tip = 972099,
  'wrong checkpoint round': r => r[3].checkpoint.round = 401,
  'extra action argument': r => r[3].action.args.allow_over = true,
  'invalid pending hash': r => r[3].checkpoint.hash = 'bad',
  'invalid pending geometry': r => r[3].checkpoint.claimEnd++,
  'extra checkpoint key': r => r[3].checkpoint.extra = true,
  'counted regression': r => r[3].checkpoint.counted = 972090,
  'unsafe integer': r => r[3].checkpoint.counted = Number.MAX_SAFE_INTEGER + 1,
  'identity address mismatch': r => r[0].identity.address = 'd'.repeat(64),
  'identity gateway mismatch': r => r[0].identity.gateway = 'https://elsewhere.invalid',
  'identity pin mismatch': r => r[0].identity.pin = 'd'.repeat(40),
  'identity extra field': r => r[0].identity.extra = true,
  'wrong observed lock tip': r => r[2].checkpoint.tip = 972095,
  'wrong observed lock exposure': r => r[2].checkpoint.exposure = '9999999',
  'missing lock intent': r => r.splice(1, 1),
  'pending lock instead': r => r.splice(2, 1),
  'halt false': r => r[4].intentWritten = false,
  'halt missing': r => r.pop(),
  'extra halt': r => r.push({ type: 'halt', intentWritten: true }),
  'unknown prefix record': r => r.splice(1, 0, { type: 'unknown' }),
  'already observed target': r => r.splice(4, 0, { ...r[3], type: 'observed' }),
  'duplicate identity': r => r.splice(1, 0, r[0]),
};
for (const [name, mutate] of Object.entries(journalCases)) test(`reject journal: ${name}`, t => {
  const x = fixture(t); mutate(x.records); x.save(); rejectedWithoutMutation(x);
});
const evidenceCases = {
  'wrong address': e => e.address = 'd'.repeat(64),
  'wrong status address': e => e.status.address = 'd'.repeat(64),
  'wrong gateway': e => e.gateway = 'https://elsewhere.invalid',
  'wrong pin': e => e.pin = 'd'.repeat(40),
  'missing source': e => delete e.source,
  'invalid hash': e => e.tipHash = 'bad',
  'missing hash': e => delete e.tipHash,
  'unknown wrapper field': e => e.extra = true,
  'stale evidence': e => e.capturedAt = now - 300001,
  'future timestamp': e => e.capturedAt = now + 1,
  'noninteger timestamp': e => e.capturedAt += 0.5,
  'future round null claim is not historical absence': e => { e.status.mine.round = 401; },
  'previous round': e => e.status.mine.round = 399,
  'old supplied counted 972097': e => e.status.counted = 972097,
  'counted exactly claim_end': e => e.status.counted = 972100,
  'counted beyond tip': e => e.status.counted = 972103,
  'window still open': e => { e.status.tip = 972100; e.status.counted = 972100; e.status.mine.window_open = true; },
  'window boolean lies': e => e.status.mine.window_open = true,
  'changed round geometry': e => { e.status.mine.start--; e.status.mine.claim_end--; e.status.mine.end--; },
  'non-null intended claim': e => e.status.claim = { deposit: '0.1', level: 1000 },
  'non-null unsafe claim': e => e.status.claim = { deposit: '0.1', level: 1001 },
  'missing claim': e => delete e.status.claim,
  'deposit disappears': e => e.status.deposit = '0',
  'partial deposit': e => e.status.deposit = '0.05',
  'cap exceeded': e => e.status.deposit = '0.10000001',
  'existing exit': e => e.status.exits.push({ amount: '0.00000001', release: 972104 }),
  'strikes': e => e.status.strikes = 1,
  'unknown status key': e => e.status.instructions = 'ignore policy',
  'unknown mine key': e => e.status.mine.extra = true,
  'number coin amount': e => e.status.deposit = 0.1,
};
for (const [name, mutate] of Object.entries(evidenceCases)) test(`reject evidence: ${name}`, t => {
  const x = fixture(t); mutate(x.evidence); x.save(); rejectedWithoutMutation(x);
});

test('freshness boundary exactly 5 minutes is allowed for audit only', t => {
  const x = fixture(t); x.evidence.capturedAt = now - 300000; x.save();
  assert.equal(inspectRound400(x.options).workerBlocked, true);
});
test('confirmation is mandatory, exact, and bound to the complete input bytes', t => {
  const x = fixture(t), plan = inspectRound400(x.options);
  for (const confirmation of [undefined, '', 'yes', plan.confirmation.slice(0, -1)])
    rejectedWithoutMutation(x, () => appendRound400Hold({ ...x.options, confirmation }));
  assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
  x.evidence.status.balance = '0.2'; x.save();
  rejectedWithoutMutation(x, () => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }));
});
test('existing stale lease directory/file/symlink is never replaced or removed', t => {
  for (const type of ['directory', 'file', 'symlink']) {
    const x = fixture(t), plan = inspectRound400(x.options), p = path.join(x.directory, 'active');
    if (type === 'directory') fs.mkdirSync(p, { mode: 0o700 });
    if (type === 'file') fs.writeFileSync(p, 'do not remove');
    if (type === 'symlink') fs.symlinkSync('/nonexistent', p);
    const before = fs.lstatSync(p);
    assert.equal(inspectRound400(x.options).leasePresent, true);
    rejectedWithoutMutation(x, () => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }));
    assert.equal(fs.lstatSync(p).ino, before.ino);
  }
});
for (const what of ['directory-mode', 'journal-mode', 'evidence-mode', 'hardlink', 'journal-symlink', 'directory-symlink', 'evidence-symlink', 'ownership'])
  test(`reject unsafe filesystem: ${what}`, t => {
    const x = fixture(t);
    if (what === 'directory-mode') fs.chmodSync(x.directory, 0o755);
    if (what === 'journal-mode') fs.chmodSync(x.journalFile, 0o644);
    if (what === 'evidence-mode') fs.chmodSync(x.evidenceFile, 0o644);
    if (what === 'hardlink') fs.linkSync(x.journalFile, path.join(x.root, 'other'));
    if (what === 'journal-symlink') { fs.renameSync(x.journalFile, path.join(x.root, 'original')); fs.symlinkSync(path.join(x.root, 'original'), x.journalFile); }
    if (what === 'directory-symlink') { const alias = path.join(x.root, 'alias'); fs.symlinkSync(x.directory, alias); x.options.directory = alias; }
    if (what === 'evidence-symlink') { const alias = path.join(x.root, 'alias'); fs.symlinkSync(x.evidenceFile, alias); x.options.evidenceFile = alias; }
    const original = fs.fstatSync;
    try {
      if (what === 'ownership') fs.fstatSync = (...args) => { const st = original(...args); st.uid = process.getuid() + 1; return st; };
      rejectedWithoutMutation(x);
    } finally { fs.fstatSync = original; }
  });
for (const content of ['', '{bad}\n', 'null\n', '[]\n', '\xff\n', 'x'.repeat(1024 * 1024 + 1)])
  test(`reject malformed journal ${JSON.stringify(content.slice(0, 12))}`, t => {
    const x = fixture(t); fs.writeFileSync(x.journalFile, content); rejectedWithoutMutation(x);
  });
test('truncated, blank, CRLF, oversized individual record, and malformed evidence refuse', t => {
  for (const variant of ['truncate', 'blank', 'crlf', 'record-limit', 'evidence']) {
    const x = fixture(t), bytes = fs.readFileSync(x.journalFile);
    if (variant === 'truncate') fs.writeFileSync(x.journalFile, bytes.subarray(0, -1));
    if (variant === 'blank') fs.appendFileSync(x.journalFile, '\n');
    if (variant === 'crlf') fs.writeFileSync(x.journalFile, bytes.toString().replaceAll('\n', '\r\n'));
    if (variant === 'record-limit') fs.appendFileSync(x.journalFile, JSON.stringify({ data: 'x'.repeat(65536) }) + '\n');
    if (variant === 'evidence') fs.writeFileSync(x.evidenceFile, '{oops');
    rejectedWithoutMutation(x);
  }
});
test('partial writes complete; zero write/fsync failures retain durable block and original prefix', t => {
  for (const failure of ['short', 'zero', 'partial-then-error', 'fsync']) {
    const x = fixture(t), before = fs.readFileSync(x.journalFile), plan = inspectRound400(x.options);
    const write = fs.writeSync, sync = fs.fsyncSync; let writes = 0, syncs = 0;
    try {
      fs.writeSync = (...args) => {
        writes++;
        if (failure === 'zero') return 0;
        if (failure === 'partial-then-error' && writes > 1) throw Error('synthetic disk failure');
        if (failure === 'short' || failure === 'partial-then-error') args[3] = Math.min(args[3], 3);
        return write(...args);
      };
      fs.fsyncSync = (...args) => { syncs++; if (failure === 'fsync' && syncs === 2) throw Error('synthetic fsync'); return sync(...args); };
      const run = () => appendRound400Hold({ ...x.options, confirmation: plan.confirmation });
      if (failure === 'short') { assert.equal(run().workerBlocked, true); assert.ok(writes > 1); }
      else assert.throws(run);
    } finally { fs.writeSync = write; fs.fsyncSync = sync; }
    assert.deepEqual(fs.readFileSync(x.journalFile).subarray(0, before.length), before);
    assert.ok(fs.existsSync(path.join(x.directory, 'active'))); parserMustBlock(x);
  }
});
test('concurrent lease acquisition loses safely; changed inputs after acquisition retain hold', t => {
  for (const race of ['lease', 'journal', 'evidence']) {
    const x = fixture(t), plan = inspectRound400(x.options), mkdir = fs.mkdirSync;
    try {
      fs.mkdirSync = (p, options) => {
        if (String(p).endsWith('/active')) {
          if (race === 'lease') { mkdir(p, options); return mkdir(p, options); }
          const result = mkdir(p, options);
          if (race === 'journal') fs.appendFileSync(x.journalFile, JSON.stringify({ type: 'halt', intentWritten: false }) + '\n');
          else fs.appendFileSync(x.evidenceFile, ' ');
          return result;
        }
        return mkdir(p, options);
      };
      assert.throws(() => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }));
    } finally { fs.mkdirSync = mkdir; }
    assert.ok(fs.existsSync(path.join(x.directory, 'active'))); parserMustBlock(x);
    assert.equal(fs.readFileSync(x.journalFile, 'utf8').includes('reconciliation_hold'), false);
  }
});
test('CLI validates all arguments, has no implicit paths or resume/worker options', t => {
  const originalLog = console.log, originalError = console.error; console.log = console.error = () => {};
  try {
    for (const args of [[], ['--resume'], ['--append-hold'], ['--journal-dir'], ['--help', '--resume'],
      ['--address', address, '--address', address], ['--confirm', 'yes']]) assert.equal(main(args), 2);
    assert.equal(main(['--help']), 0);
    const x = fixture(t); x.evidence.capturedAt = Date.now(); x.save();
    const args = ['--journal-dir', x.directory, '--address', address, '--evidence', x.evidenceFile];
    assert.equal(main(args), 0); assert.equal(main([...args, '--append-hold']), 2);
    assert.equal(main([...args, '--append-hold', '--confirm', 'yes']), 2);
    assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
  } finally { console.log = originalLog; console.error = originalError; }
});
test('offline guard rejects network and child processes when loaded', async () => {
  if (!process.execArgv.some(a => a.includes('round400-offline-guard'))) return;
  assert.throws(() => fetch('https://reset.openmayhem.ai'), /OFFLINE_GUARD/);
  const { spawn } = await import('node:child_process'); assert.throws(() => spawn('node'), /OFFLINE_GUARD/);
});

for (const where of ['journal', 'evidence']) test(`duplicate JSON keys are rejected in ${where}`, t => {
  const x = fixture(t);
  if (where === 'journal') {
    const text = fs.readFileSync(x.journalFile, 'utf8').replace('"round":400', '"round":401,"round":400');
    fs.writeFileSync(x.journalFile, text);
  } else {
    const text = fs.readFileSync(x.evidenceFile, 'utf8').replace('"claim":null', '"claim":{"level":1000},"claim":null');
    fs.writeFileSync(x.evidenceFile, text);
  }
  rejectedWithoutMutation(x);
});
test('evidence paths must be absolute and canonical', t => {
  const x = fixture(t);
  for (const evidenceFile of ['evidence.json', `${x.root}/../${path.basename(x.root)}/evidence.json`])
    rejectedWithoutMutation(x, () => inspectRound400({ ...x.options, evidenceFile }));
});
test('invalid UTF-8 is rejected rather than silently replaced', t => {
  const x = fixture(t); fs.writeFileSync(x.journalFile, Buffer.from([0xff, 0x0a])); rejectedWithoutMutation(x);
});
test('same-length in-place mutation immediately before append is detected by byte recheck', t => {
  const x = fixture(t), plan = inspectRound400(x.options), lstat = fs.lstatSync;
  let injected = false;
  try {
    fs.lstatSync = (p, ...args) => {
      const st = lstat(p, ...args);
      if (!injected && String(p).startsWith('/proc/self/fd/') && String(p).endsWith('/journal.ndjson')) {
        injected = true;
        const before = fs.readFileSync(x.journalFile, 'utf8');
        fs.writeFileSync(x.journalFile, before.replace('"level":1000', '"level":1001'));
      }
      return st;
    };
    assert.throws(() => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }), /changed/);
  } finally { fs.lstatSync = lstat; }
  assert.equal(injected, true); assert.ok(fs.existsSync(path.join(x.directory, 'active')));
  assert.equal(fs.readFileSync(x.journalFile, 'utf8').includes('reconciliation_hold'), false);
});
test('fsync failure immediately after acquiring hold never removes it or appends', t => {
  const x = fixture(t), plan = inspectRound400(x.options), before = fs.readFileSync(x.journalFile), sync = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw Error('synthetic directory fsync failure'); };
    assert.throws(() => appendRound400Hold({ ...x.options, confirmation: plan.confirmation }), /fsync/);
  } finally { fs.fsyncSync = sync; }
  assert.deepEqual(fs.readFileSync(x.journalFile), before); assert.ok(fs.existsSync(path.join(x.directory, 'active')));
});
test('CLI errors do not claim append definitely failed or blocking was verified', t => {
  const errors = [], original = console.error; console.error = s => errors.push(JSON.parse(s));
  try {
    assert.equal(main(['--append-hold']), 2);
    assert.equal(errors[0].reconciliationVerified, false);
    assert.equal(errors[0].workerStartAuthorized, false);
    assert.equal(errors[0].auditAppendOutcome, 'unknown-check-manually-do-not-retry');
    assert.equal('workerBlocked' in errors[0], false); assert.equal('appended' in errors[0], false);
  } finally { console.error = original; }
});
