import { LiveWorker } from './worker-live.mjs';
import { createSignerPort } from './worker-live-port.mjs';
import { createLiveHaltError } from './worker-live-diagnostics.mjs';
// In-process dependency injection solely for offline tests. No CLI/env executable overrides.
export async function startLocalWorker({ expectedAddress, signal }, deps) {
  signal?.throwIfAborted();
  if (typeof expectedAddress !== 'string' || !/^[0-9a-f]{64}$/.test(expectedAddress)) throw new Error('Address required.');
  const password = deps.takePassword();
  if (!password) throw new Error('Secure password injection required.');
  await deps.verifyInstallation();
  await deps.verifyRules();
  signal?.throwIfAborted();
  const journal = deps.openJournal(expectedAddress);
  let wallet, backend, api, closed = false, worker;
  let stage = 'startup-history';
  const close = async () => {
    if (closed) return; closed = true;
    worker?.stop();
    try { await backend?.close(); }
    finally { try { if (wallet) api.wipeWallet(wallet); } finally { journal.close(); } }
  };
  try {
    signal?.throwIfAborted();
    let port;
    const methods = ['readSnapshot', 'prepare', 'solve', 'verifySigned', 'submit'];
    const proxy = Object.fromEntries(methods.map(name => [name, (...args) => port[name](...args)]));
    // Validate persisted history before importing wallet code or unlocking.
    worker = new LiveWorker({ port: proxy, journal, address: expectedAddress });
    stage = 'startup-signer-load';
    api = await deps.loadSigner();
    signal?.throwIfAborted();
    stage = 'startup-unlock';
    wallet = await api.unlock({ directory: deps.walletDirectory, password });
    signal?.throwIfAborted();
    stage = 'startup-wallet-identity';
    if (api.publicAddress(wallet) !== expectedAddress) throw new Error('Wrong wallet.');
    stage = 'startup-backend';
    backend = await deps.createBackend(wallet);
    port = createSignerPort({ backend, wallet, api, address: expectedAddress });
    return { worker, close };
  } catch {
    try { journal.append({ type: 'halt', intentWritten: false, failureStage: stage }); } catch {}
    await close();
    throw createLiveHaltError(stage);
  }
}
