import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StdioClientTransport, EmptyResultSchema } from '../lib/sdk.mjs';
import { ALLOWED } from '../lib/allowlist-core.mjs';
const FIXTURE = fileURLToPath(new URL('./fixtures/launch.mjs', import.meta.url));
const fakePassword = 'FAKE-password-only-for-tests-903';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function setup(t, mode = '', { connect = true, password = fakePassword } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'reset-allowlist-test-'));
  const audit = join(dir, 'audit'); const pidFile = join(dir, 'pid');
  const transport = new StdioClientTransport({ command: process.execPath, args: [FIXTURE],
    env: { RESET_SIGNER_PASSWORD: password, TEST_AUDIT: audit, TEST_PID: pidFile, TEST_MODE: mode,
      UNRELATED_TEST_SECRET: 'unrelated-fake-secret', RESET_GATEWAY_URL: 'https://invalid.example' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'test-client', version: '1' });
  const events = () => existsSync(audit) ? readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const pid = () => existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null;
  t.after(async () => { await client.close(); await transport.close(); if (pid()) { for (let i = 0; i < 60 && alive(pid()); i++) await sleep(100); assert.equal(alive(pid()), false, 'child must be gone'); } assert.ok(!stderr.includes(fakePassword), 'no password on stderr'); rmSync(dir, { recursive: true, force: true }); });
  if (connect) await client.connect(transport, { timeout: 5000 });
  return { client, transport, events, pid, stderr: () => stderr };
}

test('filtered paginated list preserves schemas and annotations; child instructions hidden', async t => {
  const { client, events } = await setup(t);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(x => x.name), ALLOWED);
  for (const tool of listed.tools) {
    assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
    assert.equal(tool.description, `fixture ${tool.name}`);
    assert.equal(tool.annotations.readOnlyHint, tool.name !== 'post_headers');
  }
  assert.ok(!client.getInstructions().includes('UNSAFE CHILD'));
  assert.equal(events().filter(x => x.event === 'list').length, 2);
});

test('all four allowed calls reach child; content, structured results, metadata and tool errors retained', async t => {
  const { client, events } = await setup(t);
  assert.deepEqual(await client.callTool({ name: 'rules', arguments: {} }), { content: [{ type: 'text', text: 'fixture rules' }], _meta: { test: true } });
  const status = await client.callTool({ name: 'status' });
  assert.deepEqual(status.structuredContent, { balance: '0', nested: { ok: true } });
  const address = await client.callTool({ name: 'address', arguments: {}, _meta: { ignored: 'not forwarded' } });
  assert.equal(address.content[0].text, 'address [REDACTED]');
  assert.equal(address.structuredContent.secret, '[REDACTED]');
  assert.deepEqual(address._meta.nested, ['[REDACTED]']);
  assert.deepEqual(await client.callTool({ name: 'post_headers', arguments: {} }), { isError: true, content: [{ type: 'text', text: 'fixture tool error' }] });
  const calls = events().filter(x => x.event === 'call');
  assert.deepEqual(calls.map(x => x.name), ALLOWED);
  assert.deepEqual(calls[2].params, { name: 'address', arguments: {} });
});

test('funds tools, lottery, unknown tools, argument smuggling and unknown RPC methods never reach child', async t => {
  const { client, events } = await setup(t);
  for (const name of ['transfer', 'lock', 'unlock', 'withdraw', 'mine_claim', 'lottery_guess', 'journal', 'chat_send', 'sign', 'export_key', 'UNKNOWN', '__proto__', 'constructor'])
    await assert.rejects(client.callTool({ name, arguments: {} }), /blocked/);
  for (const args of [{ amount: '1' }, { to: 'attacker' }, { target: 123 }, { name: 'transfer' }])
    await assert.rejects(client.callTool({ name: 'status', arguments: args }), /empty argument/);
  await assert.rejects(client.request({ method: 'reset/transfer', params: {} }, EmptyResultSchema));
  assert.deepEqual(events().filter(x => x.event === 'call'), []);
});

test('RPC error code and data retained while credential text is redacted', async t => {
  const { client } = await setup(t, 'rpc-error');
  await assert.rejects(client.callTool({ name: 'status', arguments: {} }), error => {
    assert.equal(error.code, -32010); assert.ok(error.message.includes('[REDACTED]')); assert.ok(!error.message.includes(fakePassword));
    assert.deepEqual(error.data, { detail: '[REDACTED]', keep: 42 }); return true;
  });
});

test('child environment includes only signer password and safe environment, not unrelated secrets or gateway override', async t => {
  const { events } = await setup(t);
  assert.deepEqual(events()[0], { event: 'env', passwordReceived: true, unrelatedReceived: false, gatewayOverrideReceived: false, nodeOptionsReceived: false });
});

test('concurrent calls fail closed without reaching child twice', async t => {
  const { client, events } = await setup(t, 'delay');
  const first = client.callTool({ name: 'rules', arguments: {} });
  await sleep(100);
  await assert.rejects(client.callTool({ name: 'status', arguments: {} }), /Another RESET call/);
  await first;
  assert.equal(events().filter(x => x.event === 'call').length, 1);
});

for (const mode of ['missing', 'duplicate', 'cursor-loop']) test(`startup fails closed for ${mode} tools and child is reaped`, async t => {
  const { client, transport } = await setup(t, mode, { connect: false });
  await assert.rejects(client.connect(transport, { timeout: 5000 }));
});

test('missing password fails before spawning child', async t => {
  const { client, transport, pid } = await setup(t, '', { connect: false, password: '' });
  await assert.rejects(client.connect(transport, { timeout: 5000 }));
  assert.equal(pid(), null);
});

for (const signal of ['EOF', 'SIGTERM', 'SIGINT']) test(`shutdown ${signal} cleans up child`, { skip: process.platform === 'win32' && signal !== 'EOF' }, async t => {
  const { client, transport, pid } = await setup(t);
  const childPid = pid();
  assert.ok(alive(childPid));
  if (signal === 'EOF') await client.close(); else process.kill(transport.pid, signal);
  for (let i = 0; i < 60 && alive(childPid); i++) await sleep(100);
  assert.equal(alive(childPid), false);
});

test('shutdown escalates for child ignoring EOF and SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const { client, pid } = await setup(t, 'stubborn');
  await client.close();
  for (let i = 0; i < 70 && alive(pid()); i++) await sleep(100);
  assert.equal(alive(pid()), false);
});

test('unexpected child exit closes wrapper connection', async t => {
  const { transport, pid } = await setup(t, 'crash');
  const wrapperPid = transport.pid;
  for (let i = 0; i < 40 && alive(wrapperPid); i++) await sleep(100);
  assert.equal(alive(pid()), false); assert.equal(alive(wrapperPid), false);
});
