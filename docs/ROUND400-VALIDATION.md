# Round-400 abandonment: offline validation

## Result

**246 tests passed; 0 failed, 0 skipped, 0 cancelled, 0 todo.** The combined run covers eight selected test files, not the project's entire suite. JavaScript syntax and whitespace checks also pass.

Environment: Node.js `v24.19.0`, Linux Sandbox. HEAD remains `4787d54a6307aae03c1aba73457a05511b0dcaae`; no commit or push was made.

The exact combined command is:

```bash
node --import ./tests/fixtures/round400-offline-guard.mjs --test \
  tests/round400-recovery.test.mjs \
  tests/round400-abandon.test.mjs \
  tests/round400-abandon-cli.test.mjs \
  tests/worker-policy.test.mjs \
  tests/worker-live.test.mjs \
  tests/worker-live-port.test.mjs \
  tests/worker-live-start.test.mjs \
  tests/worker-live-journal.test.mjs
```

The guard blocks network, child processes, and wallet/keystore/private runtime paths. All file writes use synthetic temporary journals and leases. Worker-class tests use synthetic in-memory ports and mock results, never a live worker runtime, actual signing, wallet, or gateway. Existing adapter tests use local pure validators and mock signing/submission only. No worker CLI, daemon, dashboard, or live signer process was started.

## What was verified

The independent abandon path needs no status evidence. It requires the exact original pending claim400 intent, preceding lock399, preserved halt, matching identity, a confirmation bound to SHA-256 of the complete raw original journal, and the exact reward-may-be-forfeited/no-retry acknowledgment.

Successful synthetic append preserves the original bytes and journal inode, adds one `abandon_claim`, records outcome unknown, never adds a claim400 observation or success, verifies the durable journal through the shared parser, and releases only the new recovery lease. Existing leases are refused and left unchanged. Duplicate abandonment is refused.

Persistent journal metadata hashes actual byte prefixes, including whitespace, identity, intent, and halt; hashes are not derived from reserialized objects. Metadata survives append/reopen and its getters return copies. The worker rejects missing/forged prefix metadata, wrong record hash/token/acknowledgment, changed identity/action/checkpoint, false outcome claims, unknown keys, duplicate abandon records, and injected round400 intents.

Synthetic manual restart tests show no preparation/signing/submission for round400, eligible level-1000 claims for rounds401/402, claim deduplication after reopen even if a later view loses the claim, retained lock-attempt history, no re-lock or top-up after deposit changes, and rejection of exposure above 0.1. A later ordinary halt remains blocking. Existing regressions include a pure 2,000-height simulation preserving the exposure cap and level1000.

Fault injections reach the real append/release paths with valid confirmation and acknowledgment. Coverage includes zero/short/partial writes, directory/file fsync failure, failure closing the append descriptor after validation, removal failure, final release-directory fsync failure, concurrent acquisition, changed/nonempty lease identity, and post-write content tampering. Uncertain operations do not report success; retained or re-established leases block ordinary journal open. Cleanup never intentionally removes an existing or detected replacement lease.

The retained evidence-hold path also passes its tests: stale/future evidence, later-round claim-null ambiguity, insufficient counted height, unsafe exposure/claims, malformed and ambiguous JSON, invalid UTF-8, partial/oversized records, unsafe ownership/permissions/symlinks/hardlinks, changed input bytes, and repeated invocation are rejected. The hold path is not a prerequisite for abandonment and remains terminal.

## Files changed in this extension

1. `/home/ubuntu/resetmnr/lib/round400-abandon-policy.mjs` — new exact record schema, target/identity checks, hash token, and explicit forfeiture acknowledgment.
2. `/home/ubuntu/resetmnr/lib/worker-live.mjs` — shared pure history validator, narrowly allowed abandon transition, consumed round400, minimum future round401, unchanged ordinary-halt safety.
3. `/home/ubuntu/resetmnr/lib/worker-live-journal.mjs` — validated raw-byte prefix audit hashes, persistent append/reopen metadata, ambiguous-JSON rejection.
4. `/home/ubuntu/resetmnr/lib/round400-recovery.mjs` — separate abandon inspection/append, durable post-write validation, conservative owned-lease release; retained hold path.
5. `/home/ubuntu/resetmnr/bin/reset-reconcile-round400.mjs` — mutually exclusive abandon/hold modes, exact confirmation and acknowledgment arguments, no worker startup.
6. `/home/ubuntu/resetmnr/tests/round400-abandon.test.mjs` — new synthetic parser/restart/append/crash/lease tests.
7. `/home/ubuntu/resetmnr/tests/round400-abandon-cli.test.mjs` — new direct CLI tests without subprocesses.
8. `/home/ubuntu/resetmnr/docs/ROUND400-RECOVERY.md` — operator procedure, unknown-outcome semantics, evidence limitations, manual-start boundary, and crash handling.
9. `/home/ubuntu/resetmnr/docs/ROUND400-VALIDATION.md` — this validation summary.

The earlier `/home/ubuntu/resetmnr/tests/round400-recovery.test.mjs` and `/home/ubuntu/resetmnr/tests/fixtures/round400-offline-guard.mjs` remain in use and were not modified in this extension. `README.md` already had a local 129-line addition before either preparation run; it was not touched. No startup configuration or package script was changed.

## Preparation, not execution

No user WSL journal, lease, or wallet was read or modified. No live gateway/network action, wallet unlock, signing, submission, lock, claim, live worker, or daemon was used. The preparation authorization was not treated as permission to apply abandonment to real data. The user must review the changes and separately execute the local operator action later; a worker start would require another new manual invocation after successful abandonment and safe lease release.

An independent static review found no critical/high issue in the implemented flows under the documented trusted-local-files/cooperating-lease model. Residual same-UID races between filesystem system calls are outside that model; the tool is not an adversarial filesystem lock. A failed cleanup may leave an uncertain lease state and never authorizes automatic retry. No unauthenticated status snapshot is treated as historical proof or finality.

See [the operator guide](ROUND400-RECOVERY.md). The final raw test log is available to the coordinator on this computer at `/tmp/round400-complete-tests.log`.
