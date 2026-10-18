import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { UPSTREAM, SIGNER, PIN } from './paths.mjs';

export function verifyUpstream() {
  if (process.platform === 'win32') throw new Error('Use WSL2 with its Linux filesystem; native Windows wallet mode checks are unsupported.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  if (!existsSync(SIGNER)) throw new Error('Run the setup script first.');
  // No shell, command-line options, or environment-controlled executable path.
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' });
  const git = args => execFileSync('git', ['-C', UPSTREAM, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true });
  if (git(['rev-parse', 'HEAD']).trim() !== PIN) throw new Error('Unexpected upstream revision.');
  if (git(['status', '--porcelain', '--untracked-files=all', '--', 'signer']).trim()) throw new Error('Upstream signer files changed.');
  return PIN;
}
