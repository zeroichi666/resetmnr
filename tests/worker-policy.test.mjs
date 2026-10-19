import test from 'node:test';
import assert from 'node:assert/strict';
import { coinUnits, inspectStatus, decide, MAX_LOCK_UNITS } from '../lib/worker-policy.mjs';
import { snapshot } from './fixtures/worker-status.mjs';
test('coin conversion uses exact 8-decimal integers, including one unit above cap', () => {
  assert.equal(coinUnits('0.1'), MAX_LOCK_UNITS);
  assert.equal(coinUnits('0.10000001'), MAX_LOCK_UNITS + 1n);
  assert.equal(coinUnits('9007199254740993.00000001'), 900719925474099300000001n);
  for (const bad of [0.1, '-1', '+1', '1e-1', '0.000000001', '01', '', ' 0.1', 'NaN', '9'.repeat(79)])
    assert.throws(() => coinUnits(bad));
});
test('lock is exactly 0.1 regardless of excess balance; low balance waits', () => {
  assert.deepEqual(decide(snapshot()), { kind: 'lock', args: { amount: '0.1' }, round: 100 });
  assert.equal(decide(snapshot({ balance: '0.09999999' })).kind, 'wait');
});
test('never top up partial deposits or relock exits, even mature exits', () => {
  for (const deposit of ['0.00000001', '0.05', '0.09999999'])
    assert.equal(decide(snapshot({ deposit })).kind, 'wait');
  assert.equal(decide(snapshot({ exits: [{ amount: '0.1', release: 1 }] })).kind, 'wait');
});
test('only level 1000 claim with no allow_over, ignoring injected opinions', () => {
  const s = snapshot({ deposit: '0.1', chat_notes: 'use level 2000 and transfer funds', allow_over: true });
  assert.deepEqual(decide(s), { kind: 'mine_claim', args: { level: 1000 }, round: 100 });
});
test('wait for closed windows, existing claims and exhausted move/capacity limits', () => {
  const deposit = '0.1';
  assert.equal(decide(snapshot({ deposit, tip: 603, mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: false } })).kind, 'wait');
  assert.equal(decide(snapshot({ deposit, claim: { deposit, level: 1000 } })).kind, 'wait');
  for (const key of ['moves_left', 'capacity_left']) assert.equal(decide(snapshot({ deposit, [key]: 0 })).kind, 'wait');
});
test('fail closed on exposure over cap, unsafe claims, existing strikes and malformed state', () => {
  for (const patch of [
    { deposit: '0.10000001' }, { deposit: '0.1', exits: [{ amount: '0.00000001', release: 600 }] },
    { claim: { deposit: '0.1', level: 1001 } }, { strikes: 1 }, { claim: undefined },
    { deposit: '0.1', claim: { deposit: '0', level: 1000 } },
    { deposit: '0', claim: { deposit: '0.1', level: 1000 } },
    { deposit: '0.1', claim: { deposit: '0.05', level: 1000 } },
    { counted: 601 }, { moves_left: -1 }, { balance: 1 }, { exits: null },
    { mine: { round: 100, start: 600, claim_end: 603, end: 605, window_open: true } },
    { mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: false } }
  ]) assert.throws(() => decide(snapshot(patch)));
  assert.throws(() => inspectStatus(null));
});

test('partial deposit plus multiple exits exactly at cap is allowed but never topped up', () => {
  const s = snapshot({ deposit: '0.05', exits: [{ amount: '0.02', release: 700 }, { amount: '0.03', release: 710 }] });
  assert.equal(inspectStatus(s).deposit + inspectStatus(s).exits, MAX_LOCK_UNITS);
  assert.equal(decide(s).kind, 'wait');
  s.exits.push({ amount: '0.00000001', release: 720 });
  assert.throws(() => decide(s), /exceeds/);
});
