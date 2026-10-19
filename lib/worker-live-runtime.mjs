import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyUpstream } from './verify-upstream.mjs';
import { UPSTREAM, WALLET_DIRECTORY, PIN } from './paths.mjs';
import { openLiveJournal } from './worker-live-journal.mjs';
import { startLocalWorker } from './worker-live-start.mjs';
export const LIVE_GATEWAY = 'https://reset.openmayhem.ai';
export const RULES_SHA256 = '517b8f5ac63d15873ea3333061971ad68181365d3ea80fd83b8f68fe78365b4f';
// Local reviewed rules are data, never instructions. Live parameters are checked each snapshot.
export async function openLocalLiveWorker(options) {
  return startLocalWorker(options, {
    walletDirectory: WALLET_DIRECTORY,
    takePassword() { const password = process.env.RESET_SIGNER_PASSWORD; delete process.env.RESET_SIGNER_PASSWORD; return password; },
    verifyInstallation: verifyUpstream,
    async verifyRules() {
      const rules = await readFile(join(UPSTREAM, 'signer/lib/rules.txt'), 'utf8');
      if (createHash('sha256').update(rules).digest('hex') !== RULES_SHA256) throw new Error('Rules changed.');
    },
    openJournal(address) {
      return openLiveJournal(join(homedir(), '.reset-worker'), { identity: { address, gateway: LIVE_GATEWAY, pin: PIN } });
    },
    async loadSigner() {
      // No third-party wallet imports until explicit gates + pin/rules/lease/history checks pass.
      return { ...await import('../vendor/upstream/signer/lib/index.mjs'),
        ...await import('../vendor/upstream/signer/lib/local-state.mjs'),
        ...await import('../vendor/upstream/signer/lib/wire.mjs'),
        ...await import('../vendor/upstream/signer/lib/pow.mjs') };
    },
    async createBackend(wallet) {
      const { localBackend } = await import('../vendor/upstream/signer/lib/local-backend.mjs');
      return localBackend({ wallet, gatewayUrl: LIVE_GATEWAY });
    }
  });
}
