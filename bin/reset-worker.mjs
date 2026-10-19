#!/usr/bin/env node
// No live implementation, wallet access, signer imports or network operations.
import { setTimeout as pause } from 'node:timers/promises';

if (process.argv.length !== 3 || process.argv[2] !== '--simulate') {
  process.stderr.write('Hanya --simulate tersedia. Mode live/wallet tidak didukung.\n');
  process.exitCode = 1;
} else {
  const { Simulation } = await import('../lib/worker-simulation.mjs');
  const { SimulationWorker } = await import('../lib/worker-core.mjs');
  const simulation = new Simulation();
  const worker = new SimulationWorker(simulation);
  const controller = new AbortController();
  const stop = () => { worker.stop(); controller.abort(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdout.write('SIMULASI OFFLINE — tanpa wallet/jaringan/AI. Batas 0.1 RESET; level 1000.\n');
  process.stdout.write('Foreground sampai Ctrl+C; tidak ada batas durasi atau auto-restart.\n');
  try {
    while (!controller.signal.aborted) {
      const action = await worker.step({ signal: controller.signal });
      if (action.kind !== 'wait') process.stdout.write(`SIMULASI ${action.kind} ${JSON.stringify(action.args)} ronde=${action.round}\n`);
      // Polling delay only, not a run-duration timer or scheduled task.
      await pause(1000, undefined, { signal: controller.signal });
      simulation.advance();
    }
  } catch {
    if (!controller.signal.aborted) {
      process.stderr.write('Simulasi dihentikan karena pemeriksaan gagal. Tidak mencoba ulang otomatis.\n');
      process.exitCode = 1;
    }
  } finally {
    stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdout.write('Simulasi berhenti; tidak ada dana/wallet yang digunakan.\n');
  }
}
