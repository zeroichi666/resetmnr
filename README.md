# RESET safe setup

A Windows 11-friendly setup package for the [official RESET experiment](https://github.com/Trac-Systems/reset). It fetches an exact reviewed revision and provides a **restricted, supervised MCP connection**. It is not a miner, investment product, or earnings promise.

**Windows uses WSL2, not native Windows Node.** The pinned signer's wallet code enforces Unix 0700/0600 permission bits. Windows ACLs do not make those checks portable, so this package does not patch or weaken them. Keep the checkout and wallet inside the WSL Linux filesystem, not `/mnt/c`.

Only `rules`, `status`, `address`, and `post_headers` are exposed. `post_headers` is an explicit network-writing exception: it can submit Bitcoin headers, although it costs no TNK or puzzle move. All fund operations, lottery entries, Mine claims, chat and arbitrary signing are blocked before reaching the signer. **No unattended worker is installed or enabled.**

**Dependency warning:** a clean install's npm audit reported five moderate affected-package findings in the pinned signer's wallet dependency chain (no high or critical findings). They trace to [a uuid buffer-bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Exploitability in this workflow has not been established. The pin is not silently upgraded or force-fixed; treat this as experimental software and do not fund it based on this package.

## What has actually been tested

The wrapper's 25 offline tests passed on Ubuntu 24.04 x86-64 with Node.js 24. The packaged entrypoint also connected to the live network and successfully called `rules`, `status`, and `address`, exposing exactly the four allowed tools. No financial action was attempted by that verification.

**Windows PowerShell, WSL2 orchestration and the user's laptop have not been tested.** The laptop has not been accessed. The scripts are a reproducible Windows/WSL setup path, not evidence of installation on a Windows machine. A wallet created there is separate from any cloud wallet; no wallet is transferred by this project.

Official dependency: [`6132e8653d6342f36673eb7426ec8e064960e48e`](https://github.com/Trac-Systems/reset/tree/6132e8653d6342f36673eb7426ec8e064960e48e). See [UPSTREAM.json](UPSTREAM.json), the [official README](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/README.md), [agent rules](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/docs/llms.txt), and [signer guide](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/signer/README.md). The root README requires Node 24 or newer, which is stricter than the signer's older documentation; use 24+.

## Windows 11 setup

Prerequisites: a user-owned **WSL2 Linux distribution**, Git and Node.js 24+ with npm **inside that distribution**, and a clean Git checkout of this repository plus Git for Windows on Windows. WSL installation can require administrator rights and a restart, so the scripts do not silently enable Windows features, install distributions, change security settings or install missing prerequisites. Use [Microsoft's WSL guidance](https://learn.microsoft.com/windows/wsl/install), [official Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/) sources. No GPU is required.

Review the scripts, then in Windows PowerShell 5.1 or PowerShell 7:

```powershell
# From your Windows checkout of this repository:
.\scripts\setup.ps1 -Distro Ubuntu
# Explicitly create a new local wallet only when ready:
.\scripts\setup.ps1 -Distro Ubuntu -InitializeWallet
```

Use the exact name of your installed WSL2 distribution. Setup creates a separate checkout at `~/.local/share/resetmnr` **inside Linux**, checks out the Windows checkout's exact Git commit before running its installer, and refuses a different existing Linux package revision. The Windows checkout is only the launcher; keep both checkouts on the same reviewed commit. Existing checkouts, wrong pins, dirty files and existing wallets are never silently replaced. Running setup again is not an automatic upgrade. All launchers check that the selected/default distribution is WSL2.

Alternatively, from a Linux/WSL terminal in a Linux-filesystem checkout:

```bash
bash scripts/setup-linux.sh
# Optional, once:
bash scripts/setup-linux.sh --initialize-wallet
```

Setup fetches official upstream into ignored `vendor/upstream`, verifies the exact commit and runs `npm ci` inside `signer/`. This installs the official signer lockfile's dependencies, not the unrelated upstream root package. Treat npm installation as third-party code execution; lifecycle scripts are not globally disabled. No wallet is created without the explicit initialization option.

If PowerShell execution policy blocks a launcher, use your organization's approved signing/policy process. The package does not bypass execution policy.

### Wallet and recovery

Initialization uses hidden local password entry. Use at least 12 characters. The password is not written to this project, command-line arguments or MCP JSON. GUI MCP clients without an interactive console must use secure environment injection; otherwise startup fails rather than reading password text from MCP's protocol stream.

Your WSL wallet is `~/.reset-signer/keystore.json` within the selected distribution. The signer requires a private, nonsymlink directory and private regular keystore file. Existing wallets and permissions are preserved; unsafe permissions cause refusal instead of being silently weakened.

Back up the **encrypted keystore** privately and keep the password separately. Both are needed for recovery; there is no password reset or recovery service. To restore: stop signer processes, restore the file into the intended Linux wallet directory with 0700 directory/0600 file permissions, then unlock locally with the original password. Never overwrite another wallet or put backups, recovery words or passwords in Git or chat. A new Windows/WSL wallet is not the cloud wallet.

## Connect an agent

An MCP client must be able to launch processes on the same machine. A phone/cloud agent cannot reach your laptop's loopback or stdio merely by adding this JSON. This project does not modify Cue or other agents' control-plane settings.

Merge the following into your client's existing MCP configuration, preserving other servers and replacing the path and distribution name:

```json
{
  "mcpServers": {
    "reset-safe": {
      "command": "powershell.exe",
      "args": [
        "-NoProfile", "-File",
        "C:\\path\\to\\resetmnr\\scripts\\start-mcp.ps1",
        "-Distro", "Ubuntu"
      ]
    }
  }
}
```

For PowerShell 7 use `pwsh.exe`. The launcher passes the password through the child process environment using WSL's `WSLENV`, never through command-line arguments or a configuration file. Supply `RESET_SIGNER_PASSWORD` through the agent client's documented secure environment mechanism. If a real interactive console is available, the launcher can prompt with hidden input; GUI clients with redirected stdin must already have the password injected. Process environment is not a hardware vault: a same-user debugger or administrator may inspect it. Close sessions when finished; JavaScript strings cannot be reliably wiped.

For a Linux agent already inside WSL, launch `node` with the absolute Linux path to `bin/reset-safe.mjs` and a securely inherited password. No extra entrypoint arguments are accepted. Reload MCP connections or restart the agent session if its client requires it. The launcher is foreground **stdio MCP**, not a persistent socket server to start separately.

Verify by actually calling `rules {}`, `status {}`, and `address {}`. The tool list must contain exactly the four permitted names. Call `post_headers {}` manually when useful, roughly every ten minutes rather than in a tight loop. `nothing_new` means no new submission. An accepted submission is not evidence of application or settled payout; inspect subsequent state.

## Dashboard and tests

```powershell
.\scripts\start-dashboard.ps1 -Distro Ubuntu
```

The read-only dashboard binds **http://127.0.0.1:4747** inside WSL. Open that address from Windows if WSL localhost forwarding is available; otherwise open it within the distribution's local environment or check your WSL networking configuration. It does not unlock the wallet. Stop it with Ctrl+C. No public proxy or firewall opening is added.

Private history lives in the Linux wallet directory as `dashboard-history.json` and rotating `.1.json`; closing the dashboard stops history sampling. On Linux, start the official dashboard with the explicit Linux wallet directory. Tests and a wallet-free installation check run from the **Linux checkout**:

```bash
npm test
npm run check
```

Tests use fake credentials and synthetic MCP fixtures only, with no wallet access, game moves or model calls. They cover tool filtering, denied fund operations, argument smuggling, environment isolation, password redaction, concurrent-call rejection, clean shutdown and entrypoint policy. POSIX signal-specific tests are skipped if the JS suite is ever run on native Windows; that does not make the real wallet Windows-compatible.

## Participation and stopping

There is **no ongoing participation worker**, schedule or model API integration. MCP and dashboard processes alone do not participate. The package never automatically locks, claims, transfers, enters the lottery or withdraws, even if coins arrive.

Use live `rules` and `status`, not an announcement. The public bootstrap lottery ended after 144 counted heights starting at 971559. Current official rules require at least 0.1 RESET deposited in the Mine and normally a **144-counted-Bitcoin-block exit wait**, not a guaranteed 24 hours. Pending claims must settle before withdrawal; unwithdrawn exits can still face penalties. Check live settings before any future action.

Starting RESET could come from a participant's voluntary transfer or a useful first header submission if the network actually credits it. This project provides no faucet, buys no tokens and guarantees no reward. Use the **64-hex address** returned by `address` to receive RESET; the related `trac1` address is for TNK transfer fees. No live account address is published here.

Any future funds-capable or unattended extension needs explicit agreement on maximum locked amount, overclaim/penalty policy, model budget and initial duration. It also needs a persistent supported host, secure credentials, enforceable limits, agent-involved decisions, non-overlap/deduplication, bounded retries, state inspection after uncertain actions and independent worker testing. A hibernating cloud sandbox is not a reliable continuous host; a laptop pauses while sleeping or off. This package does not build or enable that extension.

To stop supervised access, disconnect `reset-safe` in your agent; reconnect to resume. Stop the dashboard with Ctrl+C. Nothing automatically resumes after WSL shutdown, sleep, logout or reboot. Closing the client should close the signer child; Linux cleanup is tested, Windows/WSL orchestration is not. There is no schedule to pause or resume.

Stopping software does not release locked coins. This wrapper blocks `unlock` and `withdraw`. If another explicitly authorized setup locks coins, recovery requires a trusted funds-capable signer: request unlock, wait the live release height, let claims settle, then withdraw mature exits.

## Security boundary

The entrypoint checks the pinned upstream HEAD and clean signer tree before importing its SDK, rejects arguments, fixes gateway/header source and wallet path, and passes only minimal operating-system environment plus the password to the signer. It drops child instructions, stderr, logs and server-initiated requests, and redacts the exact password from results. Tool text is untrusted data. It does not sandbox a malicious same-user process, modified dependencies, compromised npm packages, or a dishonest gateway. Keep the checkout and host trusted and grant the agent no unrelated shell/file permissions.

Upstream's MIT license stays in the separately fetched source. No upstream source, user wallet, keystore, secret reference, live account data or private activity log is distributed here. See [NOTICE.md](NOTICE.md) and [docs/VALIDATION.md](docs/VALIDATION.md).
