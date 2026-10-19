# Rekonsiliasi terbatas untuk halt `snapshot-read`

## Status: disiapkan, belum diterapkan

Perubahan ini hanya menyiapkan kode dan pengujian offline. Tidak ada akses ke wallet atau jurnal WSL pengguna, gateway, maupun transaksi live. Tidak ada worker yang dijalankan, commit, atau push. Penyebab kegagalan `snapshot-read` **masih tidak diketahui**; kategori ini juga dapat mencakup validasi di dalam signer port, bukan bukti gangguan jaringan.

## Satu urutan yang diterima

Seluruh riwayat dan audit abandonment harus valid. Bagian akhir jurnal harus persis:

```text
abandon_claim {outcome:"unknown", retryForbiddenRound:400, ...audit valid...}
halt {intentWritten:false}                       # tepat satu marker legacy
halt {intentWritten:false, failureStage:"snapshot-read"}
```

CLI baru menyiapkan satu record `reconcile_snapshot_read` setelah urutan tersebut. Tidak ada record lama yang dihapus, diubah, diurutkan ulang, atau diubah menjadi observasi sukses. Tidak ada kesimpulan bahwa claim ronde 400 gagal atau tidak pernah diterapkan.

**Ronde 400 tetap dilarang dicoba ulang**, hasilnya tetap `unknown`, dan minimum ronde masa depan tetap 401. Riwayat lock satu kali, checkpoint, exposure, deduplikasi claim, batas `deposit + seluruh exits <= 0.1 RESET`, level 1000, serta pemeriksaan snapshot/monotonisitas tidak dilonggarkan.

Halt `snapshot-read` tetap memblokir parser sampai record audit eksplisit yang valid ditambahkan. Kompatibilitas legacy-only yang sudah ada tidak berubah. Setelah audit, hanya riwayat normal masa depan yang dapat mengikuti; halt baru berikutnya tetap memblokir dan tidak memenuhi syarat rekonsiliasi ini.

## Perintah untuk peninjauan manual nanti — jangan jalankan saat persiapan

Tidak ada default HOME atau pencarian wallet/jurnal. Operator harus memilih direktori jurnal privat absolut yang kanonis dan alamat publik yang benar, setelah mendapat otorisasi terpisah untuk mengaksesnya.

Inspeksi read-only:

```bash
node bin/reset-reconcile-snapshot-read.mjs \
  --journal-dir /ABSOLUTE/PRIVATE/JOURNAL_DIRECTORY \
  --address PUBLIC_64_HEX_ADDRESS
```

Inspeksi tidak menulis jurnal atau membuat/menghapus lease. Hasilnya mencakup `confirmation`, SHA-256 seluruh byte jurnal hingga halt target, `cause: unknown`, `outcome: unknown`, dan `workerStartAuthorized: false`. Token bukan otorisasi untuk menjalankan worker.

Hanya setelah peninjauan dan persetujuan terpisah untuk menerapkan audit, operator dapat memakai hasil inspeksi yang sama:

```bash
node bin/reset-reconcile-snapshot-read.mjs \
  --journal-dir /ABSOLUTE/PRIVATE/JOURNAL_DIRECTORY \
  --address PUBLIC_64_HEX_ADDRESS \
  --append \
  --confirm EXACT_INSPECTION_TOKEN
```

Perubahan satu byte pun membatalkan token lama. Opsi stage, evidence, startup, wallet, atau gateway tidak diterima. CLI ini tidak memulai/restart worker, membuka wallet, atau menghubungi backend. Start manual masa depan merupakan keputusan terpisah; audit ini bukan izin transaksi.

## Kondisi yang tetap ditolak

Stage selain `snapshot-read`, flag selain boolean `false`, field tambahan/hilang, marker legacy hilang/ganda, halt tambahan, intent pending/ambigu, evidence hold, abandonment palsu/ganda, audit/hash/identitas yang salah, serta riwayat aksi di antara marker tetap ditolak. Audit tidak boleh dipindah sebelum halt, digandakan, atau dipakai untuk halt berikutnya.

Lease `active` yang sudah ada tidak diambil alih atau dihapus. Append memakai mekanisme yang sama dengan abandonment: direktori/file privat terjangkar, pemeriksaan ownership/mode/symlink/hardlink, lease baru eksklusif, pembacaan ulang byte, append pada inode yang sama, fsync, verifikasi byte persis dan parser bersama. Hanya lease baru milik operasi yang berhasil boleh dilepas setelah verifikasi. Kegagalan tulis/fsync/close/verifikasi atau pelepasan lease yang tidak pasti mempertahankan atau mencoba memulihkan blokir, tidak melaporkan sukses, dan memerlukan peninjauan manual; jangan mengulang otomatis.

## Pengujian offline

`tests/snapshot-read-recovery.test.mjs` menggunakan jurnal sintetis pada direktori sementara dan menolak operasi jaringan/proses anak. Pengujian mencakup audit sebagai record terakhir, riwayat normal sesudah audit, larangan dispatch ronde 400, penolakan stage lain/intent ambigu, token usang, audit palsu, lease yang sudah ada, dashboard read-only, perubahan saat akuisisi lease, serta kegagalan durability. Tidak ada jaringan, signer, wallet, atau jurnal pengguna yang dipakai.

```bash
node --test tests/snapshot-read-recovery.test.mjs \
  tests/round400-abandon.test.mjs tests/round400-abandon-cli.test.mjs \
  tests/round400-recovery.test.mjs tests/worker-dashboard-journal.test.mjs
npm run test:worker
npm run test:worker-live
```

Ini membuktikan perilaku offline, bukan kesehatan gateway, penyebab error WSL, settlement/finalitas, atau kesiapan menjalankan transaksi live.
