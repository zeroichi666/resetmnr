import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../bin/reset-reconcile-round400.mjs';
import { ROUND400_FORFEIT_ACK, ROUND400_GATEWAY, ROUND400_PIN } from '../lib/round400-abandon-policy.mjs';
const address = 'a'.repeat(64);
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-round400-test-cli-'));
  fs.chmodSync(directory, 0o700); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const identity = { address, gateway: ROUND400_GATEWAY, pin: ROUND400_PIN };
  const checkpoint = { round: 399, tip: 972096, counted: 972095, hash: 'b'.repeat(64), start: 972092, claimEnd: 972094, end: 972097, exposure: '0' };
  const lock = { kind: 'lock', args: { amount: '0.1' }, round: 399 };
  const records = [{ type: 'identity', identity }, { type: 'intent', action: lock, checkpoint },
    { type: 'observed', action: lock, checkpoint: { ...checkpoint, exposure: '10000000' } },
    { type: 'intent', action: { kind: 'mine_claim', args: { level: 1000 }, round: 400 },
      checkpoint: { ...checkpoint, round: 400, tip: 972098, counted: 972097, start: 972098, claimEnd: 972100, end: 972103, exposure: '10000000' } },
    { type: 'halt', intentWritten: true }];
  const file = path.join(directory, 'journal.ndjson'); fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  return { directory, file, base: ['--journal-dir', directory, '--address', address] };
}
function invoke(args) {
  const out = [], errors = [], log = console.log, error = console.error;
  console.log = s => out.push(s); console.error = s => errors.push(s);
  try { return { code: main(args), out, errors }; }
  finally { console.log = log; console.error = error; }
}
test('CLI abandon inspection needs no status and writes no journal or lease', t => {
  const x = fixture(t), before = fs.readFileSync(x.file), r = invoke([...x.base, '--abandon']);
  assert.equal(r.code, 0); const plan = JSON.parse(r.out[0]);
  assert.equal(plan.outcome, 'unknown'); assert.equal(plan.acknowledgementRequired, ROUND400_FORFEIT_ACK);
  assert.equal(plan.minimumFutureRound, 401); assert.equal(plan.manualStartRequired, true);
  assert.equal('record' in plan, false); assert.deepEqual(fs.readFileSync(x.file), before);
  assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
});
test('CLI append requires separate exact token and forfeiture acknowledgment, never starts worker', t => {
  const x = fixture(t), plan = JSON.parse(invoke([...x.base, '--abandon']).out[0]);
  const r = invoke([...x.base, '--append-abandon', '--confirm', plan.confirmation, '--acknowledge-forfeit', ROUND400_FORFEIT_ACK]);
  assert.equal(r.code, 0); const result = JSON.parse(r.out[0]);
  assert.equal(result.leaseReleased, true); assert.equal(result.workerStarted, false);
  assert.equal(result.minimumFutureRound, 401); assert.equal(result.outcome, 'unknown');
  assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
  const records = fs.readFileSync(x.file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(records.at(-1).type, 'abandon_claim'); assert.equal(records.at(-2).type, 'halt');
  assert.equal(records.filter(r => r.type === 'observed').length, 1);
});
const badModes = [
  ['--abandon', '--append-abandon'], ['--abandon', '--append-hold'], ['--append-abandon', '--append-hold'],
  ['--abandon', '--abandon'], ['--append-abandon'],
  ['--append-abandon', '--confirm', 'yes'],
  ['--append-abandon', '--acknowledge-forfeit', ROUND400_FORFEIT_ACK],
  ['--abandon', '--evidence', '/not/read/status.json'],
  ['--abandon', '--confirm', 'yes'],
  ['--abandon', '--acknowledge-forfeit', ROUND400_FORFEIT_ACK],
  ['--resume'], ['--force'], ['--abandon', '--address', address],
];
for (const [i, args] of badModes.entries()) test(`CLI rejects unsafe/mixed/duplicate abandon arguments ${i}`, t => {
  const x = fixture(t), before = fs.readFileSync(x.file), r = invoke([...x.base, ...args]);
  assert.equal(r.code, 2); assert.deepEqual(fs.readFileSync(x.file), before);
  assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
});
test('CLI rejects a wrong acknowledgment without creating a lease', t => {
  const x = fixture(t), plan = JSON.parse(invoke([...x.base, '--abandon']).out[0]);
  const r = invoke([...x.base, '--append-abandon', '--confirm', plan.confirmation, '--acknowledge-forfeit', 'yes']);
  assert.equal(r.code, 2); assert.equal(fs.existsSync(path.join(x.directory, 'active')), false);
  const error = JSON.parse(r.errors[0]); assert.equal(error.reconciliationVerified, false);
  assert.equal(error.auditAppendOutcome, 'unknown-check-manually-do-not-retry');
  assert.equal('workerBlocked' in error, false); assert.equal('appended' in error, false);
});
test('CLI reports but never removes an existing lease', t => {
  const x = fixture(t), active = path.join(x.directory, 'active'); fs.mkdirSync(active, { mode: 0o700 });
  const ino = fs.statSync(active).ino, plan = JSON.parse(invoke([...x.base, '--abandon']).out[0]);
  assert.equal(plan.leasePresent, true);
  const r = invoke([...x.base, '--append-abandon', '--confirm', plan.confirmation, '--acknowledge-forfeit', ROUND400_FORFEIT_ACK]);
  assert.equal(r.code, 2); assert.equal(fs.statSync(active).ino, ino);
});
test('CLI help describes unknown outcome and independent manual start', () => {
  const r = invoke(['--help']); assert.equal(r.code, 0);
  assert.match(r.out[0], /UNKNOWN/); assert.match(r.out[0], /forfeit/i); assert.match(r.out[0], /MANUAL/);
});
