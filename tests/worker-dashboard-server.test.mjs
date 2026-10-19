import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDashboardServer } from '../lib/worker-dashboard-server.mjs';
import { inspectDashboardJournal } from '../lib/worker-dashboard-journal.mjs';
import { PIN } from '../lib/paths.mjs';
const address = 'a'.repeat(64);
function request(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks).toString() })); }); req.on('error', reject); req.end(body); });
}
test('loopback HTTP requires exact Host, same Origin, session token, JSON and confirmation', async t => {
  let starts = 0, stops = 0;
  const controller = { status: () => ({ phase: 'idle', address }), start(p) { assert.deepEqual(p, { address, confirm: true }); starts++; return this.status(); }, stop() { stops++; return this.status(); } };
  const server = createDashboardServer({ controller }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  let r = await request(port, '/api/status'); assert.equal(r.code, 200); const token = JSON.parse(r.raw).csrf; assert.equal(token.length, 64); assert.equal(r.headers['cache-control'], 'no-store');
  const headers = { Origin: origin, 'X-Reset-Token': token, 'Content-Type': 'application/json' };
  for (const h of [{ Host: `evil.test:${port}` }, { Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request(port, '/api/status', { headers: h })).code, 403);
  for (const h of [{}, { ...headers, Origin: 'https://evil.test' }, { ...headers, 'X-Reset-Token': 'x'.repeat(64) }, { ...headers, 'Content-Type': 'text/plain' }, { ...headers, Origin: '' }]) assert.equal((await request(port, '/api/start', { method: 'POST', headers: h, body: JSON.stringify({ address, confirm: true }) })).code, 403);
  assert.equal(starts, 0);
  assert.equal((await request(port, '/api/start', { method: 'POST', headers, body: '{' })).code, 400);
  assert.equal((await request(port, '/api/start', { method: 'POST', headers, body: JSON.stringify({ address, confirm: true }) })).code, 200); assert.equal(starts, 1);
  assert.equal((await request(port, '/api/stop', { method: 'POST', headers, body: '{}' })).code, 200); assert.equal(stops, 1);
  assert.equal((await request(port, '/api/stop', { method: 'POST', headers, body: '{"extra":true}' })).code, 400);
  assert.equal((await request(port, '/api/start')).code, 404);
  assert.equal((await request(port, '/../../package.json')).code, 404);
  assert.equal((await request(port, '/')).code, 200);
});
test('journal inspector is read-only, scoped to matching identity, rejects unsafe files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-dashboard-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'journal'); assert.deepEqual(inspectDashboardJournal(dir, address), { leasePresent: false, lastObserved: null }); assert.equal(fs.existsSync(dir), false);
  fs.mkdirSync(dir, { mode: 0o700 }); const file = path.join(dir, 'journal.ndjson');
  const checkpoint = { round: 399, tip: 2400, counted: 2400, hash: 'f'.repeat(64), start: 2400, claimEnd: 2402, end: 2405, exposure: '10000000' };
  const action = { kind: 'lock', args: { amount: '0.1' }, round: 399 };
  const data = [{ type: 'identity', identity: { address, gateway: 'https://reset.openmayhem.ai', pin: PIN } }, { type: 'intent', action, checkpoint }, { type: 'observed', action, checkpoint }].map(r => JSON.stringify(r) + '\n').join('');
  fs.writeFileSync(file, data, { mode: 0o600 }); const before = fs.readFileSync(file); let result = inspectDashboardJournal(dir, address); assert.equal(result.lastObserved.round, 399); assert.equal(result.lastObserved.exposureUnits, '10000000'); assert.deepEqual(fs.readFileSync(file), before);
  fs.mkdirSync(path.join(dir, 'active')); assert.equal(inspectDashboardJournal(dir, address).leasePresent, true); assert.throws(() => inspectDashboardJournal(dir, 'b'.repeat(64)));
  for (const suffix of [{ type: 'halt', intentWritten: false }, { type: 'unknown' }, { type: 'intent', action: { kind: 'mine_claim', args: { level: 1000 }, round: 399 }, checkpoint }]) {
    fs.writeFileSync(file, data + JSON.stringify(suffix) + '\n'); assert.throws(() => inspectDashboardJournal(dir, address));
  }
  fs.writeFileSync(file, data);
  fs.chmodSync(file, 0o644); assert.throws(() => inspectDashboardJournal(dir, address)); fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, data.slice(0, -1)); assert.throws(() => inspectDashboardJournal(dir, address)); fs.unlinkSync(file); fs.symlinkSync('/etc/passwd', file); assert.throws(() => inspectDashboardJournal(dir, address));
});
test('CLI rejects noninteractive live / override flags before wallet or RESET network', () => {
  for (const args of [[], ['--address', address], ['--demo', '--live'], ['--gateway', 'https://evil.test'], ['--port', '80']]) {
    const child = spawnSync(process.execPath, ['--import', './tests/fixtures/worker-offline-guard.mjs', 'bin/reset-dashboard.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/tmp/reset-dashboard-no-wallet' } });
    assert.equal(child.status, 1); assert.ok(!child.stderr.includes('OFFLINE_GUARD_VIOLATION'));
  }
});
