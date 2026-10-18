#!/usr/bin/env node
import { verifyUpstream } from '../lib/verify-upstream.mjs';

try {
  if (process.argv.length !== 2) throw new Error('Arguments are not supported.');
  verifyUpstream();
  // Delay loading third-party SDK code until upstream source checks have passed.
  const { startAllowlist } = await import('../lib/allowlist-core.mjs');
  await startAllowlist();
} catch {
  // Raw exceptions, stderr and environment values can contain credentials.
  process.stderr.write('RESET safe MCP failed to start. Check the pinned install and secure password locally.\n');
  process.exitCode = 1;
}
