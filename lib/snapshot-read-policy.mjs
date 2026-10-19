// Pure offline audit policy. Never diagnoses the cause or authorizes worker startup.
import { validateRound400Identity } from './round400-abandon-policy.mjs';
const fail = () => { throw new Error('Invalid narrow snapshot-read reconciliation; manual review required.'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');
export const SNAPSHOT_READ_PREFIX = 'RECONCILE-ONLY-SNAPSHOT-READ-KEEP-ROUND400-FORBIDDEN';
export function snapshotReadToken(hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail();
  return `${SNAPSHOT_READ_PREFIX}:${hash}`;
}
export function isSnapshotReadHalt(halt) {
  return exact(halt, ['type', 'intentWritten', 'failureStage']) && halt.type === 'halt' &&
    halt.intentWritten === false && halt.failureStage === 'snapshot-read';
}
export function validateSnapshotReadReconciliation(record, { identity, address, journalSha256 }) {
  validateRound400Identity(identity, address);
  if (!exact(record, ['type', 'version', 'identity', 'journalSha256', 'confirmation', 'preservedHalt',
    'cause', 'outcome', 'retryForbiddenRound', 'minimumFutureRound', 'workerStartAuthorized']) ||
      record.type !== 'reconcile_snapshot_read' || record.version !== 1 ||
      JSON.stringify(record.identity) !== JSON.stringify(identity) ||
      record.journalSha256 !== journalSha256 || record.confirmation !== snapshotReadToken(journalSha256) ||
      !isSnapshotReadHalt(record.preservedHalt) || record.cause !== 'unknown' || record.outcome !== 'unknown' ||
      record.retryForbiddenRound !== 400 || record.minimumFutureRound !== 401 || record.workerStartAuthorized !== false) fail();
  return true;
}
