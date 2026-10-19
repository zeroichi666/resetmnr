import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectDashboardJournal } from '../lib/worker-dashboard-journal.mjs';
import { createDashboardController } from '../lib/worker-dashboard-controller.mjs';
import { parseLiveJournalBytes } from '../lib/worker-live-journal.mjs';
import { validateLiveHistory } from '../lib/worker-live.mjs';
import { PIN } from '../lib/paths.mjs';
import { ROUND400_FORFEIT_ACK, round400AbandonToken } from '../lib/round400-abandon-policy.mjs';

const address = 'a'.repeat(64);
const identity = { address, gateway: 'https://reset.openmayhem.ai', pin: PIN };
const cp = (round, tip, start, exposure) => ({ round, tip, counted: tip - 1,
  hash: 'b'.repeat(64), start, claimEnd: start + 2, end: start + 5, exposure });
const encode = records => records.map(r => JSON.stringify(r) + '\n').join('');
function fixture(t, { whitespace = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-dashboard-audit-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'journal.ndjson');
  const lock = { kind: 'lock', args: { amount: '0.1' }, round: 399 };
  const intent = { type: 'intent', action: { kind: 'mine_claim', args: { level: 1000 }, round: 400 },
    checkpoint: cp(400, 972098, 972098, '10000000') };
  const prefix = [{ type: 'identity', identity },
    { type: 'intent', action: lock, checkpoint: cp(399, 972096, 972092, '0') },
    { type: 'observed', action: lock, checkpoint: cp(399, 972096, 972092, '10000000') },
    intent, { type: 'halt', intentWritten: true }];
  const rawPrefix = whitespace ? prefix.map(r => `  ${JSON.stringify(r)} \t\n`).join('') : encode(prefix);
  const journalSha256 = createHash('sha256').update(rawPrefix).digest('hex');
  const abandon = { type: 'abandon_claim', version: 1, identity, action: intent.action,
    checkpoint: intent.checkpoint, journalSha256, confirmation: round400AbandonToken(journalSha256),
    acknowledgement: ROUND400_FORFEIT_ACK, outcome: 'unknown', retryForbiddenRound: 400, futureRoundsOnly: true };
  fs.writeFileSync(file, rawPrefix + encode([abandon]), { mode: 0o600 });
  return { directory, file, active: path.join(directory, 'active'), prefix, abandon };
}
const state = x => validateLiveHistory({ ...parseLiveJournalBytes(fs.readFileSync(x.file), identity), address });
const dashboardStatus = x => createDashboardController({ address,
  inspectJournal: () => inspectDashboardJournal(x.directory, address),
  openSession: () => { assert.fail('Inspection must never open a session'); } }).status();
function observeUnchanged(x, run) {
  const before = fs.readFileSync(x.file), st = fs.statSync(x.file), entries = fs.readdirSync(x.directory);
  const result = run();
  assert.deepEqual(fs.readFileSync(x.file), before);
  assert.equal(fs.statSync(x.file).ino, st.ino);
  assert.equal(fs.statSync(x.file).mtimeMs, st.mtimeMs);
  assert.deepEqual(fs.readdirSync(x.directory), entries);
  return result;
}

for (const whitespace of [false, true]) test(`dashboard accepts audited round400 abandon without lease or relock; raw whitespace=${whitespace}`, t => {
  const x = fixture(t, { whitespace }), before = state(x);
  assert.equal(before.last.exposure, '10000000'); // Exactly 0.1 RESET, not a second lock.
  assert.equal(before.lockAttempted, true);
  assert.equal(before.claimRound, 400);
  assert.equal(before.minimumFutureRound, 401);
  const result = observeUnchanged(x, () => inspectDashboardJournal(x.directory, address));
  assert.deepEqual(result, { leasePresent: false,
    lastObserved: { kind: 'lock', round: 399, exposureUnits: '10000000', tip: 972096 } });
  assert.deepEqual(state(x), before);
  const status = observeUnchanged(x, () => dashboardStatus(x));
  assert.equal(status.phase, 'idle');
  assert.equal(status.blocked, false);
  assert.equal(status.blockReason, null);
  assert.equal(fs.existsSync(x.active), false);
  // The abandon is not a successful claim observation and cannot erase the lock attempt.
  assert.equal(x.abandon.outcome, 'unknown');
  assert.equal(parseLiveJournalBytes(fs.readFileSync(x.file), identity).history.filter(r => r.action?.kind === 'lock' && r.type === 'intent').length, 1);
});

for (const kind of ['directory', 'nonempty-directory', 'file', 'symlink']) test(`dashboard retains existing ${kind} lease after valid abandon`, t => {
  const x = fixture(t);
  if (kind.includes('directory')) fs.mkdirSync(x.active, { mode: 0o700 });
  if (kind === 'nonempty-directory') fs.writeFileSync(path.join(x.active, 'owner'), 'synthetic-owner');
  if (kind === 'file') fs.writeFileSync(x.active, 'synthetic-owner');
  if (kind === 'symlink') fs.symlinkSync('/nonexistent-dashboard-test-lease', x.active);
  const inode = fs.lstatSync(x.active).ino;
  assert.equal(observeUnchanged(x, () => inspectDashboardJournal(x.directory, address)).leasePresent, true);
  assert.equal(observeUnchanged(x, () => dashboardStatus(x)).blocked, true);
  assert.equal(fs.lstatSync(x.active).ino, inode);
});

for (const [name, mutate] of Object.entries({
  'forged hash': x => { x.abandon.journalSha256 = 'd'.repeat(64); },
  'forged confirmation': x => { x.abandon.confirmation = round400AbandonToken('d'.repeat(64)); },
  'false outcome': x => { x.abandon.outcome = 'confirmed-failed'; },
  'retry round changed': x => { x.abandon.retryForbiddenRound = 401; },
  'identity changed': x => { x.abandon.identity = { ...identity, address: 'd'.repeat(64) }; },
  'no acknowledgement': x => { delete x.abandon.acknowledgement; },
  'halt without abandon': x => { x.abandon = null; },
  'pending intent': x => { x.prefix.pop(); x.abandon = null; },
  'hold instead of abandon': x => { x.abandon = { type: 'reconciliation_hold' }; },
  'hold after abandon': x => { x.tail = { type: 'reconciliation_hold' }; },
  'later halt': x => { x.tail = { type: 'halt', intentWritten: false }; },
  'duplicate abandon': x => { x.tail = x.abandon; },
  'round400 replay': x => { x.tail = x.prefix[3]; },
})) test(`dashboard fails closed without mutation: ${name}`, t => {
  const x = fixture(t); mutate(x);
  fs.writeFileSync(x.file, encode([...x.prefix, ...(x.abandon ? [x.abandon] : []), ...(x.tail ? [x.tail] : [])]));
  fs.mkdirSync(x.active, { mode: 0o700 });
  const inode = fs.lstatSync(x.active).ino;
  observeUnchanged(x, () => { assert.throws(() => inspectDashboardJournal(x.directory, address)); });
  assert.throws(() => state(x));
  assert.equal(observeUnchanged(x, () => dashboardStatus(x)).blocked, true);
  assert.equal(fs.lstatSync(x.active).ino, inode);
});

for (const mode of ['stale-prefix', 'duplicate-key', 'extra-blank-line', 'truncated', 'identity-extra-key']) test(`dashboard uses strict worker byte parser: ${mode}`, t => {
  const x = fixture(t);
  let raw = fs.readFileSync(x.file, 'utf8');
  if (mode === 'stale-prefix') raw = ' ' + raw; // Semantically identical JSON, invalid audited raw prefix.
  if (mode === 'duplicate-key') raw = raw.replace('"version":1', '"version":1,"version":1');
  if (mode === 'extra-blank-line') raw += '\n';
  if (mode === 'truncated') raw = raw.slice(0, -1);
  if (mode === 'identity-extra-key') raw = raw.replace('"type":"identity"', '"extra":true,"type":"identity"');
  fs.writeFileSync(x.file, raw);
  observeUnchanged(x, () => { assert.throws(() => inspectDashboardJournal(x.directory, address)); });
  assert.throws(() => state(x));
  assert.equal(observeUnchanged(x, () => dashboardStatus(x)).blocked, true);
  assert.equal(fs.existsSync(x.active), false);
});
