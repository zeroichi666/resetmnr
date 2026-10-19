# Worker RESET lokal: adapter tersedia, live belum dijalankan

Adapter lokal tanpa AI sudah diimplementasikan **dan hanya diuji offline**. Simulator tetap terpisah dan tidak diubah. Tidak ada wallet sungguhan yang dibaca/dibuka, koneksi live RESET, signing nyata, transaksi, atau perubahan laptop pada tahap ini. Lulus tes bukan bukti penerimaan jaringan, kompatibilitas live, settlement, keamanan mutlak, atau keuntungan.

## Batas yang tidak berubah

Total **deposit + seluruh exits** maksimum **0.1 RESET**, memakai integer delapan desimal. Lock hanya tepat `0.1` saat deposit dan exits nol serta saldo cukup. Saldo berlebih tidak dikunci; deposit parsial atau exits tidak ditambah. Ini batas total exposure, bukan jatah transaksi yang boleh diulang. Minimum lock aktual harus tepat `10000000` unit; perubahan minimum menyebabkan berhenti, bukan penyesuaian otomatis.

Klaim hanya fair-share level **1000**: payload wire `{r: ronde, q: 1000}`, tanpa `allow_over`. Deposit harus tepat 0.1, belum ada klaim pada ronde itu, jendela terbuka, kapasitas dan moves tersedia. Strikes, exposure berlebih, klaim tidak aman, snapshot tidak konsisten, reorg/regresi, atau exposure yang berkurang menghentikan worker.

Tidak ada lottery, transfer, unlock, withdraw, arbitrary signing, chat, AI, atau posting header otomatis. `reset-safe` tetap hanya **`rules`, `status`, `address`, `post_headers`**; adapter tidak memakai atau memperluas allowlist MCP tersebut.

## Simulator aman tetap tersedia

Dengan Node.js 24+ dari direktori proyek:

```bash
npm run worker:simulate
# atau node bin/reset-worker.mjs --simulate
```

Saldo, blok dan aksi seluruhnya buatan di memori. Simulator berjalan foreground sampai Ctrl+C; restart memulai simulasi baru. CLI simulator masih menolak `--live`, wallet/gateway override, durasi, dan argumen lain. Jeda satu detik hanya pacing blok simulasi. Tidak ada payout yang dikarang.

## Bagian adapter

- `bin/reset-worker-live.mjs`: executable live terpisah, bukan pengganti simulator/MCP.
- `lib/worker-live-runtime.mjs`: gateway tetap, verifikasi pin dan checksum rules, import signer tertunda.
- `lib/worker-live-start.mjs`: startup/cleanup yang dapat diuji dengan dependency sintetis; jurnal diperiksa sebelum import wallet atau unlock.
- `lib/worker-live.mjs`: executor serial, pemeriksaan status berulang, intent persisten, deduplikasi dan fail-closed.
- `lib/worker-live-port.mjs`: memakai backend, validator state/account, solver, serta verifier signer resmi terpin; hanya menyiapkan lock dan claim dengan payload yang dibatasi.
- `lib/worker-live-journal.mjs`: lease eksklusif, NDJSON private, write-complete dan fsync sebelum intent dianggap tersimpan.

Runtime menggunakan source signer commit `6132e8653d6342f36673eb7426ec8e064960e48e`. Rules lokal terpin dicek SHA-256 `517b8f5ac63d15873ea3333061971ad68181365d3ea80fd83b8f68fe78365b4f`; teks rules/opini tidak dieksekusi sebagai instruksi. Adapter gateway langsung tidak menyediakan tool `rules` remote: kontrak rules berasal dari source terpin dan parameter jaringan aktual divalidasi pada setiap snapshot. Ketidaksesuaian kontrak/minimum dihentikan, tidak disesuaikan diam-diam.

Snapshot membaca state–account–state dan menolak perubahan tanpa retry transparan. Snapshot operasional dan seluruh proof-state tervalidasi dibandingkan sebelum prepare, sebelum/sesudah puzzle, dan sesudah verifikasi tanda tangan sebelum submit. Tip, hash, ronde, payload, difficulty, alamat dan prepared message diverifikasi. Solver dibatasi 1.000.000 percobaan/15 detik; ini pengaman pekerjaan puzzle, **bukan timer durasi worker**.

## Jurnal: jangan hapus untuk mencoba ulang

Lokasi runtime tetap, terpisah dari keystore:

```text
~/.reset-worker/journal.ndjson
~/.reset-worker/active/
```

Direktori dibuat 0700 jika belum ada; file 0600. Owner, tipe, symlink/hardlink dan batas ukuran diperiksa; izin yang tidak aman ditolak, bukan dilonggarkan. Identity mengikat alamat, gateway dan pin. Lease mencegah dua worker dengan jurnal yang sama. Batas jurnal 1 MiB dan tiap record 64 KiB; penuh berarti berhenti, bukan menghapus histori. Jurnal berisi metadata aktivitas private, bukan password, private key, atau paket signed; jangan masukkan ke Git atau chat.

Intent ditulis lengkap dan di-fsync **sebelum puzzle/signing**. Lock tidak boleh diulang; klaim dideduplikasi per ronde lintas restart. Restart bersih boleh melanjutkan ronde berikutnya dengan histori yang sama. Intent belum selesai, marker halt, file kosong/truncated/corrupt, atau lease tertinggal setelah crash menolak startup. Error fsync/short write nol byte juga fail-closed. Tidak ada perintah reset, recovery, resume error, atau retry otomatis.

Respons `ok: true` harus diikuti observasi deposit/klaim yang cocok; accepted-but-unobserved, rejected, timeout, respons hilang, atau abort di tengah aksi membuat worker berhenti. Aplikasi terlihat **bukan** settlement/finalitas. Ctrl+C saat jeda polling setelah aksi terobservasi menutup normal. Ctrl+C saat operasi dapat meninggalkan intent/halt yang memerlukan pemeriksaan manual.

Jangan menghapus lease/jurnal atau menjalankan dengan home berbeda untuk melewati blokir. Rekonsiliasi manual harus memeriksa proses lama sudah mati, alamat/gateway, intent terakhir, state jaringan, aplikasi dan settlement; bila hasil tetap ambigu, jangan submit ulang. Implementasi ini sengaja belum menyediakan pemulihan otomatis. Penanganan hasil ambigu dan perubahan/pemindahan jurnal memerlukan review/izin terpisah.

## Sebelum boleh menjalankan live

Persetujuan saat ini hanya **kode dan tes offline**, bukan izin akses wallet atau transaksi. Masih perlu persetujuan eksplisit yang menyebutkan:

1. Mesin Linux/WSL2 yang dipilih dan wallet existing `~/.reset-signer/keystore.json` pada mesin itu, dengan alamat publik RESET 64-hex yang benar. Tidak ada wallet yang dibuat, diimpor, atau dipindahkan oleh worker.
2. Izin membuka wallet lokal dan menghubungi gateway tetap `https://reset.openmayhem.ai` untuk membaca state/account, menyelesaikan puzzle, menandatangani dan mengirim aksi nyata.
3. Izin lock **maksimum total deposit+exits 0.1 RESET** dan claim **level 1000 saja**, manual foreground sampai Ctrl+C, tanpa AI/scheduler/auto-start/auto-restart.

Hentikan semua program lain yang bisa mengubah dana wallet tersebut. Lease hanya mengoordinasikan worker ini, bukan signer lain atau komputer lain. Snapshot dan submit tidak atomik; perubahan eksternal setelah pemeriksaan terakhir dan gateway tidak jujur tidak dapat dicegah sepenuhnya oleh adapter. Jangan menganggap cap ini jaminan atas operasi di luar worker. Native Windows tidak didukung; Windows/WSL/laptop pengguna belum diuji atau disentuh.

**Contoh perintah setelah izin tersebut diberikan, bukan perintah yang sudah dijalankan:**

```bash
# Di terminal Linux/WSL2 interaktif, dari checkout yang direview.
# Ganti alamat contoh dengan alamat publik wallet yang disetujui.
read -r -s -p 'Password wallet: ' RESET_SIGNER_PASSWORD
printf '\n'
export RESET_SIGNER_PASSWORD
node bin/reset-worker-live.mjs --live --confirm-real-transactions --address ALAMAT_RESET_64_HEX
unset RESET_SIGNER_PASSWORD
```

Password tidak boleh ditaruh di argumen CLI, source, Git, atau konfigurasi publik. Runtime menghapus env password miliknya setelah mengambilnya; env shell induk tetap perlu di-unset. Environment dan string JavaScript bukan hardware vault dan tidak dapat dijamin terhapus dari memori. CLI menuntut TTY stdin/stdout, flags persetujuan dan alamat; ia menolak wallet/gateway/durasi override. Default gateway dan wallet tidak bisa diganti lewat environment signer. Tidak ada script live auto-start dalam npm.

Loop memeriksa satu langkah, lalu jeda polling 60 detik; tidak ada batas durasi, daemon, scheduler, auto-start atau auto-restart. Putaran berikutnya tidak dijalankan setelah error. Ctrl+C menghentikan pekerjaan baru dan meminta abort puzzle. HTTP yang sudah dikirim dapat tetap selesai (backend membatasi satu request sekitar 5 detik); berhenti tidak menjamin pembatalan atau reversal transaksi. **Berhenti tidak melepaskan dana terkunci.** Unlock/withdraw tetap di luar implementasi dan izin ini.

## Pengujian

```bash
npm run test:worker       # simulator/policy lama, 29 tes
npm run test:worker-live  # adapter/port/lifecycle/jurnal/CLI tiruan, offline
npm test                 # seluruh suite
```

Tes adapter/port/lifecycle berjalan di bawah guard yang menolak jaringan, child process, path wallet/keystore, dan write filesystem. Port memakai validator upstream murni untuk data sintetis, tetapi solver/signature/submit di-mock. Tes jurnal menulis hanya ke direktori temporer sintetis; tes CLI valid menggunakan preload yang **mengganti runtime live sepenuhnya dengan simulator**, bukan membuka runtime live. Tes CLI penolakan memakai guard offline. Tidak ada signer nyata yang dibuka atau tanda tangan nyata yang dibuat.

Cakupan mencakup unit/cap, level 1000, payload/prepared tampering, minimum aktual berubah, fresh-state race, verifikasi sebelum submit, abort sebelum/saat/setelah submit, accepted-but-unapplied, lost response, crash lease, restart bersih, replay ambigu, fsync gagal, short write, korupsi jurnal, symlink/hardlink/mode, dan 2.000 tinggi sintetis. Tes tidak membuktikan transport HTTP aktual, kriptografi/puzzle nyata, penerimaan jaringan, settlement, payout, atau kompatibilitas laptop.
