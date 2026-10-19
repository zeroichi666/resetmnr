import { decide } from './worker-policy.mjs';
const simulations = new WeakSet();
export const isSimulation = value => simulations.has(value);
export class Simulation {
  #state;
  #frames;
  #failure;
  #audit = [];
  constructor({ state, frames = [], failure = null } = {}) {
    this.#state = structuredClone(state ?? {
      balance: '1.00000000', deposit: '0.00000000', exits: [], tip: 600, counted: 599,
      mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: true },
      moves_left: 6, capacity_left: 100, strikes: 0, claim: null
    });
    this.#frames = structuredClone(frames);
    if (![null, 'before', 'after', 'rejected', 'unapplied'].includes(failure)) throw new Error('Invalid simulation failure.');
    this.#failure = failure;
    simulations.add(this);
  }
  get audit() { return structuredClone(this.#audit); }
  async status() {
    if (this.#frames.length) this.#state = this.#frames.shift();
    return structuredClone(this.#state);
  }
  async perform(action, { signal } = {}) {
    signal?.throwIfAborted();
    const expected = decide(this.#state);
    if (JSON.stringify(action) !== JSON.stringify(expected) || action.kind === 'wait')
      throw new Error('Simulation policy mismatch.');
    this.#audit.push(structuredClone(action));
    if (this.#failure === 'before') throw new Error('Simulated uncertain submission.');
    if (this.#failure === 'rejected') return { ok: false };
    if (this.#failure !== 'unapplied') {
      if (action.kind === 'lock') {
        // Policy only permits zero starting deposit and exactly 0.1 coins.
        const { coinUnits } = await import('./worker-policy.mjs');
        const units = coinUnits(this.#state.balance) - 10_000_000n;
        this.#state.balance = `${units / 100_000_000n}.${(units % 100_000_000n).toString().padStart(8, '0')}`;
        this.#state.deposit = '0.10000000';
      } else this.#state.claim = { deposit: this.#state.deposit, level: 1000 };
      this.#state.moves_left--;
      this.#state.capacity_left--;
    }
    if (this.#failure === 'after') throw new Error('Simulated applied submission with lost response.');
    return { ok: true };
  }
  advance() {
    this.#state.tip++;
    this.#state.counted++;
    this.#state.moves_left = 6;
    this.#state.capacity_left = 100;
    if (this.#state.tip > this.#state.mine.end) {
      this.#state.mine = { round: this.#state.mine.round + 1, start: this.#state.tip,
        claim_end: this.#state.tip + 2, end: this.#state.tip + 5, window_open: true };
      this.#state.claim = null;
    } else this.#state.mine.window_open = this.#state.tip <= this.#state.mine.claim_end;
    // Deliberately no fabricated payout: claims here are not earnings/finality.
  }
}
