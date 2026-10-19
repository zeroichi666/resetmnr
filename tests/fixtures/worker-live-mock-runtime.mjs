import { Simulation } from '../../lib/worker-simulation.mjs';
import { SimulationWorker } from '../../lib/worker-core.mjs';
export async function openLocalLiveWorker() {
  process.stdout.write('MOCK_RUNTIME_ONLY — no live implementation loaded\n');
  const worker = new SimulationWorker(new Simulation());
  return { worker, async close() { worker.stop(); process.stdout.write('MOCK_CLOSED\n'); } };
}
