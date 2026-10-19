// Pure offline policy. No SDK, wallet, filesystem, model or network imports.
export const MAX_LOCK_UNITS = 10_000_000n; // 0.1 RESET, including existing exits
export const FAIR_SHARE_LEVEL = 1000;
export function coinUnits(value) {
  if (typeof value !== 'string' || value.length > 79 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value))
    throw new Error('Invalid coin amount.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
  if (result.toString().length > 78) throw new Error('Amount overflow.');
  return result;
}
const integer = n => Number.isSafeInteger(n) && n >= 0;
export function inspectStatus(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.exits) || raw.exits.length > 256 ||
      !integer(raw.tip) || !integer(raw.counted) || raw.counted > raw.tip ||
      !integer(raw.moves_left) || !integer(raw.capacity_left) || !integer(raw.strikes) ||
      !raw.mine || !integer(raw.mine.round) || !integer(raw.mine.start) ||
      !integer(raw.mine.claim_end) || !integer(raw.mine.end) ||
      raw.mine.claim_end !== raw.mine.start + 2 || raw.mine.end !== raw.mine.start + 5 ||
      raw.tip < raw.mine.start || raw.tip > raw.mine.end ||
      typeof raw.mine.window_open !== 'boolean' ||
      raw.mine.window_open !== (raw.tip <= raw.mine.claim_end)) throw new Error('Invalid status.');
  const balance = coinUnits(raw.balance), deposit = coinUnits(raw.deposit);
  const exits = raw.exits.reduce((sum, exit) => {
    if (!exit || !integer(exit.release)) throw new Error('Invalid exit.');
    return sum + coinUnits(exit.amount);
  }, 0n);
  if (deposit + exits > MAX_LOCK_UNITS) throw new Error('Existing exposure exceeds 0.1 RESET.');
  if (raw.claim !== null) {
    if (!raw.claim || raw.claim.level !== FAIR_SHARE_LEVEL ||
        coinUnits(raw.claim.deposit) !== MAX_LOCK_UNITS || deposit !== MAX_LOCK_UNITS)
      throw new Error('Unsafe or invalid existing claim.');
  }
  // Copy only trusted numeric/boolean fields, never opinions or instructions.
  return Object.freeze({ balance, deposit, exits, round: raw.mine.round, tip: raw.tip,
    counted: raw.counted, windowOpen: raw.mine.window_open, claimed: raw.claim !== null,
    start: raw.mine.start, claimEnd: raw.mine.claim_end, end: raw.mine.end,
    movesLeft: raw.moves_left, capacityLeft: raw.capacity_left, strikes: raw.strikes });
}
export function decide(status) {
  const s = inspectStatus(status);
  if (s.strikes > 0) throw new Error('Existing strikes require manual review.');
  if (s.movesLeft === 0 || s.capacityLeft === 0) return Object.freeze({ kind: 'wait' });
  // Never top up partial deposits: the 0.1 minimum would exceed our total cap.
  if (s.deposit === 0n && s.exits === 0n && s.balance >= MAX_LOCK_UNITS)
    return Object.freeze({ kind: 'lock', args: Object.freeze({ amount: '0.1' }), round: s.round });
  if (s.deposit === MAX_LOCK_UNITS && s.windowOpen && !s.claimed)
    return Object.freeze({ kind: 'mine_claim', args: Object.freeze({ level: FAIR_SHARE_LEVEL }), round: s.round });
  return Object.freeze({ kind: 'wait' });
}
