import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const JOURNAL_NAME = 'journal.ndjson';
const LEASE_NAME = 'active';
const MAX_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MODE_DIR = 0o700;
const MODE_FILE = 0o600;
const GATEWAY = 'https://reset.openmayhem.ai';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function fail(message) { throw new Error(message); }
function clone(value) { try { return structuredClone(value); } catch { fail('record must be structured-cloneable'); } }
function validateIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) || Object.keys(identity).length !== 3 ||
      typeof identity.address !== 'string' || typeof identity.gateway !== 'string' || typeof identity.pin !== 'string' ||
      !/^[0-9a-f]{64}$/.test(identity.address) || identity.gateway !== GATEWAY || !/^[0-9a-f]{40}$/.test(identity.pin))
    fail('invalid journal identity');
  return { address: identity.address, gateway: identity.gateway, pin: identity.pin };
}
function lstatNoSymlink(p, what) {
  let s;
  try { s = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (s.isSymbolicLink()) fail(`${what} must not be a symlink`);
  return s;
}
function checkDir(s) {
  if (!s.isDirectory()) fail('directory must be a regular directory');
  if (s.uid !== process.getuid?.()) fail('directory ownership mismatch');
  if ((s.mode & 0o7777) !== MODE_DIR) fail('directory mode must be 700');
}
function checkFile(s) {
  if (!s.isFile()) fail('journal file must be a regular file');
  if (s.uid !== process.getuid?.()) fail('journal file ownership mismatch');
  if ((s.mode & 0o7777) !== MODE_FILE) fail('journal file mode must be 600');
  if (s.nlink !== 1) fail('journal file must not be hard-linked');
}
function encode(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('journal record must be an object');
  const copy = clone(record);
  let json; try { json = JSON.stringify(copy); } catch { fail('journal record must be JSON-serializable'); }
  if (!json || json === 'null' || json.includes('\n') || json.includes('\r')) fail('invalid journal record');
  const bytes = Buffer.byteLength(json) + 1;
  if (bytes > MAX_RECORD_BYTES) fail('journal record exceeds size limit');
  return { copy, line: `${json}\n`, bytes };
}
function syncDir(dir) {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeComplete(fd, line) {
  const bytes = Buffer.from(line, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
    if (!Number.isSafeInteger(written) || written <= 0) fail('journal short write');
    offset += written;
  }
}
export function parseLiveJournalBytes(raw, identity) {
  identity = validateIdentity(identity);
  if (raw.length === 0 || raw.length > MAX_BYTES || raw[raw.length - 1] !== 10) fail('journal must contain complete newline records');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const lines = text.slice(0, -1).split('\n');
  let first; const history = [], prefixSha256 = [], hash = createHash('sha256');
  for (const line of lines) {
    if (!line || line.includes('\r') || Buffer.byteLength(line) + 1 > MAX_RECORD_BYTES) fail('journal contains malformed record');
    let value; try { value = JSON.parse(line); } catch { fail('journal contains malformed record'); }
    const tokens = line.match(/"(?:[^"\\]|\\.)*"|[^\s"]/g);
    if (!tokens || JSON.stringify(value) !== tokens.join('')) fail('journal contains ambiguous JSON');
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('journal record must be an object');
    if (first === undefined) first = value;
    else { prefixSha256.push(hash.copy().digest('hex')); history.push(clone(value)); }
    hash.update(`${line}\n`);
  }
  let stored; try { stored = validateIdentity(first?.identity); } catch { fail('journal identity mismatch'); }
  if (Object.keys(first).sort().join(',') !== 'identity,type' || first.type !== 'identity' ||
      stored.address !== identity.address || stored.gateway !== identity.gateway || stored.pin !== identity.pin)
    fail('journal identity mismatch');
  return { history, audit: { identity: clone(identity), prefixSha256 } };
}

export function openLiveJournal(directory, { identity } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('journal directory must be an absolute path');
  const id = validateIdentity(identity);
  let ds = lstatNoSymlink(directory, 'directory');
  if (!ds) {
    try { fs.mkdirSync(directory, MODE_DIR); syncDir(path.dirname(directory)); } catch (e) { throw new Error(`journal directory unavailable: ${e.message}`); }
    ds = lstatNoSymlink(directory, 'directory');
  }
  checkDir(ds);
  const active = path.join(directory, LEASE_NAME);
  try { fs.mkdirSync(active, MODE_DIR); syncDir(directory); } catch (e) { throw new Error(`journal lease unavailable: ${e.message}`); }

  const file = path.join(directory, JOURNAL_NAME);
  let fd;
  let created = false;
  let poisoned = false;
  let closed = false;
  try {
    try { fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_APPEND | NOFOLLOW); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, MODE_FILE);
      created = true;
    }
    const st = fs.fstatSync(fd); checkFile(st);
    let history, audit, raw;
    if (st.size === 0) {
      if (!created) fail('existing empty journal requires manual review');
      const initial = encode({ type: 'identity', identity: id });
      try { writeComplete(fd, initial.line); fs.fsyncSync(fd); syncDir(directory); } catch (e) { poisoned = true; throw e; }
      history = []; raw = Buffer.from(initial.line);
      audit = { identity: clone(id), prefixSha256: [] };
    } else {
      if (st.size > MAX_BYTES) fail('journal exceeds size limit');
      raw = fs.readFileSync(fd);
      ({ history, audit } = parseLiveJournalBytes(raw, id));
    }
    const state = { history: history.map(clone), size: raw.length,
      audit: clone(audit), hash: createHash('sha256').update(raw) };
    return {
      get history() { return state.history.map(clone); },
      get audit() { return clone(state.audit); },
      append(record) {
        if (closed) fail('journal is closed');
        if (poisoned) fail('journal is poisoned');
        const encoded = encode(record);
        if (state.size + encoded.bytes > MAX_BYTES) fail('journal exceeds size limit');
        try { checkFile(fs.fstatSync(fd)); writeComplete(fd, encoded.line); fs.fsyncSync(fd); }
        catch (e) { poisoned = true; throw new Error(`journal write failed: ${e.message}`); }
        state.audit.prefixSha256.push(state.hash.copy().digest('hex'));
        state.hash.update(encoded.line);
        state.size += encoded.bytes; state.history.push(encoded.copy);
      },
      close() {
        if (closed) return;
        if (poisoned) { try { fs.closeSync(fd); } catch {} closed = true; throw new Error('journal is poisoned; lease retained'); }
        try { fs.closeSync(fd); fs.rmdirSync(active); syncDir(directory); closed = true; }
        catch (e) {
          try { fs.mkdirSync(active, MODE_DIR); syncDir(directory); } catch {}
          closed = true; throw new Error(`journal lease release failed; manual review required: ${e.message}`);
        }
      }
    };
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    throw e;
  }
}
export const LIVE_JOURNAL_LIMIT = MAX_BYTES;
