export function snapshot(overrides = {}) {
  return { balance: '1.0', deposit: '0', exits: [], tip: 600, counted: 599,
    mine: { round: 100, start: 600, claim_end: 602, end: 605, window_open: true },
    moves_left: 6, capacity_left: 100, strikes: 0, claim: null, ...overrides };
}
