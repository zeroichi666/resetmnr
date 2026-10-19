// No wallet, network, SDK, filesystem, model, or process imports.
// Runtime supplies the reviewed signer port; tests supply synthetic ports only.
import { decide, inspectStatus, MAX_LOCK_UNITS } from './worker-policy.mjs';
const HEX = /^[0-9a-f]{64}$/;
const fail = () => { throw new Error('Live worker halted; manual reconciliation required.'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function validAction(a) {
  return exact(a, ['kind', 'args', 'round']) && Number.isSafeInteger(a.round) && a.round >= 0 &&
    ((a.kind === 'lock' && exact(a.args, ['amount']) && a.args.amount === '0.1') ||
     (a.kind === 'mine_claim' && exact(a.args, ['level']) && a.args.level === 1000));
}
function checkpoint(value) {
  if (!exact(value, ['round', 'tip', 'counted', 'hash', 'start', 'claimEnd', 'end', 'exposure']) ||
      !['round', 'tip', 'counted', 'start', 'claimEnd', 'end'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0) ||
      typeof value.exposure !== 'string' || !/^(0|[1-9][0-9]{0,7})$/.test(value.exposure) || BigInt(value.exposure) > MAX_LOCK_UNITS ||
      !HEX.test(value.hash) || value.counted > value.tip || value.claimEnd !== value.start + 2 ||
      value.end !== value.start + 5 || value.tip < value.start || value.tip > value.end) fail();
  return structuredClone(value);
}
function forward(last, next) {
  if (last && (next.round < last.round || next.tip < last.tip || next.counted < last.counted ||
      BigInt(next.exposure) < BigInt(last.exposure) ||
      (next.tip === last.tip && next.hash !== last.hash) ||
      (next.round === last.round && ['start', 'claimEnd', 'end'].some(k => next[k] !== last[k])))) fail();
}
export class LiveWorker {
  #port; #journal; #address; #busy = false; #stopped = false;
  #lockAttempted = false; #claimRound = -1; #last = null;
  constructor({ port, journal, address }) {
    if (typeof address !== 'string' || !HEX.test(address) ||
        !['readSnapshot', 'prepare', 'solve', 'verifySigned', 'submit'].every(k => typeof port?.[k] === 'function') ||
        !journal || typeof journal.append !== 'function' || !Array.isArray(journal.history)) fail();
    this.#port = port; this.#journal = journal; this.#address = address;
    let pending = null;
    for (const record of journal.history) {
      if (!exact(record, ['type', 'action', 'checkpoint']) || !validAction(record.action)) fail();
      const cp = checkpoint(record.checkpoint);
      forward(this.#last, cp); this.#last = cp;
      if (record.type === 'intent') {
        if (pending || record.action.round !== cp.round) fail();
        if (record.action.kind === 'lock') {
          if (this.#lockAttempted) fail();
          this.#lockAttempted = true;
        } else {
          if (record.action.round <= this.#claimRound) fail();
          this.#claimRound = record.action.round;
        }
        pending = record.action;
      } else if (record.type === 'observed' && pending && equal(pending, record.action)) pending = null;
      else fail(); // Includes any halt marker, unknown records and duplicate observations.
    }
    if (pending) fail();
  }
  stop() { this.#stopped = true; }
  get stopped() { return this.#stopped; }
  #check(signal) { if (this.#stopped || signal?.aborted) fail(); }
  async #read(signal) {
    this.#check(signal);
    const raw = structuredClone(await this.#port.readSnapshot({ signal }));
    this.#check(signal);
    if (!raw || raw.address !== this.#address || raw.minimum !== '10000000' ||
        typeof raw.tipHash !== 'string' || !HEX.test(raw.tipHash) ||
        !exact(raw.bits, ['lock', 'claim']) || !Object.values(raw.bits).every(n => Number.isSafeInteger(n) && n >= 0 && n <= 32)) fail();
    const s = inspectStatus(raw.status);
    if (s.strikes) fail();
    const cp = checkpoint({ round: s.round, tip: s.tip, counted: s.counted, hash: raw.tipHash,
      start: s.start, claimEnd: s.claimEnd, end: s.end, exposure: (s.deposit + s.exits).toString() });
    forward(this.#last, cp); this.#last = cp;
    const fingerprint = JSON.stringify({ ...cp, minimum: raw.minimum, bits: raw.bits,
      balance: s.balance.toString(), deposit: s.deposit.toString(), exits: s.exits.toString(),
      exitDetails: raw.status.exits.map(e => ({ amount: e.amount, release: e.release })),
      proofState: raw.proofState ?? null,
      claimed: s.claimed, moves: s.movesLeft, capacity: s.capacityLeft, strikes: s.strikes });
    return { raw, s, cp, fingerprint };
  }
  async step({ signal } = {}) {
    if (this.#busy) fail();
    this.#check(signal); this.#busy = true;
    let intentWritten = false;
    try {
      const first = await this.#read(signal);
      const action = decide(first.raw.status);
      if (action.kind === 'wait') return action;
      if (!validAction(action)) fail();
      if (action.kind === 'lock' && this.#lockAttempted) fail();
      if (action.kind === 'mine_claim' && action.round <= this.#claimRound)
        return { kind: 'wait', reason: 'already-attempted' };
      const fresh = await this.#read(signal);
      if (fresh.fingerprint !== first.fingerprint || !equal(decide(fresh.raw.status), action))
        return { kind: 'wait', reason: 'state-changed' };
      // Durable intent before puzzle/signing; ambiguity must never trigger replay.
      this.#journal.append({ type: 'intent', action, checkpoint: fresh.cp });
      intentWritten = true;
      if (action.kind === 'lock') this.#lockAttempted = true;
      else this.#claimRound = action.round;
      const unchanged = async () => {
        const next = await this.#read(signal);
        if (next.fingerprint !== fresh.fingerprint || !equal(decide(next.raw.status), action)) fail();
        return next;
      };
      this.#check(signal);
      const packet = await this.#port.prepare(structuredClone(action), fresh.raw, { signal });
      await unchanged();
      const signed = await this.#port.solve(packet, fresh.raw, { signal, refresh: unchanged });
      await unchanged();
      this.#check(signal);
      if (await this.#port.verifySigned(signed, action, fresh.raw) !== true) fail();
      await unchanged();
      this.#check(signal);
      const result = await this.#port.submit(signed, { signal });
      this.#check(signal);
      if (!result || result.ok !== true) fail();
      const observed = await this.#read(signal);
      if (action.kind === 'lock' && (observed.s.deposit !== MAX_LOCK_UNITS || observed.s.exits !== 0n)) fail();
      if (action.kind === 'mine_claim' && (observed.s.round !== action.round || !observed.s.claimed ||
          observed.s.deposit !== MAX_LOCK_UNITS || observed.s.exits !== 0n)) fail();
      this.#journal.append({ type: 'observed', action, checkpoint: observed.cp });
      return action; // Observed application is NOT settlement or finality.
    } catch {
      this.#stopped = true;
      // Even a read/validation failure is sticky across clean restarts.
      try { this.#journal.append({ type: 'halt', intentWritten }); } catch {}
      fail();
    } finally { this.#busy = false; }
  }
}
