# Validation and remaining limits

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

For any future participation extension, obtain the missing penalty policy, model budget and initial duration, check live eligibility and enforce all approved limits before enabling it. A running MCP/dashboard alone is not continued participation.
