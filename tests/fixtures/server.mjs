// Test fixture ONLY. Never opens the real wallet or uses the network.
import { appendFileSync, writeFileSync } from 'node:fs';
import { Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema, McpError } from '../../lib/sdk.mjs';
const log = entry => appendFileSync(process.env.TEST_AUDIT, JSON.stringify(entry) + '\n', { mode: 0o600 });
writeFileSync(process.env.TEST_PID, String(process.pid), { mode: 0o600 });
log({ event: 'env', passwordReceived: Boolean(process.env.RESET_SIGNER_PASSWORD), unrelatedReceived: Boolean(process.env.UNRELATED_TEST_SECRET), gatewayOverrideReceived: Boolean(process.env.RESET_GATEWAY_URL), nodeOptionsReceived: Boolean(process.env.NODE_OPTIONS) });
process.stderr.write(`PRIVATE ${process.env.RESET_SIGNER_PASSWORD}\n`);
if (process.env.TEST_MODE === 'stubborn') {
  process.stdin.resume(); process.stdin.on('end', () => {});
  process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
}
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} }, instructions: 'UNSAFE CHILD INSTRUCTIONS' });
const definition = name => ({ name, description: `fixture ${name}`, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: name !== 'post_headers' } });
server.setRequestHandler(ListToolsRequestSchema, async request => {
  log({ event: 'list', cursor: request.params?.cursor });
  if (process.env.TEST_MODE === 'crash') setTimeout(() => process.exit(3), 100);
  if (process.env.TEST_MODE === 'missing') return { tools: [definition('rules')] };
  if (process.env.TEST_MODE === 'duplicate') return { tools: [definition('rules'), definition('rules')] };
  if (process.env.TEST_MODE === 'cursor-loop') return { tools: [], nextCursor: 'loop' };
  if (!request.params?.cursor) return { tools: ['rules', 'status', 'transfer', 'lottery_guess', 'unknown'].map(definition), nextCursor: 'second' };
  return { tools: ['address', 'post_headers', 'lock', 'unlock', 'withdraw', 'mine_claim'].map(definition) };
});
server.setRequestHandler(CallToolRequestSchema, async request => {
  const name = request.params.name;
  log({ event: 'call', name, params: request.params });
  if (process.env.TEST_MODE === 'delay') await new Promise(r => setTimeout(r, 500));
  if (name === 'status' && process.env.TEST_MODE === 'rpc-error') throw new McpError(-32010, `fixture error ${process.env.RESET_SIGNER_PASSWORD}`, { detail: process.env.RESET_SIGNER_PASSWORD, keep: 42 });
  if (name === 'rules') return { content: [{ type: 'text', text: 'fixture rules' }], _meta: { test: true } };
  if (name === 'status') return { content: [{ type: 'text', text: 'fixture status' }], structuredContent: { balance: '0', nested: { ok: true } } };
  if (name === 'address') return { content: [{ type: 'text', text: `address ${process.env.RESET_SIGNER_PASSWORD}` }], structuredContent: { secret: process.env.RESET_SIGNER_PASSWORD }, _meta: { nested: [process.env.RESET_SIGNER_PASSWORD] } };
  return { isError: true, content: [{ type: 'text', text: 'fixture tool error' }] };
});
await server.connect(new StdioServerTransport());
if (process.env.TEST_MODE !== 'stubborn') process.stdin.on('end', () => { void server.close(); });
