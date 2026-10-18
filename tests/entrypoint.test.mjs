import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, PIN, SIGNER, WALLET_DIRECTORY } from '../lib/paths.mjs';
import { verifyUpstream } from '../lib/verify-upstream.mjs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const entrypoint = fileURLToPath(new URL('../bin/reset-safe.mjs', import.meta.url));
const fakePassword = 'FAKE-entrypoint-test-credential';
const run = args => spawnSync(process.execPath, [entrypoint, ...args], {
  cwd: ROOT, encoding: 'utf8', timeout: 10000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot }
});
test('public pin and runtime pin agree; official signer tree is clean', () => {
  const metadata = JSON.parse(readFileSync(new URL('../UPSTREAM.json', import.meta.url)));
  assert.equal(metadata.commit, PIN);
  assert.equal(verifyUpstream(), PIN);
  assert.equal(WALLET_DIRECTORY, join(homedir(), '.reset-signer'));
  assert.ok(SIGNER.endsWith(join('signer', 'bin', 'reset-signer.mjs')));
});
test('entrypoint rejects command or wallet override arguments before startup', () => {
  for (const args of [['--command', 'anything'], ['--directory', '/tmp/other-wallet'], ['transfer']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /failed to start/);
    assert.ok(!result.stderr.includes(fakePassword));
  }
});
test('entrypoint without password fails closed rather than prompting on MCP stdin', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /failed to start/);
});
