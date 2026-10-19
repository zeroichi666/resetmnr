# Round-400 abandonment and narrow legacy-halt compatibility

## Result

**384 tests passed in the full suite; 0 failed, skipped, cancelled or todo.** The targeted guarded run passed **277 tests**, also with no failures or omissions. These are overlapping runs, not 661 distinct tests. JavaScript syntax checks and `git diff --check` pass.

Changes are local in the Linux Sandbox, based on HEAD `6b48944`; no commit or push was made. No user WSL journal, lease or wallet was accessed. No gateway, wallet unlock, actual signing, live worker or transaction was used.

## What the change fixes

The shared parser now recognizes exactly one legacy `{type:"halt",intentWritten:false}` immediately after an already validated round-400 abandonment, with no pending action. It keeps the marker and all bytes unchanged. It preserves the original lock attempt, claim-round 400 deduplication, minimum future round 401, prior checkpoint and exposure.

This removes that specific journal-inspection blocker in a fresh dashboard process if no lease is present. It does not fix the historical runtime error or establish that the round-400 submission failed. An existing dashboard session in its error phase remains blocked. Every worker start remains a separate explicit manual action, and all fresh-state checks still apply.

Normal future intent/observed records may follow the marker so a manually requested claim401 does not make later restarts unparsable. Any second or later halt, `halt:true`, pending intent, hold, wrong shape, extra field, invalid audit or unsafe history remains blocked. New non-action failures carry a fixed `failureStage` and are deliberately not eligible for the legacy exception, including a newly detected exposure regression immediately after abandonment.

The abandonment command itself is unchanged. Its post-write verification still requires exactly the expected durable bytes: an injected extra legacy marker fails the append audit and leaves its blocking lease, even though that marker alone is now parseable. Existing/unsafe leases are not removed or taken over.

## Tests run

Full suite:

```bash
npm test
```

Targeted offline run:

```bash
node --import ./tests/fixtures/round400-offline-guard.mjs --test \
  tests/round400-abandon.test.mjs \
  tests/round400-abandon-cli.test.mjs \
  tests/round400-recovery.test.mjs \
  tests/worker-dashboard-journal.test.mjs \
  tests/worker-live.test.mjs \
  tests/worker-live-start.test.mjs \
  tests/worker-live-diagnostics.test.mjs
```

Logs on the preparation computer: `/tmp/reset-narrow-reconcile-full.log` and `/tmp/reset-narrow-reconcile-focused.log`.

The targeted guard blocks network, child processes and private wallet/runtime paths while allowing synthetic temporary journal fixtures. The full suite additionally exercises local HTTP loopback tests and mock CLI subprocesses; valid CLI tests replace the live runtime. No external gateway is used. All solver, signature and submission operations are synthetic mocks, not cryptographic/live operations.

Coverage includes repeated read-only parsing without mutation, exact raw-prefix audit hashes and whitespace, no implicit startup, lease retention, round400 no-retry, claim401/402 level1000 and restart deduplication, no second lock, cap/exposure regression, pending intent with misleading false flag, durable-intent append exceptions, holds, malformed journals, new classified failures and sanitized diagnosis. Existing fault-injection and 2,000-height synthetic invariant tests also pass.

## Safe diagnosis, not a root-cause claim

Only a locally created error registered in a private WeakMap can expose an allowlisted stage. CLI and dashboard never relay raw exception messages, causes, remote codes, passwords, tokens, wallet material or hashes. Examples include `snapshot-read`, `snapshot-validation`, `snapshot-monotonicity`, `journal-intent`, `submission` and `startup-unlock`. A read-stage error may include validation inside the signer port; the stage is not proof of a network failure. Legacy markers have no diagnosis, so this cannot recover their historical cause.

Intentional cancellation during an operation still follows the existing conservative halt behavior; it is not automatically cleared. Pre-journal installation/rules checks still fail before signer import/unlock, without writing a journal diagnosis. Neither boundary was relaxed.

## Exact files changed for this extension

- `lib/worker-live.mjs`: immediate legacy compatibility plus static failure staging; all action guards retained.
- `lib/worker-live-start.mjs`: sanitized startup stages; new non-action halts stay sticky.
- `lib/worker-live-diagnostics.mjs` (new): private allowlisted error diagnosis.
- `lib/worker-dashboard-journal.mjs`: comment aligned with the shared parser; inspection remains read-only.
- `lib/worker-dashboard-controller.mjs`: safe diagnostic event; no automatic retry or error-phase reset.
- `bin/reset-worker-live.mjs`: safe diagnostic category in CLI error output.
- `tests/round400-abandon.test.mjs`: compatibility, future restart, audit, lease and regression tests.
- `tests/worker-dashboard-journal.test.mjs`: read-only compatibility and fail-closed dashboard tests.
- `tests/worker-live-diagnostics.test.mjs` (new): sanitized error, startup and dashboard lifecycle tests.
- `README.md`, `docs/WORKER.md`, `docs/ROUND400-RECOVERY.md`, `docs/ROUND400-VALIDATION.md`: matching behavior and test documentation.

No package scripts, scheduler, startup configuration, recovery writer, raw journal parser, lease implementation or exposure policy were changed. The independent read-only review found no critical regression; existing trusted-local-files/cooperating-lease assumptions and same-UID filesystem race limits remain. See [the exact operator conditions](ROUND400-RECOVERY.md#restart-and-parser-guarantees).
