#!/usr/bin/env node
// Opening this page never opens a wallet. Only a confirmed Start + TTY password can.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDashboardController } from '../lib/worker-dashboard-controller.mjs';
import { createDashboardServer } from '../lib/worker-dashboard-server.mjs';

const args = process.argv.slice(2);
const help = 'Dashboard lokal: node bin/reset-dashboard.mjs --address <alamat-64-hex>\nDemo offline: node bin/reset-dashboard.mjs --demo\nBuka http://127.0.0.1:4780. Mulai/berhenti manual; Ctrl+C menutup dashboard dan worker miliknya.\n';
const demo = args.length === 1 && args[0] === '--demo';
const live = args.length === 2 && args[0] === '--address' && /^[0-9a-f]{64}$/.test(args[1]);
if (args.length === 1 && args[0] === '--help') process.stdout.write(help);
else if ((!demo && !live) || (live && (!process.stdin.isTTY || !process.stdout.isTTY || process.platform === 'win32'))) {
  process.stderr.write('Ditolak: perlu --demo atau --address 64-hex dan terminal Linux/WSL interaktif. Tidak ada akses wallet/jaringan RESET.\n'); process.exitCode = 1;
} else {
  delete process.env.RESET_SIGNER_PASSWORD; // Never retain inherited credentials while idle.
  const address = demo ? '0'.repeat(64) : args[1];
  let demoRound = 399;
  const controller = createDashboardController({ address, mode: demo ? 'demo' : 'live',
    inspectJournal: demo ? () => ({ leasePresent: false, lastObserved: null }) : () => journalReader(join(homedir(), '.reset-worker'), address),
    openSession: demo ? async ({ signal }) => {
      signal.throwIfAborted(); let stopped = false;
      return { worker: { get stopped() { return stopped; }, stop() { stopped = true; }, async step() { signal.throwIfAborted(); return { kind: 'wait', reason: `demo-ronde-${demoRound++}` }; } }, async close() {} };
    } : async ({ expectedAddress, signal }) => {
      const { readTerminalPassword } = await import('../lib/worker-dashboard-password.mjs');
      let password = await readTerminalPassword({ signal });
      try {
        signal.throwIfAborted();
        const { openLocalLiveWorker } = await import('../lib/worker-live-runtime.mjs');
        signal.throwIfAborted();
        return await openLocalLiveWorker({ expectedAddress, signal, takePassword() { const value = password; password = ''; return value; } });
      } finally { password = ''; delete process.env.RESET_SIGNER_PASSWORD; }
    }
  });
  // This module only reads local journal metadata; it never imports the signer.
  const { inspectDashboardJournal: journalReader } = await import('../lib/worker-dashboard-journal.mjs');
  const server = createDashboardServer({ controller });
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return; shuttingDown = true;
    const closed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections();
    await controller.close(); await closed;
    process.stdout.write('Dashboard dan worker miliknya berhenti. Dana terkunci tidak dilepas.\n');
  }
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  server.on('error', async () => { process.stderr.write('Dashboard gagal membuka port lokal 4780. Tidak ada worker dimulai.\n'); await controller.close(); process.exitCode = 1; });
  server.listen(4780, '127.0.0.1', () => {
    process.stdout.write(`RESET ${demo ? 'DEMO OFFLINE' : 'LOKAL LIVE — BELUM DIMULAI'}\nhttp://127.0.0.1:4780\nTerminal ini harus tetap terbuka. Tidak ada auto-start/auto-restart.\n`);
  });
}
