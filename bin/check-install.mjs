#!/usr/bin/env node
import { verifyUpstream } from '../lib/verify-upstream.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UPSTREAM } from '../lib/paths.mjs';
try {
  const commit = verifyUpstream();
  if (!existsSync(join(UPSTREAM, 'signer', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'))) throw new Error('Signer dependencies are missing.');
  console.log(JSON.stringify({ upstreamCommit: commit, node: process.version, platform: process.platform, architecture: process.arch, walletOpened: false, participationWorker: false }, null, 2));
} catch {
  console.error('Installation check failed. Verify prerequisites, pin, clean signer files, and npm ci locally.');
  process.exitCode = 1;
}
