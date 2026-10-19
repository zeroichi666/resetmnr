import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const entry = new URL('../bin/reset-worker-live.mjs', import.meta.url).pathname;
const guard = new URL('./fixtures/worker-offline-guard.mjs', import.meta.url).pathname;
const mock = new URL('./fixtures/worker-live-mock-preload.mjs', import.meta.url).pathname;
const valid = ['--live', '--confirm-real-transactions', '--address', 'a'.repeat(64)];
test('help and all invalid gates exit offline before runtime import', () => {
  const help = spawnSync(process.execPath, ['--import', guard, entry, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /belum dijalankan/);
  for (const flags of [[], ['--live'], valid, [...valid, '--duration', '60'], [...valid, '--gateway', 'https://invalid.example'],
    [...valid, '--wallet', '/synthetic-only'], [...valid.slice(0, 3), 'bad']]) {
    const r = spawnSync(process.execPath, ['--import', guard, entry, ...flags], {
      env: { PATH: process.env.PATH, RESET_SIGNER_PASSWORD: 'FAKE' }, encoding: 'utf8', timeout: 3000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /Ditolak sebelum akses/);
    assert.doesNotMatch(r.stdout + r.stderr, /OFFLINE_GUARD_VIOLATION|FAKE/);
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) test(`foreground CLI with REPLACED MOCK runtime stays active until ${signal}`, { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ['--import', mock, entry, ...valid], {
    env: { PATH: process.env.PATH, RESET_SIGNER_PASSWORD: 'FAKE' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const exit = once(child, 'exit'); t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stderr.on('data', b => { stderr += b; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Mock did not run.')), 2500);
    child.stdout.on('data', b => { stdout += b; if (stdout.includes('LIVE lock')) { clearTimeout(timeout); resolve(); } });
  });
  assert.match(stdout, /MOCK_RUNTIME_ONLY/); assert.equal(child.exitCode, null);
  child.kill(signal); const [code, terminated] = await exit;
  assert.equal(code, 0); assert.equal(terminated, null); assert.equal(stderr, '');
  assert.match(stdout, /MOCK_CLOSED/); assert.doesNotMatch(stdout + stderr, /OFFLINE_GUARD_VIOLATION|FAKE/);
});
test('rules checksum matches reviewed local pinned data without executing signer', async () => {
  const { RULES_SHA256 } = await import('../lib/worker-live-runtime.mjs');
  const rules = readFileSync(new URL('../vendor/upstream/signer/lib/rules.txt', import.meta.url));
  assert.equal(createHash('sha256').update(rules).digest('hex'), RULES_SHA256);
});
test('live runtime never imports MCP agent or shell and CLI has no schedule/restart hooks', () => {
  const runtime = readFileSync(new URL('../lib/worker-live-runtime.mjs', import.meta.url), 'utf8');
  const cli = readFileSync(new URL('../bin/reset-worker-live.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /local-mcp|agent\.mjs|child_process|openai|RESET_GATEWAY_URL|RESET_SIGNER_DIRECTORY/);
  assert.doesNotMatch(cli, /setInterval|\.unref\(|child_process|--duration|--wallet|--gateway/);
});
