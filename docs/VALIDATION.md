# Validation and remaining limits

## Local live adapter: implemented, offline-tested only

`npm test` passes **139/139 tests**: the 54-test baseline plus 85 adapter tests. `npm run test:worker-live` passes **85/85** (68 guarded policy/port/startup tests and 17 CLI/journal tests). The existing simulator remains separate and unchanged. No live worker/runtime was started; no real wallet was read or unlocked, no real puzzle/signature was generated, and no live RESET connection or transaction was made for this extension. The laptop was not accessed.

The adapter uses the exact local pinned signer sources and pure state/wire validators, with mocked solving/signing/submission in tests. The safe MCP allowlist and entrypoint remain unchanged: exactly `rules`, `status`, `address`, `post_headers`. No funds tool was added. There is no AI, scheduler, auto-start, duration cutoff or auto-restart. The CLI is foreground and separately requires interactive TTY, expected public address, securely injected password and explicit real-transaction flags; its positive signal tests replace the entire live runtime with an offline simulator using a test-only preload hook.

Coverage includes total deposit-plus-exits exposure <=0.1, exact 0.1 lock only from zero, level 1000 without allow_over, live minimum mismatch, address binding, altered prepared/signed payloads, strict snapshot comparison including proof-state, state regressions/reorg, journal-before-signing, clean restart deduplication, pending/ambiguous replay refusal, accepted-but-unobserved results, abort at each action boundary and while submission is in flight, filesystem lease conflicts, symlink/hardlink/mode refusal, malformed/truncated/zero-byte journals, write/fsync failure, short writes, bounds, and 2,000 synthetic heights. A durable-journal integration test also crosses a clean restart and a synthetic lost response. Audit found existing empty journals could be reinitialized and a short write could be treated as complete; both were fixed and regression-tested before final validation.

Core/port/startup tests run with the offline guard denying network, child processes, wallet/keystore paths and filesystem writes. Journal tests use disposable synthetic temporary directories, not real wallet/journal locations. Actual HTTP transport behavior, real cryptography/puzzle execution, live gateway acceptance, settlement, profitability, Windows/WSL orchestration and laptop operation are not validated. Gateway trust, third-party dependencies and same-user malicious processes remain outside this adapter's guarantees. Other funds-capable writers must be stopped: snapshot-to-submit is not an atomic reservation across external programs. Ctrl+C does not undo an in-flight POST or release funds; an ambiguous result remains blocked for manual reconciliation.

Live-run permission is still required for the selected machine/address, existing local wallet access, fixed gateway network access, and actual lock <=0.1 total plus level-1000 claims. See [WORKER.md](WORKER.md) for exact paths, gated invocation and journal/recovery caveats. No live approval is inferred from these offline tests.

## Historical baseline: offline simulator extension

The previous worker revision added only an in-memory simulator: `node bin/reset-worker.mjs --simulate`; that executable still refuses all other modes/arguments. The safe MCP wrapper and its four-tool allowlist were unchanged. No network connection, real wallet open/unlock, signer startup, actual lock/claim or other funds action was performed for that extension; the earlier live checks below are historical, not part of either worker test.

At that baseline, `npm test` passed all **54 tests** (25 existing + 29 worker), and `git diff --check` was clean.

`npm run test:worker` passes 29 new tests: 25 policy/executor tests under an offline guard and four CLI tests, whose simulator children also use that guard. Coverage includes exact unit math, total deposit-plus-exits cap of 0.1, level 1000, one lock, no repeated claims across 2,000 synthetic heights, stale/coherence changes, serial execution, unknown submission handling without retries, live-flag refusal and foreground SIGINT/SIGTERM shutdown. Audit found that changed round metadata could preserve an identical decision; this was fixed by checking round boundaries and comparing all normalized decision-state fields before dispatch, and regression-tested.

The worker has no duration cutoff, schedule, auto-start, auto-restart or AI; the one-second polling pause only paces synthetic blocks. Tests leave no worker running. This is not live signing, settlement, payout or Windows validation. See [WORKER.md](WORKER.md) for commands and the explicit live approval gate.

## Verified in Linux

Environment: Ubuntu 24.04, x86-64, Node.js v24.19.0, npm 11.17.0. The active agent application was Cue on a cloud Sandbox, not a Windows laptop.

The official remote HEAD matched the package's pin: `6132e8653d6342f36673eb7426ec8e064960e48e`. The pinned `README.md`, `docs/llms.txt`, `signer/README.md`, `LICENSE.md`, keystore code and relevant process/dashboard code were reviewed. Only signer dependencies are needed; installing the upstream root package is unnecessary.

The portable restricted wrapper passed **25 offline tests**, including filtered paginated tool listing, all four safe tool routes, denial of funds/lottery/unknown tools, argument smuggling, password redaction in results and errors, minimal child environment, no concurrent calls, malformed tool lists, missing credentials, EOF/signal cleanup, stubborn-child termination, unexpected child exit, pin consistency and entrypoint argument refusal. Seven installer regressions also verify private-wallet preservation, no implicit wallet creation, refusal to overwrite, unsafe-permission rejection, wrong-pin refusal and invalid-argument rejection using fake dependencies and disposable metadata.

A separate process launched the **packaged production entrypoint**, connected to the real RESET signer and gateway, listed exactly `rules`, `status`, `address`, `post_headers`, and successfully called `rules`, `status`, and `address`. Its output recorded success booleans, not wallet addresses or private state. It did not invoke a funds operation or start a worker. That was a supervised connection test, not an unattended participation test.

`npm run check` verified Node/platform, the exact upstream commit, clean signer source and the installed SDK without opening a wallet. The existing separate local dashboard returned HTTP 200; this does not validate Windows localhost forwarding.

A clean Linux installation was also executed from a disposable checkout and empty home: it cloned the official source, selected the exact pin, installed 174 signer dependencies, passed the installation check, and created no wallet. This tests the actual installer path, not only synthetic stubs.

That clean install's npm audit reported five moderate affected-package findings and zero high/critical findings: `uuid`, `@metamask/key-tree`, `@metamask/utils`, `trac-crypto-api`, and `trac-wallet`. The upstream issue is [uuid: missing buffer bounds check in v3/v5/v6 when buf is provided](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Exploitability in this workflow was not assessed. No dependency version or official lockfile was changed; `npm audit fix --force` was not run. The project does not claim a vulnerability-free install.

## Windows/WSL boundary

Native Windows execution is intentionally refused by the runtime verifier. Upstream requires Unix-style 0700 directory and 0600 keystore bits; NTFS ACL hardening alone is not a tested substitute. No upstream security checks are patched.

PowerShell launchers target an existing WSL2 distribution and keep the runtime in its Linux home. PowerShell syntax, distribution selection, WSLENV credential forwarding, localhost forwarding, Windows process cleanup, and sleep/restart behavior have not been exercised on Windows. Documentation and static review do not count as Windows testing. The user's laptop was not accessed.

No claim is made that installing a Windows checkout connects a remote phone agent, transfers a cloud wallet, or creates an always-on host.

## Not performed

No token purchase, transfer, Mine lock, lottery guess, Mine claim, unlock or withdrawal. No deployment, scheduler, unattended worker, model API call, or control-plane configuration change. No applied financial action or settled payout is claimed. No live account data, keystore, password or actual secret reference is included in this repository.

The approved design is manual foreground until Ctrl+C, maximum total deposit-plus-exits exposure 0.1 RESET, fair-share level 1000, no AI and no duration timer. A local adapter is now implemented and offline-tested, but still requires explicit permission to access a selected wallet/network and perform real lock/claim actions within those limits. No unlock, withdraw, transfer, lottery or overclaim is authorized. A running MCP/dashboard alone is not continued participation.
