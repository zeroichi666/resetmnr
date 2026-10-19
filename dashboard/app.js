(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = Object.fromEntries(['connection', 'connectionText', 'offlineBanner', 'liveRegion', 'phaseLabel', 'phasePill', 'address', 'mode', 'startedAt', 'lastChecked', 'lastAction', 'eventsList', 'confirmCheck', 'startBtn', 'stopBtn', 'actionFeedback', 'terminalHint', 'journalState', 'journalEmpty', 'journalData', 'journalKind', 'journalRound', 'journalExposure', 'journalTip', 'blockBanner', 'blockReason', 'modeBanner'].map(id => [id, $(id)]));
  let status = null, csrf = '', online = false, busy = false, polling = false;
  const phases = { idle: ['Siap', 'IDLE'], starting: ['Memulai', 'STARTING'], running: ['Berjalan', 'RUNNING'], stopping: ['Menghentikan', 'STOPPING'], stopped: ['Berhenti', 'STOPPED'], error: ['Error · periksa manual', 'ERROR'] };
  const safe = (value, fallback = '—') => value === null || value === undefined || value === '' ? fallback : String(value);
  const date = value => { if (!value) return 'Belum ada'; const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Tidak diketahui' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' }); };
  const exposure = value => { if (!/^(0|[1-9][0-9]{0,7})$/.test(value)) return 'Tidak diketahui'; const n = BigInt(value); return `${n / 100000000n}.${String(n % 100000000n).padStart(8, '0').replace(/0+$/, '') || '0'} RESET`; };
  const notify = message => { els.liveRegion.textContent = message; };
  const feedback = (message, good = false) => { els.actionFeedback.hidden = !message; els.actionFeedback.textContent = message || ''; els.actionFeedback.classList.toggle('ok', good); };
  function updateControls() {
    const phase = status?.phase;
    els.startBtn.disabled = !(online && csrf && !busy && !status?.blocked && ['idle', 'stopped'].includes(phase) && els.confirmCheck.checked);
    els.stopBtn.disabled = !(online && csrf && !busy && ['starting', 'running'].includes(phase));
    els.confirmCheck.disabled = !online || busy || status?.blocked || !['idle', 'stopped'].includes(phase);
  }
  function setOnline(value) {
    online = value;
    els.connection.classList.toggle('online', value); els.connection.classList.toggle('offline', !value);
    els.connectionText.textContent = value ? 'Terhubung lokal' : 'Offline';
    els.offlineBanner.hidden = value; els.offlineBanner.setAttribute('aria-hidden', String(value));
    if (!value) { els.phaseLabel.textContent = 'Status tidak diketahui'; els.phasePill.textContent = 'OFFLINE'; els.phasePill.className = 'pill neutral'; }
    updateControls();
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
  function render(data) {
    if (!data || !Object.hasOwn(phases, data.phase) || typeof data.csrf !== 'string' || !/^[0-9a-f]{64}$/.test(data.address)) throw new Error('Status lokal tidak valid');
    const changed = status?.phase !== data.phase;
    status = data; csrf = data.csrf;
    const phase = phases[data.phase]; els.phaseLabel.textContent = phase[0]; els.phasePill.textContent = phase[1]; els.phasePill.className = `pill ${data.phase}`;
    els.address.textContent = data.address; els.mode.textContent = data.mode === 'live' ? 'LIVE · transaksi nyata' : 'DEMO · sintetis';
    els.modeBanner.hidden = data.mode !== 'demo'; els.startedAt.textContent = date(data.startedAt);
    els.lastChecked.textContent = `Langkah worker terakhir: ${date(data.lastCheckedAt)}`;
    const a = data.lastAction; els.lastAction.textContent = a ? `${safe(a.kind)}${Number.isSafeInteger(a.round) ? ` · ronde ${a.round}` : ''}${a.reason ? ` · ${a.reason}` : ''}` : 'Belum ada langkah worker';
    els.blockBanner.hidden = !data.blocked; els.blockReason.textContent = data.blockReason || '';
    renderJournal(data.journal); renderEvents(data.events);
    if (data.mode === 'demo') els.terminalHint.textContent = 'Demo hanya memakai data sintetis di memori. Tidak ada password, wallet, atau transaksi nyata.';
    else if (data.phase === 'starting') els.terminalHint.textContent = 'Masukkan password wallet di terminal WSL. Password tidak pernah diminta di halaman ini.';
    else if (data.phase === 'stopping') els.terminalHint.textContent = 'Menunggu operasi aktif selesai/abort. Transaksi yang sudah terkirim tidak dibatalkan; dana tidak dibuka.';
    else els.terminalHint.textContent = 'Setelah klik Mulai, masukkan password di terminal WSL. Menutup tab ini tidak menghentikan worker; gunakan tombol Hentikan atau Ctrl+C di terminal.';
    if (changed) notify(`Status worker: ${phase[0]}.`);
    updateControls();
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-Reset-Token': csrf } : {}) }, cache: 'no-store', signal: AbortSignal.timeout(6000) });
    let body; try { body = await response.json(); } catch { throw new Error('Respons lokal tidak valid'); }
    if (!response.ok) throw new Error(body?.error || `Permintaan gagal (${response.status})`);
    return body;
  }
  async function poll() {
    if (polling || busy) return; polling = true;
    try { const data = await request('/api/status'); render(data); setOnline(true); }
    catch (error) { status = null; csrf = ''; setOnline(false); feedback(`Tidak dapat membaca status: ${error.message}`); notify('Koneksi offline. Status worker tidak diketahui; worker mungkin masih berjalan.'); }
    finally { polling = false; }
  }
  async function act(kind) {
    if (!online || busy || !csrf || (kind === 'start' && els.startBtn.disabled) || (kind === 'stop' && els.stopBtn.disabled)) return;
    busy = true; updateControls(); feedback(kind === 'start' ? 'Mengirim permintaan mulai…' : 'Mengirim permintaan berhenti…');
    try {
      const data = await request(`/api/${kind}`, { method: 'POST', body: JSON.stringify(kind === 'start' ? { confirm: true, address: status.address } : {}) });
      render(data); els.confirmCheck.checked = false;
      feedback(kind === 'start' ? (data.mode === 'demo' ? 'Demo dimulai, tanpa transaksi nyata.' : 'Permintaan mulai diterima. Masukkan password di terminal WSL; tunggu status Berjalan.') : 'Permintaan berhenti diterima. Tunggu status Berhenti. Dana tidak dilepas.', true);
    } catch (error) { feedback(`${error.message} Periksa status sebelum mencoba lagi.`); notify('Permintaan tidak terkonfirmasi; periksa status.'); }
    finally { busy = false; updateControls(); await poll(); }
  }
  els.confirmCheck.addEventListener('change', updateControls);
  els.startBtn.addEventListener('click', () => act('start')); els.stopBtn.addEventListener('click', () => act('stop'));
  poll(); setInterval(poll, 2000);
})();
