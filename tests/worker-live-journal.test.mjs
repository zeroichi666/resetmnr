import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLiveJournal, LIVE_JOURNAL_LIMIT } from '../lib/worker-live-journal.mjs';

const identity = { address: 'a'.repeat(64), gateway: 'https://reset.openmayhem.ai', pin: 'b'.repeat(40) };
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-live-journal-')); fs.chmodSync(d, 0o700); return d; };
const clean = d => fs.rmSync(d, { recursive: true, force: true });
const jf = d => path.join(d, 'journal.ndjson');
const active = d => path.join(d, 'active');
const seed = (d, content) => { fs.writeFileSync(jf(d), content); fs.chmodSync(jf(d), 0o600); };

test('missing directory is created non-recursively and history excludes identity', () => {
  const parent = tmp(); const d = path.join(parent, 'new');
  try { const j = openLiveJournal(d, { identity }); assert.deepEqual(j.history, []); j.append({ type: 'intent', nested: { ok: true } }); j.close(); assert.equal(fs.statSync(d).mode & 0o777, 0o700); const again = openLiveJournal(d, { identity }); assert.deepEqual(again.history, [{ type: 'intent', nested: { ok: true } }]); again.close(); }
  finally { clean(parent); }
});

test('pin mismatch and malformed identity are refused while retaining lease', () => {
  const d = tmp(); try { const j = openLiveJournal(d, { identity }); j.close(); assert.throws(() => openLiveJournal(d, { identity: { ...identity, pin: 'c'.repeat(40) } }), /mismatch/); assert.throws(() => openLiveJournal(d, { identity: { address: identity.address, gateway: identity.gateway } }), /invalid/); } finally { clean(d); }
});

test('duplicate and stale/crash leases are refused without deletion', () => {
  const d = tmp(); try { const one = openLiveJournal(d, { identity }); assert.throws(() => openLiveJournal(d, { identity }), /lease unavailable/); one.close(); fs.mkdirSync(active(d)); assert.throws(() => openLiveJournal(d, { identity }), /lease unavailable/); assert.equal(fs.statSync(active(d)).isDirectory(), true); } finally { clean(d); }
});

test('directory symlink and journal symlink are refused in fresh directories', () => {
  const parent = tmp(); const target = tmp();
  try { const ds = path.join(parent, 'dir-link'); fs.symlinkSync(target, ds); assert.throws(() => openLiveJournal(ds, { identity }), /symlink|unavailable|ELOOP/); const d = tmp(); try { fs.symlinkSync('/etc/passwd', jf(d)); assert.throws(() => openLiveJournal(d, { identity }), /symlink|unavailable|ELOOP/); assert.ok(fs.existsSync(active(d))); } finally { clean(d); } } finally { clean(parent); clean(target); }
});

test('unsafe mode, hardlink, and ownership-like file conditions are refused', () => {
  for (const setup of [
    d => { seed(d, JSON.stringify({ type: 'identity', identity }) + '\n'); fs.chmodSync(jf(d), 0o644); },
    d => { seed(d, JSON.stringify({ type: 'identity', identity }) + '\n'); fs.linkSync(jf(d), path.join(d, 'other')); },
  ]) { const d = tmp(); try { setup(d); assert.throws(() => openLiveJournal(d, { identity }), /mode|hard-linked/); } finally { clean(d); } }
});

test('malformed, truncated, total oversize, and record oversize journals refuse and retain lease', () => {
  const contents = [
    JSON.stringify({ type: 'identity', identity }),
    JSON.stringify({ type: 'identity', identity }) + '\nnot-json\n',
    JSON.stringify({ type: 'identity', identity }) + '\n' + JSON.stringify({ data: 'x'.repeat(70_000) }) + '\n',
    JSON.stringify({ type: 'identity', identity }) + '\n' + ('x'.repeat(LIVE_JOURNAL_LIMIT) + '\n'),
  ];
  for (const content of contents) { const d = tmp(); try { seed(d, content); assert.throws(() => openLiveJournal(d, { identity })); assert.ok(fs.existsSync(active(d))); } finally { clean(d); } }
});

test('append clones records, enforces record and total limits, and append-after-close fails', () => {
  const d = tmp(); try { const j = openLiveJournal(d, { identity }); const value = { type: 'intent', nested: { ok: true } }; j.append(value); value.nested.ok = false; assert.deepEqual(j.history, [{ type: 'intent', nested: { ok: true } }]); assert.throws(() => j.append({ data: 'x'.repeat(70_000) }), /size/); assert.throws(() => j.append({ data: 'x'.repeat(LIVE_JOURNAL_LIMIT) }), /size/); j.close(); assert.throws(() => j.append({ type: 'late' }), /closed/); } finally { clean(d); }
});

test('fsync failure poisons journal and close retains lease', () => {
  const d = tmp(); const original = fs.fsyncSync;
  try { const j = openLiveJournal(d, { identity }); fs.fsyncSync = () => { throw new Error('injected fsync'); }; assert.throws(() => j.append({ type: 'intent' }), /write failed/); assert.throws(() => j.close(), /poisoned|retained/); assert.ok(fs.existsSync(active(d))); } finally { fs.fsyncSync = original; clean(d); }
});

test('existing zero-byte journal is never silently reinitialized', () => {
  const d = tmp();
  try {
    fs.writeFileSync(jf(d), '', { mode: 0o600 });
    assert.throws(() => openLiveJournal(d, { identity }), /empty journal/);
    assert.equal(fs.statSync(jf(d)).size, 0);
    assert.ok(fs.existsSync(path.join(d, 'active')));
  } finally { clean(d); }
});

test('short writes are completed before append returns and persist on reopen', () => {
  const d = tmp(); const original = fs.writeSync;
  try {
    const j = openLiveJournal(d, { identity }); let writes = 0;
    fs.writeSync = function(fd, buffer, offset, length, position) {
      writes++; return original.call(this, fd, buffer, offset, Math.min(length, 3), position);
    };
    try { j.append({ type: 'synthetic', note: 'complete record' }); }
    finally { fs.writeSync = original; }
    assert.ok(writes > 1); j.close();
    const next = openLiveJournal(d, { identity });
    assert.deepEqual(next.history, [{ type: 'synthetic', note: 'complete record' }]); next.close();
  } finally { fs.writeSync = original; clean(d); }
});

test('zero-byte write poisons journal, prevents acceptance and retains lease', () => {
  const d = tmp(); const original = fs.writeSync;
  try {
    const j = openLiveJournal(d, { identity }); fs.writeSync = () => 0;
    try { assert.throws(() => j.append({ type: 'synthetic' }), /short write/); }
    finally { fs.writeSync = original; }
    assert.deepEqual(j.history, []); assert.throws(() => j.close(), /poisoned/);
    assert.ok(fs.existsSync(path.join(d, 'active')));
  } finally { fs.writeSync = original; clean(d); }
});

test('adapter uses durable journal across clean restart and blocks ambiguous replay', async () => {
  const { LiveWorker } = await import('../lib/worker-live.mjs');
  const { Simulation } = await import('../lib/worker-simulation.mjs');
  const d = tmp(); const sim = new Simulation(); let action, sends = 0;
  const port = {
    async readSnapshot() { return { address: identity.address, minimum: '10000000', tipHash: 'c'.repeat(64),
      bits: { lock: 0, claim: 0 }, status: await sim.status() }; },
    async prepare(a) { action = a; return {}; },
    async solve() { return { synthetic: true }; }, async verifySigned() { return true; },
    async submit() { sends++; return sim.perform(action); }
  };
  try {
    let journal = openLiveJournal(d, { identity });
    let worker = new LiveWorker({ journal, port, address: identity.address });
    assert.equal((await worker.step()).kind, 'lock'); journal.close();
    journal = openLiveJournal(d, { identity });
    worker = new LiveWorker({ journal, port, address: identity.address });
    port.submit = async () => { sends++; await sim.perform(action); throw new Error('synthetic response lost'); };
    await assert.rejects(worker.step(), /halted/); journal.close();
    journal = openLiveJournal(d, { identity });
    assert.throws(() => new LiveWorker({ journal, port, address: identity.address }), /halted/);
    assert.equal(sends, 2); journal.close();
  } finally { clean(d); }
});
