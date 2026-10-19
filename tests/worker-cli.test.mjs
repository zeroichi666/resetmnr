import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
const entry = new URL('../bin/reset-worker.mjs', import.meta.url);
const guard = new URL('./fixtures/worker-offline-guard.mjs', import.meta.url);
const args = ['--import', guard.pathname, entry.pathname];

test('no mode, live, wallet, gateway, duration and unknown flags refused offline', () => {
  for (const flags of [[], ['--live'], ['--simulate', '--live'], ['--simulate', '--wallet', '/no-wallet'],
    ['--simulate', '--gateway', 'https://invalid.example'], ['--simulate', '--duration', '60'], ['--unknown']]) {
    const r = spawnSync(process.execPath, [...args, ...flags], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /tidak didukung/);
    assert.doesNotMatch(r.stdout + r.stderr, /OFFLINE_GUARD_VIOLATION/);
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) test(`foreground simulator stays active, then exits cleanly on ${signal}`, { timeout: 8000, skip: process.platform === 'win32' }, async t => {
  const child = spawn(process.execPath, [...args, '--simulate'], {
    env: { PATH: process.env.PATH, RESET_SIGNER_PASSWORD: 'FAKE-NOT-TO-BE-READ', RESET_GATEWAY_URL: 'https://invalid.example' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  const exit = once(child, 'exit');
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stderr.on('data', b => { stderr += b; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No simulated claim observed.')), 5000);
    child.stdout.on('data', b => {
      stdout += b;
      if (stdout.includes('SIMULASI mine_claim')) { clearTimeout(timeout); resolve(); }
    });
  });
  assert.equal(child.exitCode, null, 'no self-stop after first pass');
  child.kill(signal);
  const [code, terminated] = await exit;
  assert.equal(code, 0); assert.equal(terminated, null); assert.equal(stderr, '');
  assert.match(stdout, /SIMULASI lock {"amount":"0.1"}/);
  assert.match(stdout, /SIMULASI mine_claim {"level":1000}/);
  assert.match(stdout, /Simulasi berhenti/);
  assert.doesNotMatch(stdout + stderr, /FAKE-NOT-TO-BE-READ|OFFLINE_GUARD_VIOLATION/);
});
test('worker source imports only offline policy/simulation/core and polling utility', () => {
  const files = ['bin/reset-worker.mjs', 'lib/worker-core.mjs', 'lib/worker-policy.mjs', 'lib/worker-simulation.mjs'];
  const allowed = new Set(['node:timers/promises', '../lib/worker-simulation.mjs', '../lib/worker-core.mjs', './worker-policy.mjs', './worker-simulation.mjs']);
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) assert.ok(allowed.has(match[1]), `${file}: ${match[1]}`);
    assert.doesNotMatch(source, /process\.env|setInterval|\.unref\(|https?:\/\/|RESET_SIGNER_PASSWORD/);
  }
});
