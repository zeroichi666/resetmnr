// Dependency injection is for offline tests, not executable/config overrides.
import { FAIR_SHARE_LEVEL, MAX_LOCK_UNITS } from './worker-policy.mjs';
const fail = () => { throw new Error('Signer port validation failed.'); };
const same = (a, b, stable) => stable(a) === stable(b);
function payload(action) {
  if (!action || Object.keys(action).sort().join(',') !== 'args,kind,round' ||
      !Number.isSafeInteger(action.round) || action.round < 0) fail();
  if (action.kind === 'lock' && Object.keys(action.args ?? {}).join(',') === 'amount' && action.args.amount === '0.1')
    return { type: 'lock', data: { amount: MAX_LOCK_UNITS.toString() } };
  if (action.kind === 'mine_claim' && Object.keys(action.args ?? {}).join(',') === 'level' && action.args.level === FAIR_SHARE_LEVEL)
    return { type: 'claim', data: { r: action.round, q: FAIR_SHARE_LEVEL } };
  fail();
}
export function createSignerPort({ backend, wallet, api, address }) {
  const { validateState, validateAccount, statusView, stableStringify: stable,
    signAndSolve, verifyMove, validateFresh, validateEnvelope, validatePrepared } = api;
  if (api.publicAddress(wallet) !== address) fail();
  const checkPacket = (packet, action, snapshot) => {
    const p = payload(action), state = snapshot.proofState;
    if (action.round !== state.mine.r) fail();
    validateFresh(packet);
    const e = validateEnvelope(packet.envelope);
    if (e.t !== p.type || !same(e.p, p.data, stable) || e.b !== state.tip.height || e.h !== state.tip.hash ||
        packet.bits !== state.bits[p.type]) fail();
    validatePrepared(packet.prepared, address, e);
  };
  return {
    async readSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const state = validateState(await backend.state());
      const account = await backend.account();
      const current = validateState(await backend.state());
      signal?.throwIfAborted();
      if (!same(state, current, stable)) fail(); // No transparent retry on inconsistent reads.
      const valid = validateAccount(account, state);
      return { address, minimum: state.params.min_amount, tipHash: state.tip.hash,
        bits: { lock: state.bits.lock, claim: state.bits.claim },
        status: statusView(state, valid, address), proofState: state };
    },
    async prepare(action, snapshot, { signal } = {}) {
      signal?.throwIfAborted();
      const p = payload(action);
      const packet = await backend.prepareMove(p.type, p.data, snapshot.proofState);
      signal?.throwIfAborted(); checkPacket(packet, action, snapshot);
      return packet;
    },
    async solve(packet, snapshot, { signal, refresh } = {}) {
      const work = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
      return signAndSolve(wallet, packet, { state: snapshot.proofState, maxAttempts: 1000000, signal: work,
        refreshState: async () => (await refresh()).raw.proofState });
    },
    async verifySigned(signed, action, snapshot) {
      const p = payload(action);
      const e = validateEnvelope(JSON.parse(signed.prepared.dispatch.msg), true);
      if (signed.prepared.dispatch.address !== address || e.t !== p.type || !same(e.p, p.data, stable)) fail();
      return verifyMove(signed, { state: snapshot.proofState });
    },
    async submit(signed, { signal } = {}) {
      signal?.throwIfAborted();
      // Single dispatch only. The caller journals the intent before signing.
      return backend.submitMove(signed);
    }
  };
}
