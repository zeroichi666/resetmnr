import fs from 'node:fs';
import { join } from 'node:path';
import { PIN } from './paths.mjs';
import { LiveWorker } from './worker-live.mjs';

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
    if (buffer.at(-1) !== 10) throw new Error('Incomplete journal');
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(buffer).trimEnd().split('\n');
    const records = lines.map(line => { if (Buffer.byteLength(line) > 65535) throw new Error('Oversize record'); return JSON.parse(line); });
    const first = records.shift();
    if (first?.type !== 'identity' || first.identity?.address !== address || first.identity?.gateway !== 'https://reset.openmayhem.ai' || first.identity?.pin !== PIN) throw new Error('Wrong journal identity');
    // Constructor validates strict history ordering, checkpoints, pending intents/halt.
    // It does not step, open a wallet, write a journal, or call this synthetic port.
    const deny = () => { throw new Error('Read-only observer'); };
    new LiveWorker({ address, journal: { history: records, append: deny }, port: Object.fromEntries(['readSnapshot', 'prepare', 'solve', 'verifySigned', 'submit'].map(name => [name, deny])) });
    let lastObserved = null;
    for (const r of records) if (r.type === 'observed') {
      if (!['lock', 'mine_claim'].includes(r.action?.kind) || !Number.isSafeInteger(r.action.round) || !Number.isSafeInteger(r.checkpoint?.tip) || !/^(0|[1-9][0-9]{0,7})$/.test(r.checkpoint?.exposure)) throw new Error('Invalid observation');
      lastObserved = { kind: r.action.kind, round: r.action.round, exposureUnits: r.checkpoint.exposure, tip: r.checkpoint.tip };
    }
    return { leasePresent, lastObserved };
  } catch (e) { if (e.code === 'ENOENT') return { leasePresent, lastObserved: null }; throw e; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
