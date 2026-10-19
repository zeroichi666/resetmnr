# Dashboard worker RESET lokal

Dashboard baru menyediakan status proses, pemeriksaan terakhir, aksi terakhir, riwayat aktivitas sesi, dan tombol **Mulai worker / Hentikan worker**. Ini dashboard pengendali worker tersendiri di **http://127.0.0.1:4780**, bukan dashboard read-only signer lama di port 4747.

## Menjalankan di Windows 11 + WSL2

Kode ini dibuat dan diuji offline di Sandbox, bukan pada laptop Anda. Worker CLI yang mungkin masih aktif di laptop **tidak diambil alih** oleh dashboard ini.

1. Di terminal WSL tempat worker lama berjalan, tekan **Ctrl+C**. Tunggu pesan worker berhenti. Berhenti tidak melepas lock atau membatalkan transaksi yang sudah terkirim. Jika ada error/hasil ambigu, periksa manual sebelum melanjutkan.
2. Perbarui checkout WSL Anda ke commit dashboard yang sudah direview. Jangan hapus jurnal/lease, mengganti HOME, atau membuat wallet baru untuk melewati penolakan. Jika checkout Anda memiliki perubahan lokal, jangan paksa menimpanya.
3. Dari checkout tersebut, dengan Node.js 24+, jalankan:

```bash
cd ~/src/resetmnr
npm run dashboard:worker -- --address ALAMAT_WALLET_RESET_64_HEX
```

Ganti placeholder dengan alamat publik wallet yang memang sudah disetujui. Buka **http://127.0.0.1:4780** di browser Windows. Terminal WSL harus tetap terbuka. Dashboard hanya bind IPv4 loopback; tidak ada port publik, tunnel, perubahan firewall, atau daemon. Akses Windows bergantung pada localhost forwarding WSL. Jangan membuka akses LAN/publik untuk mengatasi masalah forwarding.

4. Cocokkan alamat. Centang persetujuan transaksi nyata maksimum **deposit + exits 0.1 RESET**, claim **level 1000**, lalu klik **Mulai worker**. Kembali ke terminal WSL dan ketik password wallet; input tidak ditampilkan. Password tidak masuk ke browser/HTTP, berkas, atau argumen CLI. Setelah input benar, worker mulai menjalankan kebijakan live yang sudah ada.
5. Klik **Hentikan worker** untuk meminta stop/abort. Tunggu status Berhenti. Stop saat request sedang berlangsung tidak menjamin transaksi batal; intent/halt di jurnal dapat membutuhkan rekonsiliasi manual. Dana terkunci tetap terkunci.

Mulai lagi setelah stop bersih membutuhkan **klik dan input password terminal baru**. Worker tidak otomatis dimulai ketika halaman dibuka/di-refresh, tidak dijadwalkan, dan tidak auto-restart setelah error, sleep, reboot, atau terminal ditutup. Menutup tab browser **tidak menghentikan** foreground worker; gunakan tombol Hentikan atau Ctrl+C di terminal. Ctrl+C menutup dashboard dan worker yang dimilikinya. Penutupan paksa/crash bisa meninggalkan lease dan memerlukan pemeriksaan manual.

## Apa yang ditampilkan

Status berjalan berarti loop worker milik dashboard aktif, **bukan** bukti jaringan sehat atau keuntungan. Pemeriksaan terakhir adalah waktu langkah worker terakhir selesai, bukan pembaruan jaringan real-time; polling worker tetap 60 detik. Browser mengambil status lokal setiap 2 detik tanpa menambah request RESET. Koneksi browser putus berarti status tidak diketahui, bukan worker pasti berhenti.

Metadata jurnal hanya dibaca, tidak diubah atau dihapus. Exposure/ronde yang ditampilkan dari jurnal adalah **observasi historis terakhir**, bukan saldo atau state jaringan terkini. `0.1 RESET` pada panel batas adalah kebijakan cap, bukan klaim saldo saat ini. Aksi teramati bukan settlement/finalitas. Jika lease ada tetapi bukan milik dashboard, tombol Mulai diblokir. Lease tidak membuktikan proses masih hidup; bisa sisa crash. Dashboard tidak punya tombol membunuh/mengambil alih worker CLI lain, recovery, reset jurnal, transfer, unlock, atau withdraw.

Pengaman yang sudah ada tetap berlaku: alamat eksplisit, pin/rules, minimum lock tepat, exposure cap, level 1000, intent fsync, lease eksklusif, deduplikasi per ronde, dan fail-closed. Dashboard memanggil runtime live yang sama, bukan signer/tool baru. Pengamanan HTTP mencakup Host lokal, Origin sama, token sesi, JSON terbatas, no-CORS, CSP, dan no-cache. Komputer lokal/browser yang sudah terkompromi tetap di luar jaminan.

## Coba visual tanpa wallet/transaksi

```bash
npm run dashboard:demo
```

Buka URL lokal yang sama. Mode **DEMO** memakai data sintetis dan tidak membaca wallet, jurnal pengguna, menghubungi RESET, signing, atau submit. Tombol hanya mengendalikan worker dummy di memori. Ronde demo bukan ronde jaringan. Stop demo dengan Ctrl+C sebelum menjalankan dashboard live pada port yang sama.

## Tes

```bash
npm run test:dashboard
npm test
```

Tes lifecycle/password berjalan dengan guard offline; HTTP hanya memakai loopback dan mock, jurnal hanya direktori temporer sintetis. Tidak ada worker live dijalankan selama implementasi/tes ini. Kompatibilitas laptop/forwarding WSL dan transaksi nyata belum diverifikasi di mesin pengguna.
