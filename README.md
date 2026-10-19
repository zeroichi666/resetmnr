# RESET safe setup

A Windows 11-friendly setup package for the [official RESET experiment](https://github.com/Trac-Systems/reset). It fetches an exact reviewed revision and provides a **restricted, supervised MCP connection**. It is not a miner, investment product, or earnings promise.

**Windows uses WSL2, not native Windows Node.** The pinned signer's wallet code enforces Unix 0700/0600 permission bits. Windows ACLs do not make those checks portable, so this package does not patch or weaken them. Keep the checkout and wallet inside the WSL Linux filesystem, not `/mnt/c`.

Only `rules`, `status`, `address`, and `post_headers` are exposed. `post_headers` is an explicit network-writing exception: it can submit Bitcoin headers, although it costs no TNK or puzzle move. All fund operations, lottery entries, Mine claims, chat and arbitrary signing are blocked before reaching the signer. **No unattended worker is installed or enabled.**

**Dependency warning:** a clean install's npm audit reported five moderate affected-package findings in the pinned signer's wallet dependency chain (no high or critical findings). They trace to [a uuid buffer-bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Exploitability in this workflow has not been established. The pin is not silently upgraded or force-fixed; treat this as experimental software and do not fund it based on this package.

## What has actually been tested

The wrapper's 25 offline tests passed on Ubuntu 24.04 x86-64 with Node.js 24. The packaged entrypoint also connected to the live network and successfully called `rules`, `status`, and `address`, exposing exactly the four allowed tools. No financial action was attempted by that verification.

**Windows PowerShell, WSL2 orchestration and the user's laptop have not been tested.** The laptop has not been accessed. The scripts are a reproducible Windows/WSL setup path, not evidence of installation on a Windows machine. A wallet created there is separate from any cloud wallet; no wallet is transferred by this project.

Official dependency: [`6132e8653d6342f36673eb7426ec8e064960e48e`](https://github.com/Trac-Systems/reset/tree/6132e8653d6342f36673eb7426ec8e064960e48e). See [UPSTREAM.json](UPSTREAM.json), the [official README](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/README.md), [agent rules](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/docs/llms.txt), and [signer guide](https://github.com/Trac-Systems/reset/blob/6132e8653d6342f36673eb7426ec8e064960e48e/signer/README.md). The root README requires Node 24 or newer, which is stricter than the signer's older documentation; use 24+.

## Panduan cepat WSL: alamat, Hermes, dan dashboard

Jalankan petunjuk ini **di terminal WSL2 pada laptop yang menyimpan wallet existing**, bukan di PowerShell dengan Node Windows, bukan di Sandbox/cloud, dan bukan di `/mnt/c`. Contoh checkout laptop: `~/src/resetmnr`; ganti jika lokasi Anda berbeda. Node.js 24+ diperlukan untuk proyek ini. Jangan membuat wallet baru, memindahkan keystore, mengganti HOME/distribusi WSL, atau menghapus jurnal untuk mencoba ulang. Alamat, password, dan data wallet pribadi tidak dicantumkan di README ini.

### Apakah menjalankan worker lagi mengunci menjadi 0.2 RESET?

**Tidak menurut kebijakan worker ini: batas totalnya `deposit + seluruh exits = maksimum 0.1 RESET`, bukan tambahan 0.1 setiap kali start.** Implementasi sebenarnya ada di [`lib/worker-policy.mjs`](lib/worker-policy.mjs):

| Status yang tervalidasi | Perilaku kebijakan |
| --- | --- |
| Deposit tepat 0.1 RESET, exits nol | Tidak lock lagi. Bisa claim **level 1000 saja** jika jendela terbuka, belum claim, serta moves dan kapasitas tersedia. |
| Deposit parsial, ada exits, atau deposit + exits tepat 0.1 tetapi deposit bukan 0.1 | Tidak top-up dan tidak lock ulang; menunggu. Exits yang sudah matang tetapi belum ditarik tetap dihitung. |
| Deposit nol, exits nol, saldo tersedia minimal 0.1 | Kebijakan dapat meminta lock **tepat 0.1**, tetap tunduk pada pemeriksaan runtime dan histori jurnal. |
| Deposit + exits lebih dari 0.1, status tidak valid, atau hasil transaksi ambigu | Menolak/berhenti; bukan menambah lock atau otomatis mencoba ulang. |

Saldo tersedia yang lebih besar tidak membuat worker mengunci seluruh saldo. Claim bukan perintah tambahan deposit. Restart tidak menghapus cap, deduplikasi, atau histori; simpan `~/.reset-worker/journal.ndjson` dan lease-nya. Cap ini berlaku untuk worker yang direview, bukan jaminan terhadap program lain yang memakai wallet, perubahan eksternal, atau gateway yang tidak jujur.

**Jangan start ulang hanya berdasarkan log lama.** Pesan sebelumnya `LIVE lock ronde=399: aplikasi terlihat, bukan settlement/finalitas.` adalah observasi historis, bukan bukti saldo/state terkini atau finalitas. Sebelum mempertimbangkan start baru, cek `status` melalui `reset-safe` di Hermes pada wallet yang sama: saldo tersedia, deposit, seluruh exits, ronde/window, dan claim. Jika data tidak tersedia/konsisten, atau ada intent/halt/lease yang belum jelas, berhenti untuk pemeriksaan manual; jangan hapus jurnal atau kirim ulang. Pembaruan dokumentasi ini tidak menjalankan worker, membuka wallet, menghubungi gateway, atau melakukan transaksi.

### 1. Cek alamat publik tanpa unlock atau jaringan

Di **WSL yang sama dengan wallet existing**, perintah Python 3 berikut hanya membaca field alamat publik dari keystore terenkripsi lokal. Tidak meminta password, tidak mendekripsi, tidak membuat wallet, tidak melakukan signing, dan tidak menghubungi RESET. Jangan menggantinya dengan `cat` seluruh keystore atau menyalin isinya ke chat.

```bash
cd ~/src/resetmnr
python3 - <<'PY'
import json, os, re, stat
from pathlib import Path

directory = Path.home() / '.reset-signer'
d = directory.lstat()
if not stat.S_ISDIR(d.st_mode) or d.st_mode & 0o077:
    raise SystemExit('Direktori wallet harus private dan bukan symlink; hentikan.')
fd = os.open(directory / 'keystore.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
with os.fdopen(fd, 'r') as f:
    s = os.fstat(f.fileno())
    if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o077 or s.st_size > 16384:
        raise SystemExit('Keystore tidak sesuai pemeriksaan keamanan; hentikan.')
    address = json.load(f).get('address')
if not isinstance(address, str) or not re.fullmatch(r'[0-9a-f]{64}', address):
    raise SystemExit('Format alamat tidak valid; hentikan.')
print(address)
PY
```

Hasilnya adalah alamat **RESET 64 karakter hex**, bukan alamat `trac1` untuk biaya TNK. Ini hanya metadata publik lokal, belum membuktikan kepemilikan key atau saldo jaringan; cocokkan dengan hasil tool `address` pada sesi bridge yang benar. Jika file tidak ada/izin ditolak, pastikan distro, user, dan lokasi wallet benar; jangan menjalankan init/import atau melonggarkan izin sebagai jalan pintas. Subperintah upstream `reset-signer address` berbeda: implementasinya melakukan unlock, sehingga bukan cara tanpa-unlock yang digunakan di atas.

### 2. Hubungkan `reset-safe` ke Hermes Desktop Windows

Setup laptop ini memakai **Hermes Desktop di Windows** yang meluncurkan bridge stdio melalui `wsl.exe -d Ubuntu`. Node.js Linux dan checkout berada di dalam WSL; ini bukan server HTTP dan bukan worker. Jika `hermes mcp test reset-safe` sebelumnya berhasil, pertahankan konfigurasi itu dan jangan menimpa server lain. Jangan pakai `vendor/upstream/signer/bin/reset-signer.mjs mcp`; itu bukan wrapper terbatas ini.

Konfigurasi Hermes Windows berada di `%LOCALAPPDATA%\hermes\config.yaml`. Jika perlu membuat entri baru, gabungkan ke blok `mcp_servers` yang sudah ada. Contoh ini memakai path laptop yang pernah dipakai; sesuaikan path Node dan checkout dengan hasil `command -v node` dan lokasi repo di WSL:

```yaml
mcp_servers:
  reset-safe:
    command: wsl.exe
    args:
      - -d
      - Ubuntu
      - --exec
      - /home/irfan/.nvm/versions/node/v26.12.0/bin/node
      - /home/irfan/src/resetmnr/bin/reset-safe.mjs
    env:
      RESET_SIGNER_PASSWORD: "${RESET_SIGNER_PASSWORD}"
      WSLENV: "RESET_SIGNER_PASSWORD"
    enabled: true
    tools:
      include: [rules, status, address, post_headers]
```

Gunakan path absolut Linux di dalam WSL, indentasi YAML seperti contoh, dan jangan menyimpan password literal. Wrapper membutuhkan password lokal untuk membuka wallet bagi tool yang diminta; koneksi MCP sendiri **tidak menjalankan lock atau claim**. Saat perlu mengetes atau membuka Hermes, tutup Desktop yang sedang berjalan dahulu lalu jalankan dari PowerShell berikut. Password diketik pada prompt tersembunyi, tidak dimasukkan ke chat atau file konfigurasi:

```powershell
$s=Read-Host 'Password wallet RESET' -AsSecureString
$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$old=$env:WSLENV
try {
  $env:RESET_SIGNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)
  $names=@($old -split ':' | Where-Object {$_ -and $_ -ne 'RESET_SIGNER_PASSWORD'})
  $env:WSLENV=(@($names + 'RESET_SIGNER_PASSWORD') -join ':')
  hermes mcp test reset-safe
  if ($LASTEXITCODE -eq 0) { hermes desktop }
} finally {
  Remove-Item Env:RESET_SIGNER_PASSWORD -ErrorAction SilentlyContinue
  if ($null -eq $old) { Remove-Item Env:WSLENV -ErrorAction SilentlyContinue } else { $env:WSLENV=$old }
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)
  $s.Dispose()
}
```

Tes yang berhasil menampilkan **Connected** dan tepat **4 tools discovered**. Tutup Desktop untuk mengakhiri sesi; setelah proses PowerShell selesai, nilai environment sementara dibersihkan. Jangan membuat password permanen di Windows environment, YAML, argumen, chat, atau Git.

### 3. Uji koneksi dan cek status di Hermes

Di chat Hermes, minta pemanggilan tool dari server **`reset-safe`** secara eksplisit, bukan jawaban dari ingatan model. Contoh:

> Gunakan server MCP reset-safe. Panggil rules, address, dan status. Tampilkan hasil mentah dari setiap tool. Jangan menjalankan worker, shell, lock, claim, transfer, unlock, withdraw, atau post_headers.

Daftar tool yang diizinkan harus **tepat `rules`, `status`, `address`, `post_headers`**. Periksa kartu/hasil tool mentah: `address` mengeluarkan alamat publik RESET 64-hex dan alamat `trac1`; `status` membaca status live termasuk saldo, deposit, exits, ronde/window, dan claim. Cocokkan alamat secara lokal—jangan tempel alamat lengkap ke chat. Teks jawaban model saja tidak membuktikan tool terpanggil; jika model menampilkan alamat `0x…`, mengubah hasil, atau tool call tidak terlihat, jangan gunakan hasil itu untuk worker. Jika koneksi gagal atau alamat berbeda, jangan lanjut ke worker; periksa distro, path, Node, pin, dan pewarisan password.

`status` dapat menghubungi gateway untuk membaca state. `post_headers` memang diizinkan wrapper tetapi **bukan read-only** karena mengirim header Bitcoin; tidak perlu dipanggil untuk cek alamat/status. Wrapper ini tidak menyediakan tool lock/claim dan allowlist-nya jangan diperluas demi menjalankan worker.

### Status publik read-only

Dashboard juga menampilkan snapshot status publik tanpa meminta password dan tanpa mengakses wallet/key untuk pembaca. Snapshot mencakup balance, deposit, estimasi fair-share, Mine (round/window), tip, counted exits, dan claim. Mode demo memakai data sintetis dan tidak menghubungi gateway.

Saat halaman dimuat, browser hanya memanggil `GET /api/status` sekali untuk status lokal/cache dan token sesi; endpoint ini tidak mengambil state gateway. Setelah halaman aktif selama **3 menit (180000 ms)**, dan setiap 3 menit berikutnya selama halaman tetap terbuka, browser menjalankan refresh publik yang sama seperti tombol **Refresh status**: ambil token sesi terbaru lewat `GET /api/status`, lalu `POST /api/refresh` dengan JSON `{}`, token sesi, dan `Origin` yang dilindungi. Timer ini hanya timer browser; halaman tidak menjadwalkan pekerjaan di server. Refresh pertama dihitung sejak halaman aktif, bukan sejak load selesai; tombol manual tetap tersedia dan tidak mereset cadence. Jika refresh sedang berjalan, atau aksi worker sedang sibuk, interval itu dilewati tanpa antrean/catch-up. `pagehide` menghentikan timer dan `pageshow` melanjutkan kembali cadence untuk halaman yang kembali dari bfcache; sleep/background browser dapat menunda timer. Refresh ini read-only: tidak memulai/menghentikan worker dan tidak meminta password, wallet, atau fund action.

Refresh itu melakukan urutan tetap `GET https://reset.openmayhem.ai/v1/state`, `GET /v1/account/<alamat publik>`, lalu `GET /v1/state`, dengan batas waktu total 5 detik, respons maksimum 256 KiB, tanpa redirect atau retry. State dan account harus konsisten; jika gateway gagal, timeout, atau data tidak konsisten, status menjadi **unavailable** dan angka stale tidak ditampilkan. UI mencatat timestamp percobaan dan timestamp sukses terakhir; refresh berikutnya atau tombol manual dapat mencoba lagi. Start/stop juga mengambil status lokal setelah aksinya. Fitur ini bukan auto-restart worker dan bukan schedule server.

Pembaca publik tidak mendapat akses ke wallet, key, jurnal, signing, start, atau stop dan refresh tidak memerlukan password. Namun response status lengkap dashboard tetap dapat menyertakan metadata jurnal lama secara read-only yang dibaca server lokal; jangan menafsirkan ini sebagai akses publik ke isi jurnal atau klaim bahwa seluruh response HTTP tidak menyentuh metadata jurnal.

### 4. Jalankan dashboard lokal, tanpa otomatis menjalankan worker

Untuk mencoba tampilan paling aman, tanpa wallet, jurnal pengguna, gateway, atau transaksi:

```bash
cd ~/src/resetmnr
npm run dashboard:demo
```

Buka **http://127.0.0.1:4780** di browser Windows jika forwarding localhost WSL tersedia. Semua data dan tombol mode DEMO bersifat sintetis; ronde demo bukan status jaringan. Stop dengan **Ctrl+C** sebelum memakai port yang sama untuk dashboard non-demo.

Untuk membuka panel worker existing **saja**, setelah alamat cocok dan status terkini diperiksa, dari terminal WSL interaktif:

```bash
cd ~/src/resetmnr
npm run dashboard:worker -- --address ALAMAT_RESET_64_HEX_YANG_DISETUJUI
```

Ganti placeholder dengan alamat publik yang sudah diverifikasi. Tetap buka **http://127.0.0.1:4780**. Membuka/refresh halaman tidak membuka wallet atau memulai worker. Saat load, browser hanya mengambil status lokal/cache sekali; setelah 3 menit halaman aktif, refresh publik read-only berjalan tiap 3 menit selama halaman terbuka, dengan aturan skip saat refresh atau aksi worker sedang sibuk. Dashboard dapat membaca metadata jurnal lokal; exposure/ronde historisnya bukan saldo terkini. Label cap 0.1 bukan laporan jumlah saldo. Jangan mengubah bind loopback, membuka firewall/LAN, atau menambah tunnel publik; localhost bukan perlindungan terhadap komputer/browser yang sudah terkompromi.

**Jangan klik Mulai worker hanya untuk melihat dashboard atau menguji koneksi.** Tombol itu menjalankan operasi live: perlu persetujuan eksplisit maksimum deposit + exits 0.1 RESET/claim level 1000 dan password tersembunyi di terminal WSL. Password tidak dimasukkan lewat browser/HTTP. Bila worker CLI lama masih berjalan, hentikan di terminal asal dengan Ctrl+C dan tunggu selesai; dashboard tidak dapat mengambil alih atau menghentikan worker CLI lain. Jangan memulai dua worker untuk wallet yang sama.

Tombol **Hentikan worker** meminta stop/abort worker milik dashboard; tunggu status berhenti. **Ctrl+C di terminal dashboard** menghentikan dashboard dan worker miliknya. Menutup tab browser tidak menghentikan worker; browser terputus berarti status tidak diketahui. Stop tidak melepas dana terkunci, tidak membatalkan transaksi yang sudah terkirim, dan dapat meninggalkan intent ambigu yang perlu pemeriksaan manual. Tidak ada auto-start, auto-restart, jadwal, atau daemon. Restart bersih memerlukan klik dan input password baru; jangan menghapus jurnal/lease untuk melewati error.

Dashboard signer lama di **http://127.0.0.1:4747** adalah panel read-only terpisah, bukan panel kontrol worker 4780; ia tetap dapat menghubungi gateway untuk membaca state. Rincian status publik, pengaman HTTP, status historis, dan stop ada di [panduan dashboard](docs/DASHBOARD.md); mekanisme jurnal/restart ada di [panduan worker](docs/WORKER.md). Bagian validasi lama di bawah mencatat tahap implementasi masing-masing, bukan pernyataan saldo/status wallet Anda saat ini.

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

**New: local worker control dashboard** — status, last action, historical journal metadata, explicit Start/Stop buttons, and offline demo at **http://127.0.0.1:4780**. Run `npm run dashboard:worker -- --address YOUR_APPROVED_64_HEX_ADDRESS` from your WSL checkout, or `npm run dashboard:demo` without a wallet. Opening the page never starts the worker; live Start requires confirmation plus a hidden password prompt in the foreground terminal. Stop does not unlock funds or reverse submitted transactions. Stop any existing CLI worker with Ctrl+C first; this dashboard cannot adopt it. See [the WSL dashboard guide](docs/DASHBOARD.md). No live worker was started during implementation or tests.

The original **read-only signer dashboard** below remains separate and unchanged:

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

An **offline manual foreground simulator** and a **separate local live adapter** are available. The adapter has only been tested here with offline mocks/synthetic data; it has not opened a real wallet, signed or submitted a real transaction, or connected to live RESET during this extension. Live use requires the approved wallet/machine, interactive terminal, expected address and explicit confirmation. MCP and the original read-only dashboard do not participate. The new worker dashboard can manually start the same bounded runtime only after confirmation and terminal password input. There is no schedule or model API integration.

Run `npm run worker:simulate` manually and stop with Ctrl+C. This unchanged in-memory simulation uses no wallet, credentials, signer, gateway, network or AI. It runs without a duration cutoff, scheduler, auto-start or auto-restart; its one-second pause only paces simulated blocks. The simulator still refuses all live, wallet, gateway and duration flags. The live executable is separate (`bin/reset-worker-live.mjs`) and is not started by installation, MCP or tests. Run `npm run test:worker-live` for offline adapter tests. See [the worker guide](docs/WORKER.md) for the exact command after authorization, journal/recovery limits and the remaining approval gate.

Use live `rules` and `status`, not an announcement. The public bootstrap lottery ended after 144 counted heights starting at 971559. Current official rules require at least 0.1 RESET deposited in the Mine and normally a **144-counted-Bitcoin-block exit wait**, not a guaranteed 24 hours. Pending claims must settle before withdrawal; unwithdrawn exits can still face penalties. Check live settings before any future action.

Starting RESET could come from a participant's voluntary transfer or a useful first header submission if the network actually credits it. This project provides no faucet, buys no tokens and guarantees no reward. Use the **64-hex address** returned by `address` to receive RESET; the related `trac1` address is for TNK transfer fees. No live account address is published here.

The approved worker design is manual foreground until Ctrl+C, with no duration cutoff, scheduler, auto-start, auto-restart or AI; maximum total deposit-plus-exits exposure is 0.1 RESET and claims must use level 1000 only. The implemented adapter preserves that policy, durable intent journaling, deduplication across clean restarts, repeated fresh-state checks and fail-closed handling of ambiguous submissions. It uses the reviewed pinned signer directly, not funds tools in MCP. Explicit permission to access the selected local wallet/network and sign/submit real lock/claim actions is still required. Keep the private `~/.reset-worker` journal: crashes, unresolved intent or a halt marker block restart until manual reconciliation; do not delete it to retry. Stop other funds-capable writers to the same wallet. Ctrl+C cannot undo a request already sent or release locked funds. A hibernating cloud sandbox is not a reliable continuous host; a laptop pauses while sleeping or off. The four-tool safe MCP wrapper is unchanged and will not be expanded to expose fund operations.

The sole legacy compatibility exception is one exact `halt {intentWritten:false}` immediately after a fully audited round-400 abandonment, with no pending intent. Read-only parsing can remove that journal-inspection blocker without changing bytes or starting anything; round 400 remains consumed, lock remains one-shot, and every fresh snapshot must still pass the cap and monotonicity checks. Other/new classified halts and existing leases remain blocking. New errors expose only static diagnostic stages, not raw exceptions or secrets. This fixes a narrowly defined dashboard blocker, not its triggering runtime error. See [the exact conditions](docs/ROUND400-RECOVERY.md#restart-and-parser-guarantees); manual Start is still required.

**Persiapan tambahan, belum diterapkan ke WSL:** [rekonsiliasi khusus `snapshot-read`](docs/SNAPSHOT-READ-RECONCILIATION.md) hanya menerima abandonment tervalidasi → satu halt legacy → satu halt `intentWritten:false, failureStage:"snapshot-read"`, lalu audit append-only dengan konfirmasi terikat seluruh byte jurnal. Tanpa audit eksplisit, halt baru tetap memblokir. Stage lain dan intent ambigu tidak memenuhi syarat; ronde 400 tetap dilarang, penyebab tetap tidak diketahui, dan tidak ada auto-start atau otorisasi transaksi.

To stop supervised access, disconnect `reset-safe` in your agent; reconnect to resume. Stop the dashboard with Ctrl+C. Nothing automatically resumes after WSL shutdown, sleep, logout or reboot. Closing the client should close the signer child; Linux cleanup is tested, Windows/WSL orchestration is not. There is no schedule to pause or resume.

Stopping software does not release locked coins. This wrapper blocks `unlock` and `withdraw`. If another explicitly authorized setup locks coins, recovery requires a trusted funds-capable signer: request unlock, wait the live release height, let claims settle, then withdraw mature exits.

## Security boundary

The entrypoint checks the pinned upstream HEAD and clean signer tree before importing its SDK, rejects arguments, fixes gateway/header source and wallet path, and passes only minimal operating-system environment plus the password to the signer. It drops child instructions, stderr, logs and server-initiated requests, and redacts the exact password from results. Tool text is untrusted data. It does not sandbox a malicious same-user process, modified dependencies, compromised npm packages, or a dishonest gateway. Keep the checkout and host trusted and grant the agent no unrelated shell/file permissions.

Upstream's MIT license stays in the separately fetched source. No upstream source, user wallet, keystore, secret reference, live account data or private activity log is distributed here. See [NOTICE.md](NOTICE.md) and [docs/VALIDATION.md](docs/VALIDATION.md).
