import { setTimeout as pause } from 'node:timers/promises';

// Dependency injection keeps lifecycle tests completely offline.
export function createDashboardController({ address, mode = 'live', openSession, inspectJournal = () => null, poll = (signal) => pause(60000, undefined, { signal }), now = () => new Date().toISOString() }) {
  if (!/^[0-9a-f]{64}$/.test(address) || !['live', 'demo'].includes(mode) || typeof openSession !== 'function') throw new Error('Invalid dashboard configuration');
  let phase = 'idle', startedAt = null, lastCheckedAt = null, lastAction = null;
  let abort, session, task = null, closing = false;
  let stopFailed = false;
  const events = [];
  const event = message => { events.unshift({ at: now(), message }); events.splice(60); };
  const stopSession = () => {
    try { session?.worker.stop(); }
    catch { stopFailed = true; event('Stop worker gagal; abort dan penutupan tetap diminta. Periksa manual.'); }
  };
  event(mode === 'demo' ? 'Mode demo: data sintetis, tanpa wallet atau jaringan RESET.' : 'Dashboard siap. Worker belum dimulai.');
  function journalStatus() {
    try { return { journal: inspectJournal(), error: null }; }
    catch { return { journal: null, error: 'Jurnal lokal tidak dapat diperiksa dengan aman. Periksa manual; jangan hapus jurnal/lease.' }; }
  }
  function status() {
    const { journal, error } = journalStatus();
    const own = ['starting', 'running', 'stopping'].includes(phase);
    const blockReason = closing ? 'Dashboard sedang ditutup.' : phase === 'error' ? 'Worker dihentikan karena error. Rekonsiliasi manual wajib sebelum membuka sesi baru.' : !own && (error || (journal?.leasePresent && 'Lease worker lain atau sisa crash ditemukan. Hentikan CLI lama dengan Ctrl+C dan periksa manual; jangan hapus lease.'));
    return { phase, address, mode, startedAt, lastCheckedAt, lastAction, events: structuredClone(events), blocked: Boolean(blockReason), blockReason: blockReason || null, journal };
  }
  async function run(signal) {
    let failed = false;
    try {
      session = await openSession({ expectedAddress: address, signal });
      signal.throwIfAborted();
      phase = 'running'; startedAt = now(); event('Worker berjalan foreground; tidak ada auto-restart.');
      while (!signal.aborted) {
        const action = await session.worker.step({ signal });
        lastCheckedAt = now(); lastAction = structuredClone(action);
        event(action.kind === 'wait' ? `Menunggu: ${action.reason || 'belum ada aksi aman'}.` : `${action.kind} ronde ${action.round}: aplikasi teramati, bukan settlement/finalitas.`);
        if (session.worker.stopped) throw new Error('Worker stopped unexpectedly');
        await poll(signal);
      }
    } catch {
      // Abort from an explicit stop is not a retry. Runtime journals ambiguous actions.
      if (!signal.aborted) { failed = true; event('Worker error. Tidak ada retry otomatis; rekonsiliasi jurnal/status manual wajib.'); }
    } finally {
      stopSession();
      try { await session?.close(); }
      catch { failed = true; event('Penutupan jurnal gagal. Pemeriksaan manual wajib.'); }
      session = null; phase = failed || stopFailed ? 'error' : 'stopped';
      event('Worker berhenti. Dana terkunci tidak dilepas; transaksi terkirim tidak dibatalkan.');
    }
  }
  return {
    status,
    start(payload) {
      if (closing || task && ['starting', 'running', 'stopping'].includes(phase)) throw new Error('Worker already active');
      if (status().blocked || payload?.confirm !== true || payload.address !== address || Object.keys(payload).sort().join(',') !== 'address,confirm') throw new Error('Start requires explicit confirmation and matching address');
      abort = new AbortController(); stopFailed = false; phase = 'starting'; lastAction = null; lastCheckedAt = null; startedAt = null;
      event(mode === 'live' ? 'Mulai diminta. Masukkan password wallet di terminal WSL (bukan browser).' : 'Demo dimulai secara manual.');
      task = run(abort.signal);
      return status();
    },
    stop() {
      if (['starting', 'running'].includes(phase)) {
        phase = 'stopping'; event('Permintaan berhenti diterima; menunggu operasi aktif selesai/abort.');
        try { stopSession(); } finally { abort?.abort(); }
      }
      return status();
    },
    async close() { closing = true; this.stop(); await task; }
  };
}
