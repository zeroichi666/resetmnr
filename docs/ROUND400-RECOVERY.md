# Round 400: abandon the uncertain claim, never retry it

**Preparation only. Nothing has been applied to the user's journal or wallet, and no live worker has been started.** This code supports a later, separate local operator decision. Review the changes before copying them to the user's WSL checkout at `~/src/resetmnr`.

## What the operator is deciding

The exact unresolved intent is `mine_claim`, round **400**, level **1000**, exposure **10000000** units (0.1 RESET), checkpoint tip **972098**. It follows the recorded lock for round **399**, tip **972096**, exposure **10000000**, and is followed by `halt` with `intentWritten: true`.

The operator may explicitly **abandon further attempts for round 400 with outcome unknown**, acknowledging that any round-400 reward may be forfeited. This is not a finding that the submission failed or that no claim was applied. The existing intent and halt remain in the journal; no claim observation or success is invented.

A valid abandonment consumes round 400 for deduplication. A future manually started worker may act only in round **401 or later**, under the existing total exposure cap `deposit + all exits <= 0.1 RESET`, claim level 1000, monotonic state checks, and no-top-up/no-relock history rules. This tool never starts, restarts, schedules, or unlocks a worker.

## Why no status evidence is required for abandonment

The installed upstream `signer/lib/local-state.mjs` validates account and state as the same **current** round and displays that round's claim. `claim: null` in a later round cannot establish whether the round-400 claim was applied. The old tip 972102 / counted 972097 snapshot is also insufficient as confirmation of the expired intent's outcome.

The abandonment path therefore uses **the explicit no-retry/forfeit decision**, not status evidence or an assertion of non-application. It does not accept an evidence file. The record says `outcome: unknown` permanently, even if a later status has no claim.

## Step 1: inspect locally, without writing

These commands are examples for a **future authorized operator session**. None was run on the user's WSL files in this work. Use Node.js 24+ on Linux/WSL; native Windows is not supported because the implementation anchors file access through `/proc/self/fd`.

Use the actual absolute directory of the existing journal and the verified public address of the existing wallet. There are no implicit HOME paths or wallet discovery:

```bash
node bin/reset-reconcile-round400.mjs \
  --abandon \
  --journal-dir /ABSOLUTE/EXISTING/JOURNAL_DIRECTORY \
  --address PUBLIC_ADDRESS_64_HEX
```

Inspection validates the complete prefix, exact pending target, preceding lock, halt, public identity, fixed gateway `https://reset.openmayhem.ai`, and upstream pin `6132e8653d6342f36673eb7426ec8e064960e48e`. The gateway is metadata only and is not contacted. Inspection creates no lease and writes nothing.

It returns a confirmation token of the form:

```text
ABANDON-CLAIM400-OUTCOME-UNKNOWN-NO-RETRY:<SHA256_OF_ALL_ORIGINAL_JOURNAL_BYTES>
```

The hash covers the actual original bytes, including identity, complete history, intent, halt, whitespace, and final newline. It is not reconstructed from parsed JSON. Any byte change invalidates the old token. Missing or invalid identity, wrong action/round/level/tip/exposure, missing or additional halt, another pending action, existing abandonment, or prior evidence-hold annotation causes rejection.

If `leasePresent: true`, stop. The tool does not take over, remove, rename, or replace any existing lease, even one that looks stale. A worker may still be active, or a previous crash may require manual review. The tool does not inspect or manage processes.

## Step 2: an explicit, separate operator action

After reading the inspection, reviewing the target, and consciously deciding never to retry round 400, the operator may run:

```bash
node bin/reset-reconcile-round400.mjs \
  --append-abandon \
  --journal-dir /ABSOLUTE/EXISTING/JOURNAL_DIRECTORY \
  --address PUBLIC_ADDRESS_64_HEX \
  --confirm 'EXACT_TOKEN_FROM_REVIEWED_INSPECTION' \
  --acknowledge-forfeit 'I ACCEPT THAT ANY ROUND-400 REWARD MAY BE FORFEITED; NEVER RETRY ROUND 400'
```

Both the complete hash-bound token and the exact acknowledgment are mandatory. Do not automate inspection-to-append token copying. The user's approval to prepare this code is **not** permission to apply it to the real journal now.

The tool acquires a new `active` lease only if none exists, records its inode/device identity, fsyncs the directory, re-reads and revalidates the original bytes, and appends exactly one `abandon_claim` record on the existing journal inode. It does not truncate, replace, reorder, or delete journal records.

The record contains the identity, exact action and checkpoint, raw-prefix hash, full confirmation, acknowledgment, `outcome: unknown`, `retryForbiddenRound: 400`, and `futureRoundsOnly: true`. It contains no claim of observed application or confirmed failure.

After fsync, the tool re-reads the entire journal and validates it through the same pure history validator used by `LiveWorker`. It closes the journal descriptor before releasing **only its own new, inode-checked, empty recovery lease**, then fsyncs the parent directory. Successful output includes `leaseReleased: true`, `manualStartRequired: true`, `minimumFutureRound: 401`, and `workerStarted: false`.

**Stop there.** A later worker invocation is a separate manual action. There is no `resume`, `force`, generic halt-clear, retry-round, startup hook, or daemon launch in this command.

## Restart and parser guarantees

`LiveWorker` accepts only the narrowly defined sequence:

```text
... valid prior history and observed lock399
intent claim400
halt {intentWritten:true}
abandon_claim {exact validated decision}
halt {intentWritten:false}    # optional ONE exact legacy marker, immediately here
... eligible round401-or-later history
```

The optional legacy marker is recognized automatically by the shared read-only parser, not cleared, deleted, rewritten or converted to success. It must have exactly the keys `type` and `intentWritten`, with boolean `false`, immediately after the already validated abandonment, with no pending intent. No other position, second marker, missing flag, extra field or truthy/string flag is accepted. Later normal future-round history is still validated so that a separately requested manual start can append a claim and remain restartable. The original `halt:true` target and abandonment still require the exact audit, identity, hash/token and forfeiture acknowledgment.

This removes the dashboard journal blocker **only for that legacy sequence and only without an existing lease**. It does not diagnose or fix the original runtime error, establish that an attempted submission did not apply, abandon any new intent, or authorize retry of round 400. No inspection starts a worker, unlocks a wallet, reads the gateway, writes a journal or removes a lease. A fresh dashboard process can offer manual Start; an existing dashboard session in its error phase remains blocked. Closing/reopening the dashboard does not itself start a worker. All current snapshot and exposure checks run again on any separately authorized manual start.

Every other halt remains sticky. New non-action runtime/startup failures include a fixed `failureStage` category and are deliberately **not** eligible for this legacy exception, including a newly detected exposure regression immediately after abandonment. `halt:true`, pending intent (even with a false flag), unknown record, duplicate abandonment, forged hash, incorrect acknowledgment, altered identity/checkpoint/action, missing raw-prefix metadata, or abandonment for any other target fails closed. An evidence hold cannot be converted by this version. Journal write/fsync uncertainty and bad/existing leases remain blocking; post-append recovery still requires exactly the intended durable bytes, even if an unexpected extra marker would otherwise parse.

A separate, explicitly confirmed [snapshot-read audit](SNAPSHOT-READ-RECONCILIATION.md) is now prepared for exactly one classified `snapshot-read` false halt immediately after that one legacy marker. It is not automatic legacy compatibility: without its valid hash-bound append-only audit, the new halt stays blocked. No other stage, later halt, or ambiguous intent qualifies; round 400 remains forbidden, the cause remains unknown, and startup is not authorized. Preparation does not apply this to the user's WSL journal.

CLI/dashboard errors now expose only a locally generated allowlisted stage, such as `snapshot-read`, `snapshot-validation`, `snapshot-monotonicity`, `journal-intent`, or `startup-unlock`. A stage is a diagnostic category, not proof of root cause: `snapshot-read` also includes validation inside the signer port. No arbitrary exception text, cause, remote error code, token, password, wallet material or hash is exposed. A legacy halt contains no such diagnosis, so its historical root cause cannot be reconstructed. Post-intent halt records retain their original exact schema for the existing abandonment protocol.

The persistent journal exposes a copy of its validated identity and SHA-256 of the exact byte prefix before each history record. The worker compares the abandonment's hash and token with that independently computed raw-prefix metadata. Later appends maintain these hashes, including across journal reopen.

The parser keeps the original lock-attempt marker and last checkpoint, consumes claim round 400, and enforces a minimum future round of 401. Round 400 is forbidden both when parsing appended history and before making any new decision. Returning to an earlier round, losing exposure, changing boundaries or hashes inconsistently, unsafe claims, or exceeding the cap remains fail-closed. A disappeared/partial deposit cannot trigger another lock or top-up.

This is a local audit/decision protocol, not protection against someone deliberately editing the journal and its confirmations. Files and ancestor directories must remain under the trusted user's control. Lease exclusion coordinates cooperating programs; it is not an atomic filesystem lock against a malicious same-UID process swapping files between system calls.

## Crashes, errors, and file safety

The journal directory must already exist, be canonical/absolute, owned by the current user, mode `700`, and not traverse symlinks. The journal must be a private regular file, mode `600`, single-link, bounded in size, with complete UTF-8 newline records. Ambiguous JSON, duplicate keys, malformed records, symlinks, hardlinks, unsafe permissions, identity mismatch, and concurrently changed inputs are rejected.

A crash or error after lease acquisition normally leaves the recovery lease in place. Partial writes, fsync failures, failed post-write validation, close errors, changed/nonempty leases, and uncertain cleanup must not cause an automatic retry or generic lease deletion. If lease removal or its directory fsync fails, the code attempts to re-establish a hold **only if absent**, never replacing another lease; the result remains uncertain and requires manual review. If even that attempt fails, the CLI does not promise a verified block.

If a crash occurs after the record was durable but before lease cleanup, the record may already exist. Duplicate abandonment is rejected; there is deliberately no automatic stale-lease cleanup or retry. If a crash occurs after successful durable release, the valid abandonment remains and only a new manual invocation can continue.

CLI errors report `reconciliationVerified: false`, do not claim that append definitely did not happen, and do not assert that a failed command verified the worker's actual block state. Inspect the existing journal/lease in a separately authorized review before doing anything further.

## Optional evidence-based audit hold

The older evidence-hold path remains separate. It is **not** a prerequisite for abandonment and still leaves the worker blocked:

```bash
node bin/reset-reconcile-round400.mjs \
  --journal-dir /ABSOLUTE/EXISTING/JOURNAL_DIRECTORY \
  --address PUBLIC_ADDRESS_64_HEX \
  --evidence /ABSOLUTE/FRESH_EVIDENCE.json
```

Adding `--append-hold --confirm EXACT_INSPECTION_TOKEN` appends `reconciliation_hold` and retains its lease. Do not use it if the intended decision is the separate abandonment path above. Converting an existing hold is intentionally unsupported.

Evidence requires wrapper fields exactly `schema`, `capturedAt`, `source`, `tipHash`, `address`, `gateway`, `pin`, `status`. Schema is `reset-round400-status-v1`; source is `externally-captured-read-only-status`; `capturedAt` is the genuine capture time in integer epoch milliseconds (age at most five minutes, not future); `tipHash` is the actual 64-character lowercase hex tip hash, never invented.

The status projection has exactly `address`, `balance`, `deposit`, `exits`, `tip`, `counted`, `mine`, `moves_left`, `capacity_left`, `strikes`, `claim`. `mine` contains only `round`, `start`, `claim_end`, `end`, `window_open`; each exit contains only `amount`, `release`. Values must be copied from the original snapshot, with coin amounts as strings. The actual source snapshot should be retained separately; no real evidence was generated here.

The hold validator requires same round 400, original checkpoint boundaries, a closed window, both tip and counted beyond claim_end, claim null, no strikes, deposit exactly 0.1, and no exits. A later-round status is rejected, not treated as historical proof. Evidence, capture time, and tip hash remain human-supplied and unauthenticated; even an accepted hold establishes no finality or confirmed non-application. Its private evidence file must also be canonical/absolute, owned, mode `600`, regular, and not linked.

## Offline tests

See [validation results](ROUND400-VALIDATION.md) for exact final counts and commands. All writes are to synthetic temporary fixtures. Network, child processes, and wallet paths are blocked by the offline guard. Any test of the worker class uses synthetic in-memory ports only, not a live runtime, wallet, signer, or gateway.
