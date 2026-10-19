import fs from 'node:fs';
import { join } from 'node:path';
import { PIN } from './paths.mjs';
import { validateLiveHistory } from './worker-live.mjs';
import { parseLiveJournalBytes } from './worker-live-journal.mjs';

export function inspectDashboardJournal(directory, address) {
  let dir;
  try { dir = fs.lstatSync(directory); } catch (e) { if (e.code === 'ENOENT') return { leasePresent: false, lastObserved: null }; throw e; }
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o7777) !== 0o700) throw new Error('Unsafe journal directory');
  let leasePresent = false;
  try { fs.lstatSync(join(directory, 'active')); leasePresent = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let fd;
  try {
    fd = fs.openSync(join(directory, 'journal.ndjson'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o7777) !== 0o600 || st.nlink !== 1 || st.size < 1 || st.size > 1024 * 1024) throw new Error('Unsafe journal');
    // Bounded read even if the file grows after fstat.
    const buffer = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < buffer.length) { const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!n) throw new Error('Incomplete journal'); offset += n; }
    // Validate the exact raw prefixes, including whitespace, just as the worker does.
    // The pure validator needs audit metadata for the narrowly allowed round-400
    // abandonment and its one immediate exact legacy false halt. All other
    // unresolved intents, halts and holds still fail closed.
    // Never open a writable journal, acquire/release a lease, or construct a worker.
    const { history: records, audit } = parseLiveJournalBytes(buffer, { address, gateway: 'https://reset.openmayhem.ai', pin: PIN });
    validateLiveHistory({ history: records, audit, address });
    let lastObserved = null;
    for (const r of records) if (r.type === 'observed') {
      if (!['lock', 'mine_claim'].includes(r.action?.kind) || !Number.isSafeInteger(r.action.round) || !Number.isSafeInteger(r.checkpoint?.tip) || !/^(0|[1-9][0-9]{0,7})$/.test(r.checkpoint?.exposure)) throw new Error('Invalid observation');
      lastObserved = { kind: r.action.kind, round: r.action.round, exposureUnits: r.checkpoint.exposure, tip: r.checkpoint.tip };
    }
    return { leasePresent, lastObserved };
  } catch (e) { if (e.code === 'ENOENT') return { leasePresent, lastObserved: null }; throw e; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
