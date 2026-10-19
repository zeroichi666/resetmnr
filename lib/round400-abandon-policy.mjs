// Pure data validation. No filesystem, runtime, wallet, signer, or network access.
export const ROUND400_PIN = '6132e8653d6342f36673eb7426ec8e064960e48e';
export const ROUND400_GATEWAY = 'https://reset.openmayhem.ai';
export const ROUND400_FORFEIT_ACK = 'I ACCEPT THAT ANY ROUND-400 REWARD MAY BE FORFEITED; NEVER RETRY ROUND 400';
export const ROUND400_ABANDON_PREFIX = 'ABANDON-CLAIM400-OUTCOME-UNKNOWN-NO-RETRY';
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('Invalid round 400 abandon decision; manual review required.'); };
export function round400AbandonToken(hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail();
  return `${ROUND400_ABANDON_PREFIX}:${hash}`;
}
export function validateRound400Identity(identity, address) {
  if (!exact(identity, ['address', 'gateway', 'pin']) || identity.address !== address ||
      typeof address !== 'string' || !/^[0-9a-f]{64}$/.test(address) ||
      identity.gateway !== ROUND400_GATEWAY || identity.pin !== ROUND400_PIN) fail();
}
export function validateRound400Target(intent, halt, priorObserved) {
  if (!exact(intent, ['type', 'action', 'checkpoint']) || intent.type !== 'intent' ||
      !exact(intent.action, ['kind', 'args', 'round']) || intent.action.kind !== 'mine_claim' ||
      intent.action.round !== 400 || !exact(intent.action.args, ['level']) || intent.action.args.level !== 1000 ||
      intent.checkpoint?.round !== 400 || intent.checkpoint.tip !== 972098 || intent.checkpoint.exposure !== '10000000' ||
      intent.checkpoint.tip > intent.checkpoint.claimEnd ||
      !exact(halt, ['type', 'intentWritten']) || halt.type !== 'halt' || halt.intentWritten !== true ||
      priorObserved?.type !== 'observed' || priorObserved.action?.kind !== 'lock' || priorObserved.action.round !== 399 ||
      priorObserved.checkpoint?.round !== 399 || priorObserved.checkpoint.tip !== 972096 ||
      priorObserved.checkpoint.exposure !== '10000000') fail();
}
export function validateRound400Abandon(record, { identity, intent, journalSha256, address }) {
  validateRound400Identity(identity, address);
  if (!exact(record, ['type', 'version', 'identity', 'action', 'checkpoint', 'journalSha256', 'confirmation',
    'acknowledgement', 'outcome', 'retryForbiddenRound', 'futureRoundsOnly']) ||
      record.type !== 'abandon_claim' || record.version !== 1 ||
      !same(record.identity, identity) || !same(record.action, intent.action) || !same(record.checkpoint, intent.checkpoint) ||
      record.journalSha256 !== journalSha256 || record.confirmation !== round400AbandonToken(journalSha256) ||
      record.acknowledgement !== ROUND400_FORFEIT_ACK || record.outcome !== 'unknown' ||
      record.retryForbiddenRound !== 400 || record.futureRoundsOnly !== true) fail();
  // Deliberately no status claim:null or assertion of confirmed non-application.
  return true;
}
