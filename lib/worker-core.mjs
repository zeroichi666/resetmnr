import { decide, inspectStatus, MAX_LOCK_UNITS } from './worker-policy.mjs';
import { isSimulation } from './worker-simulation.mjs';

// This revision accepts only the in-memory Simulation, never a real adapter.
export class SimulationWorker {
  #simulation;
  #busy = false;
  #stopped = false;
  #lockAttempted = false;
  #claimRound = -1;
  #last = null;
  constructor(simulation) {
    if (!isSimulation(simulation)) throw new Error('Only the offline simulation backend is supported.');
    this.#simulation = simulation;
  }
  stop() { this.#stopped = true; }
  get stopped() { return this.#stopped; }
  #check(signal) {
    if (this.#stopped || signal?.aborted) throw new Error('Worker stopped.');
  }
  async #read() {
    const raw = await this.#simulation.status();
    const s = inspectStatus(raw);
    if (this.#last && (s.round < this.#last.round || s.tip < this.#last.tip || s.counted < this.#last.counted))
      throw new Error('Regressed state requires manual review.');
    if (this.#last && s.round === this.#last.round &&
        ['start', 'claimEnd', 'end'].some(key => s[key] !== this.#last[key]))
      throw new Error('Changed round boundaries require manual review.');
    this.#last = s;
    return { raw, s };
  }
  async step({ signal } = {}) {
    if (this.#busy) throw new Error('Worker step already running.');
    this.#check(signal);
    this.#busy = true;
    try {
      const first = await this.#read();
      this.#check(signal);
      const action = decide(first.raw);
      if (action.kind === 'wait') return action;
      // Read again immediately before submission; never act on stale decisions.
      const fresh = await this.#read();
      this.#check(signal);
      if (Object.keys(first.s).some(key => first.s[key] !== fresh.s[key]) ||
          JSON.stringify(decide(fresh.raw)) !== JSON.stringify(action))
        return { kind: 'wait', reason: 'state-changed' };
      if (action.kind === 'lock') {
        if (this.#lockAttempted) throw new Error('Lock was already attempted; manual review required.');
        this.#lockAttempted = true; // Set before dispatch, including ambiguous failures.
      } else {
        if (action.round <= this.#claimRound) return { kind: 'wait', reason: 'already-attempted' };
        this.#claimRound = action.round;
      }
      const result = await this.#simulation.perform(action, { signal });
      if (!result || result.ok !== true) throw new Error('Submission not confirmed.');
      this.#check(signal);
      const observed = await this.#read();
      this.#check(signal);
      if (action.kind === 'lock' && observed.s.deposit !== MAX_LOCK_UNITS)
        throw new Error('Accepted lock is not observed.');
      if (action.kind === 'mine_claim' && (observed.s.round !== action.round || !observed.s.claimed))
        throw new Error('Accepted claim is not observed.');
      return action;
    } catch {
      // No raw backend error output or automatic retries; restart needs review.
      this.#stopped = true;
      throw new Error('Simulation worker halted; inspect simulated state before any manual restart.');
    } finally { this.#busy = false; }
  }
}
