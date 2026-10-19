(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['connection', 'connectionText', 'offlineBanner', 'liveRegion', 'phaseLabel', 'phasePill', 'address', 'mode', 'startedAt', 'lastChecked', 'lastAction', 'eventsList', 'confirmCheck', 'startBtn', 'stopBtn', 'actionFeedback', 'terminalHint', 'journalState', 'journalEmpty', 'journalData', 'journalKind', 'journalRound', 'journalExposure', 'journalTip', 'blockBanner', 'blockReason', 'modeBanner', 'refreshBtn', 'publicStatePill', 'publicStatusMessage', 'publicBalance', 'publicDeposit', 'publicFairShare', 'publicTip', 'publicRound', 'publicWindow', 'publicTimes', 'publicExits', 'publicClaim', 'publicLastSuccess', 'publicCheckedAt'];
  const els = Object.fromEntries(ids.map(id => [id, $(id)]));
  let status = null, csrf = '', online = false, busy = false, loadingPublic = false, publicSnapshot = null;
  const phases = { idle: ['Siap', 'IDLE'], starting: ['Memulai', 'STARTING'], running: ['Berjalan', 'RUNNING'], stopping: ['Menghentikan', 'STOPPING'], stopped: ['Berhenti', 'STOPPED'], error: ['Error · periksa manual', 'ERROR'] };
  const labels = { unchecked: 'BELUM DIPERIKSA', ready: 'SNAPSHOT', unavailable: 'TIDAK TERSEDIA', loading: 'MEMUAT' };
  const safe = (value, fallback = 'Tidak tersedia') => value === null || value === undefined || value === '' ? fallback : String(value);
  const date = value => {
    if (!value) return 'Belum ada';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Tidak diketahui' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });
  };
  const coins = value => typeof value === 'string' && /^(0|[1-9][0-9]*)\.[0-9]{8}$/.test(value) ? `${value} RESET` : 'Tidak tersedia';
  const block = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Tidak tersedia';
  const exposure = value => {
    if (!/^(0|[1-9][0-9]{0,7})$/.test(value)) return 'Tidak diketahui';
    const n = BigInt(value);
    return `${n / 100000000n}.${String(n % 100000000n).padStart(8, '0').replace(/0+$/, '') || '0'} RESET`;
  };
  const notify = message => { els.liveRegion.textContent = message; };
  const feedback = (message, good = false) => {
    els.actionFeedback.hidden = !message; els.actionFeedback.textContent = message || '';
    els.actionFeedback.classList.toggle('ok', good);
  };
  function controls() {
    const phase = status?.phase;
    els.startBtn.disabled = !(online && csrf && !busy && !status?.blocked && ['idle', 'stopped'].includes(phase) && els.confirmCheck.checked);
    els.stopBtn.disabled = !(online && csrf && !busy && ['starting', 'running'].includes(phase));
    els.confirmCheck.disabled = !online || busy || status?.blocked || !['idle', 'stopped'].includes(phase);
    els.refreshBtn.disabled = loadingPublic || busy;
  }
  function setOnline(value) {
    online = value;
    els.connection.classList.toggle('online', value); els.connection.classList.toggle('offline', !value);
    els.connectionText.textContent = value ? 'Terhubung lokal' : 'Offline';
    els.offlineBanner.hidden = value; els.offlineBanner.setAttribute('aria-hidden', String(value));
    if (!value) { els.phaseLabel.textContent = 'Status tidak diketahui'; els.phasePill.textContent = 'OFFLINE'; els.phasePill.className = 'pill neutral'; }
    controls();
  }
  function renderJournal(journal) {
    const obs = journal?.lastObserved, present = Boolean(obs);
    els.journalState.textContent = present ? 'HISTORIS' : 'BELUM ADA';
    els.journalState.className = `pill ${present ? 'starting' : 'neutral'}`;
    els.journalEmpty.hidden = present; els.journalData.hidden = !present;
    if (present) {
      els.journalKind.textContent = safe(obs.kind); els.journalRound.textContent = safe(obs.round);
      els.journalExposure.textContent = exposure(obs.exposureUnits); els.journalTip.textContent = safe(obs.tip);
    }
  }
  function renderEvents(events) {
    els.eventsList.textContent = '';
    if (!Array.isArray(events) || !events.length) { const li = document.createElement('li'); li.textContent = 'Belum ada peristiwa.'; els.eventsList.appendChild(li); return; }
    events.slice(0, 30).forEach(event => {
      const li = document.createElement('li'), time = document.createElement('time'), msg = document.createElement('span');
      time.textContent = date(event?.at); msg.textContent = safe(event?.message); li.append(time, msg); els.eventsList.appendChild(li);
    });
  }
  function renderPublic(snapshot) {
    const p = snapshot || { state: 'unavailable', error: 'Status publik tidak tersedia.', data: null };
    publicSnapshot = p;
    const state = Object.hasOwn(labels, p.state) ? p.state : 'unavailable';
    els.publicStatePill.textContent = labels[state];
    els.publicStatePill.className = `pill ${state === 'ready' ? 'running' : state === 'loading' ? 'starting' : state === 'unavailable' ? 'error' : 'neutral'}`;
    els.publicCheckedAt.textContent = date(p.checkedAt); els.publicLastSuccess.textContent = date(p.lastSuccessAt);
    if (state !== 'ready' || !p.data) {
      ['publicBalance', 'publicDeposit', 'publicFairShare', 'publicTip', 'publicRound', 'publicWindow', 'publicTimes', 'publicExits', 'publicClaim'].forEach(id => { els[id].textContent = 'Tidak tersedia'; });
      els.publicStatusMessage.textContent = state === 'unchecked' ? 'Belum diperiksa. Klik Refresh status; tidak perlu password.' : state === 'loading' ? 'Membaca snapshot publik saja; tidak mengirim aksi worker.' : safe(p.error, 'Status publik tidak tersedia; nilai lama tidak ditampilkan sebagai nilai terkini.');
      return;
    }
    const d = p.data, m = d.mine || {};
    els.publicBalance.textContent = coins(d.balance); els.publicDeposit.textContent = coins(d.deposit);
    els.publicFairShare.textContent = coins(d.fair_share_estimate);
    els.publicTip.textContent = `${block(d.tip)} · counted ${block(d.counted)}`;
    els.publicRound.textContent = block(m.round);
    els.publicWindow.textContent = m.window_open === true ? 'Terbuka' : m.window_open === false ? 'Tertutup' : 'Tidak tersedia';
    els.publicTimes.textContent = `Blok mulai ${block(m.start)} · batas claim ${block(m.claim_end)} · akhir ${block(m.end)}`;
    els.publicExits.textContent = !Array.isArray(d.exits) ? 'Tidak tersedia' : d.exits.length ? d.exits.map(e => `${coins(e.amount)} · release blok ${block(e.release)}${e.mature === true ? ' · matang' : ''}`).join('; ') : 'Tidak ada';
    els.publicClaim.textContent = d.claim === null ? 'Tidak ada' : d.claim ? `${coins(d.claim.deposit)} · level ${block(d.claim.level)}` : 'Tidak tersedia';
    els.publicStatusMessage.textContent = `Sumber: ${p.source === 'demo' ? 'DEMO · sintetis' : 'gateway publik'} · snapshot saat diperiksa, bukan saldo real-time atau finalitas. Refresh manual tanpa password.`;
  }
  function render(data) {
    if (!data || !Object.hasOwn(phases, data.phase) || typeof data.csrf !== 'string' || !/^[0-9a-f]{64}$/.test(data.address)) throw new Error('Status lokal tidak valid');
    const changed = status?.phase !== data.phase;
    status = data; csrf = data.csrf;
    const phase = phases[data.phase]; els.phaseLabel.textContent = phase[0]; els.phasePill.textContent = phase[1]; els.phasePill.className = `pill ${data.phase}`;
    els.address.textContent = data.address; els.mode.textContent = data.mode === 'live' ? 'LIVE · transaksi nyata' : 'DEMO · sintetis';
    els.modeBanner.hidden = data.mode !== 'demo'; els.startedAt.textContent = date(data.startedAt);
    els.lastChecked.textContent = `Langkah worker terakhir: ${date(data.lastCheckedAt)}`;
    const a = data.lastAction;
    els.lastAction.textContent = a ? `${safe(a.kind)}${Number.isSafeInteger(a.round) ? ` · ronde ${a.round}` : ''}${a.reason ? ` · ${a.reason}` : ''}` : 'Belum ada langkah worker';
    els.blockBanner.hidden = !data.blocked; els.blockReason.textContent = data.blockReason || '';
    renderJournal(data.journal); renderEvents(data.events); renderPublic(data.publicStatus);
    if (data.mode === 'demo') els.terminalHint.textContent = 'Demo hanya memakai data sintetis di memori. Tidak ada password, wallet, atau transaksi nyata.';
    else if (data.phase === 'starting') els.terminalHint.textContent = 'Masukkan password wallet di terminal WSL. Setelah itu klik Refresh status untuk melihat fase terbaru; tidak ada auto-refresh.';
    else if (data.phase === 'stopping') els.terminalHint.textContent = 'Menunggu operasi aktif selesai/abort. Klik Refresh status untuk fase terbaru. Transaksi terkirim tidak dibatalkan; dana tidak dibuka.';
    else els.terminalHint.textContent = 'Setelah klik Mulai, masukkan password di terminal WSL. Menutup tab tidak menghentikan worker; gunakan Hentikan atau Ctrl+C di terminal.';
    if (changed) notify(`Status worker: ${phase[0]}.`);
    controls();
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Reset-Token': csrf } : {}) }, cache: 'no-store', signal: AbortSignal.timeout(6000) });
    let body; try { body = await response.json(); } catch { throw new Error('Respons lokal tidak valid'); }
    if (!response.ok) throw new Error(body?.error || `Permintaan gagal (${response.status})`);
    return body;
  }
  function publicFail(error) {
    renderPublic({ state: 'unavailable', checkedAt: new Date().toISOString(), lastSuccessAt: publicSnapshot?.lastSuccessAt || null, source: publicSnapshot?.source || 'live', error: error.message, data: null });
  }
  async function readLocal() {
    if (busy) return;
    try { render(await request('/api/status')); setOnline(true); }
    catch (error) { status = null; csrf = ''; setOnline(false); publicFail(error); feedback(`Tidak dapat membaca status: ${error.message}`); notify('Koneksi offline. Status worker tidak diketahui; refresh manual dapat dicoba lagi.'); }
  }
  async function refresh() {
    if (loadingPublic || busy) return;
    loadingPublic = true; els.refreshBtn.textContent = 'Menyegarkan…'; controls();
    renderPublic({ ...publicSnapshot, state: 'loading', data: null, error: null });
    try {
      // Obtain the current local token even after a dashboard/server restart.
      render(await request('/api/status')); setOnline(true);
      renderPublic({ ...publicSnapshot, state: 'loading', data: null, error: null });
      const data = await request('/api/refresh', { method: 'POST', body: '{}' });
      render(data); setOnline(true);
      const ok = data.publicStatus?.state === 'ready';
      const message = ok ? 'Snapshot publik berhasil dibaca.' : 'Status publik tidak tersedia. Coba refresh manual; tidak ada aksi worker dikirim.';
      feedback(message, ok); notify(message);
    } catch (error) {
      status = null; csrf = ''; setOnline(false); publicFail(error);
      feedback(`Refresh tidak terkonfirmasi: ${error.message}`); notify('Refresh gagal; coba lagi saat server lokal tersedia.');
    } finally { loadingPublic = false; els.refreshBtn.textContent = 'Refresh status ↻'; controls(); }
  }
  async function act(kind) {
    if (!online || busy || !csrf || (kind === 'start' && els.startBtn.disabled) || (kind === 'stop' && els.stopBtn.disabled)) return;
    busy = true; controls(); feedback(kind === 'start' ? 'Mengirim permintaan mulai…' : 'Mengirim permintaan berhenti…');
    try {
      const data = await request(`/api/${kind}`, { method: 'POST', body: JSON.stringify(kind === 'start' ? { confirm: true, address: status.address } : {}) });
      render(data); els.confirmCheck.checked = false;
      feedback(kind === 'start' ? (data.mode === 'demo' ? 'Demo dimulai, tanpa transaksi nyata.' : 'Permintaan mulai diterima. Masukkan password di terminal WSL; refresh manual untuk fase terbaru.') : 'Permintaan berhenti diterima. Refresh manual sampai Berhenti. Dana tidak dilepas.', true);
    } catch (error) { feedback(`${error.message} Periksa status sebelum mencoba lagi.`); notify('Permintaan tidak terkonfirmasi; periksa status.'); }
    finally { busy = false; controls(); await readLocal(); }
  }
  els.confirmCheck.addEventListener('change', controls);
  els.startBtn.addEventListener('click', () => act('start'));
  els.stopBtn.addEventListener('click', () => act('stop'));
  els.refreshBtn.addEventListener('click', refresh);
  readLocal(); // One local/cache read only; no timer and no public fetch on load.
})();
