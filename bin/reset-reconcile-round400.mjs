#!/usr/bin/env node
// Offline maintenance only. Never imports runtime/startup, wallet, signer, or a backend.
import { pathToFileURL } from 'node:url';
import { inspectRound400, appendRound400Hold, inspectRound400Abandon, appendRound400Abandon } from '../lib/round400-recovery.mjs';

export function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Offline round 400 maintenance; never starts a worker.\n' +
      'Always specify: --journal-dir /absolute/private/directory --address PUBLIC_HEX\n' +
      'Abandon inspection: --abandon (no evidence required or accepted)\n' +
      'Abandon decision: --append-abandon --confirm EXACT_HASH_TOKEN --acknowledge-forfeit EXACT_ACK_TEXT\n' +
      'Outcome remains UNKNOWN; round 400 is never retried; any reward may be forfeited.\n' +
      'A successful abandon releases only its new recovery lease; a future MANUAL start is separate.\n' +
      'Evidence-hold inspection: --evidence /absolute/private/evidence.json\n' +
      'Evidence-hold append: --evidence /absolute/private/evidence.json --append-hold --confirm EXACT_TOKEN\n' +
      'The evidence-hold path remains terminal and does not authorize later rounds.');
    return 0;
  }
  try {
    const values = new Map(), modes = new Set();
    const accepted = new Set(['--journal-dir', '--address', '--evidence', '--confirm', '--acknowledge-forfeit']);
    const flags = new Set(['--abandon', '--append-abandon', '--append-hold']);
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i];
      if (flags.has(key)) {
        if (modes.size || modes.has(key)) throw new Error('Modes must be unique and mutually exclusive');
        modes.add(key); continue;
      }
      if (!accepted.has(key) || values.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error('Invalid, duplicate, or missing CLI argument');
      values.set(key, argv[++i]);
    }
    if (!['--journal-dir', '--address'].every(k => values.has(k))) throw new Error('Explicit paths/address required');
    const abandon = modes.has('--abandon') || modes.has('--append-abandon');
    const append = modes.has('--append-abandon') || modes.has('--append-hold');
    if (append !== values.has('--confirm')) throw new Error('Append requires exact --confirm; inspection must not supply it');
    if (abandon ? values.has('--evidence') : !values.has('--evidence'))
      throw new Error('Abandon uses the explicit decision, not evidence; hold requires evidence');
    if (modes.has('--append-abandon') !== values.has('--acknowledge-forfeit'))
      throw new Error('Only --append-abandon requires --acknowledge-forfeit');
    const options = { directory: values.get('--journal-dir'), address: values.get('--address'),
      evidenceFile: values.get('--evidence'), confirmation: values.get('--confirm'),
      acknowledgement: values.get('--acknowledge-forfeit') };
    const result = abandon
      ? (append ? appendRound400Abandon(options) : inspectRound400Abandon(options))
      : (append ? appendRound400Hold(options) : inspectRound400(options));
    const { record, ...publicResult } = result;
    console.log(JSON.stringify(publicResult, null, 2));
    return 0;
  } catch (e) {
    console.error(JSON.stringify({ workerStartAuthorized: false, reconciliationVerified: false,
      workerBlockState: 'not-verified-by-this-failed-command',
      auditAppendOutcome: argv.some(a => ['--append-hold', '--append-abandon'].includes(a))
        ? 'unknown-check-manually-do-not-retry' : 'not-requested', error: e.message }));
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
