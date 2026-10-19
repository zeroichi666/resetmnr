// Public reads only: deliberately never import a wallet, worker runtime or backend
// with signing/submission capabilities. No request occurs until manual refresh.
export const PUBLIC_GATEWAY = 'https://reset.openmayhem.ai';
const unavailable = 'Status publik tidak tersedia. Gateway gagal, timeout, atau data tidak konsisten. Coba refresh manual; tidak ada aksi worker dikirim.';

export function createPublicStatus({ readSnapshot, source = 'live', now = () => new Date().toISOString() }) {
  if (typeof readSnapshot !== 'function' || !['live', 'demo'].includes(source)) throw new Error('Invalid status configuration');
  let snapshot = { state: 'unchecked', checkedAt: null, lastSuccessAt: null, source, error: null, data: null };
  let pending;
  const status = () => structuredClone(snapshot);
  return {
    status,
    refresh() {
      if (pending) return pending; // Coalesce concurrent clicks; never queue retries.
      snapshot = { ...snapshot, state: 'loading', data: null, error: null };
      pending = (async () => {
        try {
          const data = await readSnapshot();
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid snapshot');
          const at = now();
          snapshot = { state: 'ready', checkedAt: at, lastSuccessAt: at, source, error: null, data: structuredClone(data) };
        } catch {
          snapshot = { ...snapshot, state: 'unavailable', checkedAt: now(), error: unavailable, data: null };
        }
        return status();
      })().finally(() => { pending = null; });
      return pending;
    }
  };
}

export function createPublicStatusReader({ address, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  if (typeof address !== 'string' || !/^[0-9a-f]{64}$/.test(address)) throw new Error('Invalid public address');
  return async function readSnapshot() {
    // These modules validate public wire data only; no wallet or signer entrypoint.
    const { validateState, validateAccount, statusView } = await import('../vendor/upstream/signer/lib/local-state.mjs');
    const { stableStringify } = await import('../vendor/upstream/signer/lib/pow.mjs');
    const signal = AbortSignal.timeout(5000); // One total request budget, no retries.
    async function get(path) {
      signal.throwIfAborted();
      const response = await fetchImpl(`${PUBLIC_GATEWAY}${path}`, {
        method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json' }, signal
      });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        throw new Error('Invalid response');
      }
      const chunks = []; let length = 0;
      for await (const chunk of response.body ?? []) {
        signal.throwIfAborted(); length += chunk.length;
        if (length > 262144) throw new Error('Response too large');
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const first = validateState(await get('/v1/state'));
    const account = await get(`/v1/account/${address}`);
    const current = validateState(await get('/v1/state'));
    if (stableStringify(first) !== stableStringify(current)) throw new Error('Inconsistent snapshot');
    const view = statusView(first, validateAccount(account, first), address);
    // Whitelist display fields; never expose arbitrary gateway keys/errors.
    return { balance: view.balance, deposit: view.deposit, fair_share_estimate: view.fair_share_estimate,
      tip: view.tip, counted: view.counted,
      mine: { round: view.mine.round, start: view.mine.start, claim_end: view.mine.claim_end, end: view.mine.end, window_open: view.mine.window_open },
      exits: view.exits, claim: view.claim };
  };
}
