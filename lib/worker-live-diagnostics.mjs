// Only locally-created errors can carry a diagnosis. Never inspect exception
// messages, codes, causes, hashes, wallet material or remote payloads.
const diagnoses = new WeakMap();
const stages = new Set([
  'snapshot-read', 'snapshot-validation', 'snapshot-monotonicity', 'snapshot-consistency',
  'policy-decision', 'journal-intent', 'prepare', 'solve', 'signed-verification',
  'submission', 'observation-validation', 'journal-observed',
  'startup-history', 'startup-signer-load', 'startup-unlock', 'startup-wallet-identity', 'startup-backend'
]);
export function createLiveHaltError(stage) {
  const error = new Error('Live worker halted; manual reconciliation required.');
  if (stages.has(stage)) diagnoses.set(error, stage);
  return error;
}
export function liveHaltDiagnosis(error) {
  return error && (typeof error === 'object' || typeof error === 'function')
    ? diagnoses.get(error) ?? null : null;
}
