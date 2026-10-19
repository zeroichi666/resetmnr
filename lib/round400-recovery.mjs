// Offline only. Never imports the runtime, signer, SDK, wallet, or a backend.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLiveHistory } from './worker-live.mjs';
import { parseLiveJournalBytes } from './worker-live-journal.mjs';
import { ROUND400_FORFEIT_ACK, round400AbandonToken, validateRound400Abandon } from './round400-abandon-policy.mjs';
import { inspectStatus, MAX_LOCK_UNITS } from './worker-policy.mjs';
import { isSnapshotReadHalt, snapshotReadToken, validateSnapshotReadReconciliation } from './snapshot-read-policy.mjs';

const PIN = '6132e8653d6342f36673eb7426ec8e064960e48e';
const GATEWAY = 'https://reset.openmayhem.ai';
const LIMIT = 1024 * 1024;
const NOFOLLOW = fs.constants.O_NOFOLLOW;
const fail = message => { throw new Error(message); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const ROUND400_CONFIRM_PREFIX = 'AUDIT-ONLY-ROUND400-KEEP-WORKER-BLOCKED';

function privateStat(st, directory = false) {
  if (!(directory ? st.isDirectory() : st.isFile()) || st.uid !== process.getuid?.() ||
      (st.mode & 0o7777) !== (directory ? 0o700 : 0o600) || (!directory && st.nlink !== 1))
    fail('Unsafe ownership, mode, type, or hardlink');
}
function openDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory ||
      fs.realpathSync(directory) !== directory) fail('Require canonical absolute directory without symlinks');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | NOFOLLOW);
  try {
    privateStat(fs.fstatSync(fd), true);
    if (fs.realpathSync(`/proc/self/fd/${fd}`) !== directory) fail('Directory changed while opening');
    return fd;
  }
  catch (e) { fs.closeSync(fd); throw e; }
}
function anchor(fd, name) { return `/proc/self/fd/${fd}/${name}`; }
function present(file) {
  try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
function readPrivate(file, append = false, anchored = false) {
  if (!anchored && (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file ||
      fs.realpathSync(file) !== file)) fail('Require canonical absolute file without symlinks');
  const fd = fs.openSync(file, (append ? fs.constants.O_RDWR | fs.constants.O_APPEND : fs.constants.O_RDONLY) | NOFOLLOW);
  try {
    if (!anchored && fs.realpathSync(`/proc/self/fd/${fd}`) !== file) fail('File changed while opening');
    const st = fs.fstatSync(fd); privateStat(st);
    if (st.size < 1 || st.size > LIMIT) fail('Invalid file size');
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) fail('Incomplete file read');
      offset += n;
    }
    const after = fs.fstatSync(fd);
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => after[k] !== st[k])) fail('File changed during read');
    return { fd, bytes, st };
  } catch (e) { fs.closeSync(fd); throw e; }
}
function decode(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
function strictJSON(text) {
  const value = JSON.parse(text);
  // Accept formatting whitespace, but reject duplicate keys, lossy numbers, escaped aliases,
  // and other representations that JSON.parse would silently normalize. Inputs are audit data.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[^\s"]/g);
  if (!tokens || JSON.stringify(value) !== tokens.join('')) fail('Ambiguous or noncanonical JSON');
  return value;
}
function parseJournal(bytes, address) {
  if (typeof address !== 'string' || !/^[0-9a-f]{64}$/.test(address)) fail('Invalid expected public address');
  if (bytes.at(-1) !== 10) fail('Incomplete journal');
  const records = decode(bytes).slice(0, -1).split('\n').map(line => {
    if (!line || line.includes('\r') || Buffer.byteLength(line) + 1 > 65536) fail('Malformed journal line');
    return strictJSON(line);
  });
  const first = records.shift();
  if (!exact(first, ['type', 'identity']) || first.type !== 'identity' ||
      !exact(first.identity, ['address', 'gateway', 'pin']) || first.identity.address !== address ||
      first.identity.gateway !== GATEWAY || first.identity.pin !== PIN) fail('Journal identity mismatch');
  if (records.some(r => r?.type === 'reconciliation_hold')) fail('Already annotated; worker remains blocked; do not repeat');
  const halt = records.pop(), intent = records.pop();
  if (!exact(halt, ['type', 'intentWritten']) || halt.type !== 'halt' || halt.intentWritten !== true)
    fail('Require exactly one trailing halt with intentWritten true');
  if (!exact(intent, ['type', 'action', 'checkpoint']) || intent.type !== 'intent' ||
      !exact(intent.action, ['kind', 'args', 'round']) || intent.action.kind !== 'mine_claim' ||
      intent.action.round !== 400 || !exact(intent.action.args, ['level']) || intent.action.args.level !== 1000 ||
      intent.checkpoint?.round !== 400 || intent.checkpoint.tip !== 972098 || intent.checkpoint.exposure !== '10000000' ||
      intent.checkpoint.tip > intent.checkpoint.claimEnd) fail('Not the exact round 400 claim intent');
  // Existing parser checks ALL prefix records, checkpoints, monotonicity, and lock deduplication.
  validateLiveHistory({ address, history: records });
  const lock = records.at(-1);
  if (lock?.type !== 'observed' || lock.action.kind !== 'lock' || lock.action.round !== 399 ||
      lock.checkpoint.round !== 399 || lock.checkpoint.tip !== 972096 || lock.checkpoint.exposure !== '10000000')
    fail('Missing exact prior observed round 399 lock');
  // Validate the pending checkpoint directly. Never manufacture an observation, even in memory.
  const cp = intent.checkpoint, previous = lock.checkpoint;
  if (!exact(cp, ['round', 'tip', 'counted', 'hash', 'start', 'claimEnd', 'end', 'exposure']) ||
      !['round', 'tip', 'counted', 'start', 'claimEnd', 'end'].every(k => Number.isSafeInteger(cp[k]) && cp[k] >= 0) ||
      typeof cp.hash !== 'string' || !/^[0-9a-f]{64}$/.test(cp.hash) || cp.counted > cp.tip ||
      cp.claimEnd !== cp.start + 2 || cp.end !== cp.start + 5 || cp.tip < cp.start || cp.tip > cp.end ||
      cp.tip < previous.tip || cp.counted < previous.counted) fail('Invalid pending checkpoint');
  return { intent, identity: first.identity, history: [...records, intent, halt] };
}
function assess(bytes, address, evidenceBytes, now) {
  const { intent, identity } = parseJournal(bytes, address);
  if (!Number.isSafeInteger(now) || now < 0) fail('Invalid clock');
  const evidence = strictJSON(decode(evidenceBytes));
  if (!exact(evidence, ['schema', 'capturedAt', 'source', 'tipHash', 'address', 'gateway', 'pin', 'status']) ||
      evidence.schema !== 'reset-round400-status-v1' || evidence.address !== identity.address ||
      evidence.gateway !== identity.gateway || evidence.pin !== identity.pin ||
      evidence.source !== 'externally-captured-read-only-status' ||
      typeof evidence.tipHash !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.tipHash) ||
      !Number.isSafeInteger(evidence.capturedAt) || evidence.capturedAt < now - 300000 || evidence.capturedAt > now)
    fail('Evidence identity/freshness invalid (maximum age 5 minutes; no future timestamp)');
  const raw = evidence.status;
  if (!exact(raw, ['address', 'balance', 'deposit', 'exits', 'tip', 'counted', 'mine', 'moves_left', 'capacity_left', 'strikes', 'claim']) ||
      !exact(raw.mine, ['round', 'start', 'claim_end', 'end', 'window_open']) ||
      !Array.isArray(raw.exits) || raw.exits.some(e => !exact(e, ['amount', 'release'])))
    fail('Require the documented closed status projection, with no extra fields');
  const s = inspectStatus(raw), cp = intent.checkpoint;
  if (raw.address !== address) fail('Status address mismatch');
  if (s.round !== 400) fail('Uncertain: current-round claim null cannot prove round 400 absence in another round');
  if (s.start !== cp.start || s.claimEnd !== cp.claimEnd || s.end !== cp.end || s.windowOpen ||
      s.tip <= cp.claimEnd || s.counted <= cp.claimEnd || s.tip < cp.tip || s.counted < cp.counted)
    fail('Insufficient expiry/counting evidence; keep worker blocked');
  if (raw.claim !== null || s.strikes !== 0 || s.deposit !== MAX_LOCK_UNITS || s.exits !== 0n ||
      s.deposit + s.exits !== BigInt(cp.exposure)) fail('Unsafe claim, strikes, or changed exposure');
  const journalSha256 = sha(bytes), evidenceSha256 = sha(evidenceBytes);
  const confirmation = `${ROUND400_CONFIRM_PREFIX}:${journalSha256}:${evidenceSha256}`;
  const record = {
    type: 'reconciliation_hold', version: 1,
    disposition: 'expired-not-observed-in-supplied-status-NOT-finality',
    evidenceTrust: 'human-supplied-unverified-including-timestamp-and-tip-hash',
    action: intent.action, checkpoint: intent.checkpoint,
    priorObservedLock: { round: 399, tip: 972096, exposure: '10000000' },
    preservedHalt: { type: 'halt', intentWritten: true }, identity,
    journalSha256, evidenceSha256, evidence,
    humanConfirmation: confirmation, workerBlocked: true, replayForbiddenRound: 400
  };
  return { workerBlocked: true, replayForbiddenRound: 400, canAppendAuditOnly: true,
    confirmation, journalSha256, evidenceSha256, record };
}

// Reads only explicit files. No default HOME, wallet discovery, live calls, or startup hooks.
export function inspectRound400({ directory, address, evidenceFile, now = Date.now() }) {
  const dirfd = openDirectory(directory);
  let journal, evidence;
  try {
    journal = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
    evidence = readPrivate(evidenceFile);
    const plan = assess(journal.bytes, address, evidence.bytes, now);
    return { ...plan, leasePresent: present(anchor(dirfd, 'active')) };
  } finally {
    if (journal) fs.closeSync(journal.fd);
    if (evidence) fs.closeSync(evidence.fd);
    fs.closeSync(dirfd);
  }
}

// A confirmed AUDIT annotation, NOT an authorization to resume. Leaves a durable active hold.
// No unlink/rmdir/rename/truncate, no replacement journal, no observed/success record.
export function appendRound400Hold({ directory, address, evidenceFile, confirmation, now = Date.now() }) {
  const plan = inspectRound400({ directory, address, evidenceFile, now });
  if (confirmation !== plan.confirmation) fail('Exact human confirmation required');
  if (plan.leasePresent) fail('Existing lease: refuse; never delete or replace it');
  const dirfd = openDirectory(directory);
  let journal, evidence;
  try {
    // Same name as runtime: mkdir is the atomic exclusion gate; retained even on errors.
    fs.mkdirSync(anchor(dirfd, 'active'), { mode: 0o700 });
    fs.fsyncSync(dirfd);
    journal = readPrivate(anchor(dirfd, 'journal.ndjson'), true, true);
    evidence = readPrivate(evidenceFile);
    const fresh = assess(journal.bytes, address, evidence.bytes, now);
    if (fresh.confirmation !== confirmation) fail('Inputs changed; hold retained, worker blocked');
    const line = Buffer.from(`${JSON.stringify(fresh.record)}\n`);
    if (line.length > 65536 || journal.bytes.length + line.length > LIMIT) fail('Journal size limit; hold retained');
    // Recheck the pathname still identifies the same private file before appending.
    const current = fs.lstatSync(anchor(dirfd, 'journal.ndjson'));
    privateStat(current);
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => current[k] !== journal.st[k]))
      fail('Journal changed; hold retained');
    const recheck = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
    try {
      if (recheck.st.ino !== journal.st.ino || recheck.st.dev !== journal.st.dev ||
          !recheck.bytes.equals(journal.bytes)) fail('Journal bytes changed; hold retained');
    } finally { fs.closeSync(recheck.fd); }
    if (fs.realpathSync(`/proc/self/fd/${dirfd}`) !== directory ||
        fs.lstatSync(directory).ino !== fs.fstatSync(dirfd).ino) fail('Directory changed; hold retained');
    let offset = 0;
    while (offset < line.length) {
      const n = fs.writeSync(journal.fd, line, offset, line.length - offset, null);
      if (!Number.isSafeInteger(n) || n <= 0) fail('Short write; hold retained');
      offset += n;
    }
    fs.fsyncSync(journal.fd);
    return { appended: true, workerBlocked: true, replayForbiddenRound: 400, leaseRetained: true,
      journalSha256Before: fresh.journalSha256, evidenceSha256: fresh.evidenceSha256 };
  } finally {
    if (journal) fs.closeSync(journal.fd);
    if (evidence) fs.closeSync(evidence.fd);
    fs.closeSync(dirfd);
  }
}

function assessAbandon(bytes, address) {
  // The original unresolved history, not a later-round status, is the decision target.
  const { intent, identity } = parseJournal(bytes, address);
  const journalSha256 = sha(bytes), confirmation = round400AbandonToken(journalSha256);
  const record = {
    type: 'abandon_claim', version: 1, identity, action: intent.action, checkpoint: intent.checkpoint,
    journalSha256, confirmation, acknowledgement: ROUND400_FORFEIT_ACK,
    outcome: 'unknown', retryForbiddenRound: 400, futureRoundsOnly: true
  };
  validateRound400Abandon(record, { identity, intent, journalSha256, address });
  const proposed = Buffer.concat([bytes, Buffer.from(`${JSON.stringify(record)}\n`)]);
  const parsed = parseLiveJournalBytes(proposed, identity);
  const state = validateLiveHistory({ ...parsed, address });
  if (state.claimRound !== 400 || state.minimumFutureRound !== 401 || !state.lockAttempted)
    fail('Invalid abandonment parser state');
  return { confirmation, journalSha256, acknowledgementRequired: ROUND400_FORFEIT_ACK,
    outcome: 'unknown', retryForbiddenRound: 400, minimumFutureRound: 401,
    manualStartRequired: true, record };
}

export function inspectRound400Abandon({ directory, address }) {
  const dirfd = openDirectory(directory);
  let journal;
  try {
    journal = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
    return { ...assessAbandon(journal.bytes, address), leasePresent: present(anchor(dirfd, 'active')) };
  } finally {
    if (journal) fs.closeSync(journal.fd);
    fs.closeSync(dirfd);
  }
}

function verifyOwnedLease(dirfd, owned) {
  const active = anchor(dirfd, 'active'), st = fs.lstatSync(active);
  privateStat(st, true);
  if (st.ino !== owned.ino || st.dev !== owned.dev || fs.readdirSync(active).length !== 0)
    fail('Lease changed or is not empty; refuse release; manual review required');
}
function verifyAppendTarget(dirfd, directory, journal) {
  const st = fs.lstatSync(anchor(dirfd, 'journal.ndjson')); privateStat(st);
  if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(k => st[k] !== journal.st[k]))
    fail('Journal changed; lease retained');
  const check = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
  try {
    if (check.st.ino !== journal.st.ino || check.st.dev !== journal.st.dev || !check.bytes.equals(journal.bytes))
      fail('Journal bytes changed; lease retained');
  } finally { fs.closeSync(check.fd); }
  if (fs.realpathSync(`/proc/self/fd/${dirfd}`) !== directory ||
      fs.lstatSync(directory).ino !== fs.fstatSync(dirfd).ino) fail('Directory changed; lease retained');
}

// Shared append mechanics only; each caller supplies its separate closed assessment.
function appendDecision({ directory, address, confirmation }, inspect, assess) {
  const plan = inspect({ directory, address });
  if (confirmation !== plan.confirmation) fail('Exact hash-bound confirmation required');
  if (plan.leasePresent) fail('Existing lease: refuse; never take over, delete, or replace it');
  const dirfd = openDirectory(directory);
  let journal, owned;
  try {
    const active = anchor(dirfd, 'active');
    fs.mkdirSync(active, { mode: 0o700 }); // Atomic exclusion; no automatic stale-lease cleanup.
    owned = fs.lstatSync(active); privateStat(owned, true);
    fs.fsyncSync(dirfd);
    journal = readPrivate(anchor(dirfd, 'journal.ndjson'), true, true);
    const fresh = assess(journal.bytes, address);
    if (fresh.confirmation !== confirmation) fail('Journal hash changed; lease retained');
    const line = Buffer.from(`${JSON.stringify(fresh.record)}\n`);
    if (line.length > 65536 || journal.bytes.length + line.length > LIMIT) fail('Journal size limit; lease retained');
    verifyAppendTarget(dirfd, directory, journal);
    verifyOwnedLease(dirfd, owned);
    let offset = 0;
    while (offset < line.length) {
      const n = fs.writeSync(journal.fd, line, offset, line.length - offset, null);
      if (!Number.isSafeInteger(n) || n <= 0) fail('Short write; lease retained');
      offset += n;
    }
    fs.fsyncSync(journal.fd);
    // Verify exact durable bytes AND the same parser used by a future manual start.
    const verified = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
    try {
      if (verified.st.ino !== journal.st.ino || verified.st.dev !== journal.st.dev ||
          !verified.bytes.equals(Buffer.concat([journal.bytes, line]))) fail('Post-append audit mismatch; lease retained');
      const parsed = parseLiveJournalBytes(verified.bytes, fresh.record.identity);
      const state = validateLiveHistory({ ...parsed, address });
      if (state.claimRound !== 400 || state.minimumFutureRound !== 401 || !state.lockAttempted)
        fail('Post-append parser mismatch; lease retained');
    } finally { fs.closeSync(verified.fd); }
    // Close before release. A close failure must not remove the lease.
    fs.closeSync(journal.fd); journal = undefined;
    if (fs.realpathSync(`/proc/self/fd/${dirfd}`) !== directory) fail('Directory changed; lease retained');
    verifyOwnedLease(dirfd, owned);
    try {
      fs.rmdirSync(active); // Only the newly acquired, inode-checked, empty recovery lease.
      fs.fsyncSync(dirfd);
    } catch (e) {
      // Removal/fsync can be ambiguous. Re-establish a block only if absent, never replace a lease.
      try { fs.mkdirSync(active, { mode: 0o700 }); fs.fsyncSync(dirfd); } catch {}
      throw new Error(`Lease release uncertain; manual review required; do not retry: ${e.message}`);
    }
    return { appended: true, outcome: 'unknown', retryForbiddenRound: 400, minimumFutureRound: 401,
      leaseReleased: true, manualStartRequired: true, workerStarted: false, journalSha256Before: fresh.journalSha256 };
  } finally {
    // Never remove any lease on an exception. A crash or uncertain write requires manual review.
    if (journal) { try { fs.closeSync(journal.fd); } catch {} }
    fs.closeSync(dirfd);
  }
}

// No claim result is inferred. Irrevocable local NO-RETRY / MAY-FORFEIT decision.
export function appendRound400Abandon(options) {
  if (options.acknowledgement !== ROUND400_FORFEIT_ACK)
    fail('Exact hash-bound confirmation AND explicit reward-forfeiture acknowledgement required');
  return appendDecision(options, inspectRound400Abandon, assessAbandon);
}

function assessSnapshotRead(bytes, address) {
  const identity = { address, gateway: GATEWAY, pin: PIN };
  const parsed = parseLiveJournalBytes(bytes, identity), records = parsed.history;
  if (!isSnapshotReadHalt(records.at(-1)) || records.at(-3)?.type !== 'abandon_claim' ||
      !exact(records.at(-2), ['type', 'intentWritten']) || records.at(-2).type !== 'halt' ||
      records.at(-2).intentWritten !== false) fail('Require exact abandon, legacy halt, snapshot-read halt tail');
  // Validate ALL earlier bytes, including the original abandonment audit. No
  // pending intent, later action, second legacy marker, hold or other stage allowed.
  const prefix = { history: records.slice(0, -1), audit: { identity: parsed.audit.identity,
    prefixSha256: parsed.audit.prefixSha256.slice(0, -1) }, address };
  const before = validateLiveHistory(prefix);
  if (before.claimRound !== 400 || before.minimumFutureRound !== 401 || !before.lockAttempted)
    fail('Invalid prior abandonment state');
  const journalSha256 = sha(bytes), confirmation = snapshotReadToken(journalSha256);
  const record = { type: 'reconcile_snapshot_read', version: 1, identity, journalSha256, confirmation,
    preservedHalt: structuredClone(records.at(-1)), cause: 'unknown', outcome: 'unknown',
    retryForbiddenRound: 400, minimumFutureRound: 401, workerStartAuthorized: false };
  validateSnapshotReadReconciliation(record, { identity, address, journalSha256 });
  const proposed = Buffer.concat([bytes, Buffer.from(`${JSON.stringify(record)}\n`)]);
  const after = validateLiveHistory({ ...parseLiveJournalBytes(proposed, identity), address });
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('Reconciliation changed worker safety state');
  return { confirmation, journalSha256, cause: 'unknown', outcome: 'unknown', retryForbiddenRound: 400,
    minimumFutureRound: 401, manualStartRequired: true, workerStartAuthorized: false, record };
}

// Explicit paths only. Does not discover wallets, touch leases or contact a gateway.
export function inspectSnapshotRead({ directory, address }) {
  const dirfd = openDirectory(directory);
  let journal;
  try {
    journal = readPrivate(anchor(dirfd, 'journal.ndjson'), false, true);
    return { ...assessSnapshotRead(journal.bytes, address), leasePresent: present(anchor(dirfd, 'active')) };
  } finally {
    if (journal) fs.closeSync(journal.fd);
    fs.closeSync(dirfd);
  }
}

// Prepared for a separate, future human-confirmed invocation; never called by startup.
export function appendSnapshotRead(options) {
  return { ...appendDecision(options, inspectSnapshotRead, assessSnapshotRead),
    cause: 'unknown', workerStartAuthorized: false };
}
