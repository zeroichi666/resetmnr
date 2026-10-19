#!/usr/bin/env node
// Offline preparation only. No wallet, gateway, signer or worker startup imports.
import { pathToFileURL } from 'node:url';
import { inspectSnapshotRead, appendSnapshotRead } from '../lib/round400-recovery.mjs';
export function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Offline narrow snapshot-read reconciliation; never starts a worker.\n' +
      'Inspect: --journal-dir /absolute/private/directory --address PUBLIC_HEX\n' +
      'Later explicit append: same arguments plus --append --confirm EXACT_INSPECTION_TOKEN\n' +
      'Only audited round400 abandon + one legacy false halt + one snapshot-read false halt.\n' +
      'Cause and round400 outcome remain unknown; round400 stays forbidden.\n' +
      'No other stage or ambiguous intent is eligible. Existing leases are never removed.');
    return 0;
  }
  try {
    const values = new Map(); let append = false;
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i];
      if (key === '--append') {
        if (append) throw Error('Duplicate mode');
        append = true; continue;
      }
      if (!['--journal-dir', '--address', '--confirm'].includes(key) || values.has(key) ||
          !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Invalid, duplicate or missing argument');
      values.set(key, argv[++i]);
    }
    if (!values.has('--journal-dir') || !values.has('--address') || append !== values.has('--confirm'))
      throw Error('Explicit directory/address required; only append requires exact confirmation');
    const options = { directory: values.get('--journal-dir'), address: values.get('--address'),
      confirmation: values.get('--confirm') };
    const { record, ...result } = append ? appendSnapshotRead(options) : inspectSnapshotRead(options);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    console.error(JSON.stringify({ reconciliationVerified: false, workerStartAuthorized: false,
      workerBlockState: 'not-verified-by-this-failed-command',
      auditAppendOutcome: argv.includes('--append') ? 'unknown-check-manually-do-not-retry' : 'not-requested',
      error: e.message }));
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
