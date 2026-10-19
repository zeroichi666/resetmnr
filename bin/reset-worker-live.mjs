#!/usr/bin/env node
// Separate executable: the existing simulator and safe MCP allowlist are unchanged.
import { setTimeout as pause } from 'node:timers/promises';
const args = process.argv.slice(2);
const usage = 'Live lokal belum dijalankan oleh tes. Setelah persetujuan terpisah: node bin/reset-worker-live.mjs --live --confirm-real-transactions --address <64-hex>\n';
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(usage);
} else if (args.length !== 4 || args[0] !== '--live' || args[1] !== '--confirm-real-transactions' ||
    args[2] !== '--address' || !/^[0-9a-f]{64}$/.test(args[3]) ||
    !process.stdin.isTTY || !process.stdout.isTTY || !process.env.RESET_SIGNER_PASSWORD) {
  process.stderr.write('Ditolak sebelum akses wallet/jaringan: perlu flags eksplisit, alamat, terminal interaktif dan password via environment.\n');
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  let session;
  const stop = () => { session?.worker.stop(); controller.abort(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    process.stdout.write('LIVE NYATA — gateway tetap https://reset.openmayhem.ai; batas total 0.1 RESET; klaim hanya level 1000.\n');
    process.stdout.write('Foreground sampai Ctrl+C; tanpa AI/scheduler/auto-restart. Ctrl+C tidak menarik dana dan tidak membatalkan transaksi yang sudah terkirim.\n');
    const { openLocalLiveWorker } = await import('../lib/worker-live-runtime.mjs');
    session = await openLocalLiveWorker({ expectedAddress: args[3], signal: controller.signal });
    while (!controller.signal.aborted) {
      const action = await session.worker.step({ signal: controller.signal });
      if (action.kind !== 'wait') process.stdout.write(`LIVE ${action.kind} ronde=${action.round}: aplikasi terlihat, bukan settlement/finalitas.\n`);
      // Poll pacing only; no duration cutoff, scheduling or automatic restart.
      await pause(60000, undefined, { signal: controller.signal });
    }
  } catch {
    if (!controller.signal.aborted) {
      process.stderr.write('Live dihentikan. Rekonsiliasi jurnal/status secara manual; tidak ada retry otomatis.\n');
      process.exitCode = 1;
    }
  } finally {
    stop();
    try { await session?.close(); }
    catch { process.stderr.write('Penutupan jurnal gagal; pemeriksaan manual wajib.\n'); process.exitCode = 1; }
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.stdout.write('Worker berhenti. Dana terkunci tidak dilepaskan oleh program ini.\n');
  }
}
