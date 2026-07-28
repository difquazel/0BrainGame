# Discord Text Games Bot

Bot Discord interaktif untuk game berbasis teks. Siap dipasang dari GitHub ke Railway.

## Fitur

- **Werewolf**: role rahasia dikirim lewat DM dengan alur yang aman — role dihitung, DM dicoba dikirim ke **semua** pemain terlebih dahulu, dan sesi baru benar-benar dimulai jika semua DM berhasil. Jika ada yang gagal (DM tertutup), game tidak dimulai dan host mendapat daftar jelas siapa yang perlu membuka DM-nya; percobaan ulang tidak mengacak ulang role pemain yang sudah menerimanya. Pemain juga bisa memakai `/game myrole` kapan saja untuk meminta role dikirim ulang.
- Fase malam Werewolf otomatis lanjut lebih cepat begitu semua aksi yang dibutuhkan (Werewolf, Seer, Doctor bila hidup) sudah masuk — tidak perlu menunggu penuh timer.
- **Moderator: hanya bot AI.** Tidak ada lagi mode moderator manusia; bot yang mengatur seluruh alur malam/siang/voting secara otomatis, host cukup membuat, memulai, dan menutup sesi.
- **Trivia** sekarang berjalan 5 ronde per sesi dengan bank soal yang jauh lebih besar (40+ soal berbagai kategori), begitu juga bank kata untuk Tebak Kata/Hangman/Acak Kata (32 kata).
- **Sistem level & progress bar**: menang sebuah game atau menjawab benar (termasuk tiap ronde Trivia) memberi **+1 XP**. Setiap 10 XP naik satu level, maksimal **Level 99**. Setiap perolehan poin langsung diumumkan lewat embed lengkap dengan bar progres dan notifikasi naik level.
- Tampilan lebih interaktif: embed berwarna sesuai fase, tombol Gabung/Keluar/Mulai/Hint/pilihan Trivia, dan `/help`, `/ping`, `/leaderboard` (dengan level & progress bar per pemain).
- Statistik permainan (menang/main per game) tersimpan di folder `data` secara lokal dan dapat dipertahankan di Railway dengan Volume.

## Jalankan di komputer

1. Salin `.env.example` menjadi `.env`.
2. Isi `DISCORD_TOKEN` dengan token bot Discord. Jangan pernah unggah file `.env` ke GitHub.
3. Isi `DISCORD_GUILD_ID` bila ingin slash command langsung tersedia di satu server untuk pengujian.
4. Jalankan:

```powershell
npm install
npm run dev
```

## Upload ke GitHub

1. Buat repository kosong di GitHub, tanpa README tambahan.
2. Upload seluruh isi folder proyek ini, termasuk folder `src`, `package.json`, `package-lock.json`, dan `railway.toml`.
3. Jangan upload `node_modules`, `dist`, `data`, atau `.env`; semuanya sudah masuk `.gitignore`.

## Deploy ke Railway

1. Di Railway pilih **New Project** → **Deploy from GitHub repo** lalu pilih repository ini.
2. Pada menu **Variables**, tambah:

| Nama | Nilai |
| --- | --- |
| `DISCORD_TOKEN` | Token bot dari Discord Developer Portal (wajib) |
| `DISCORD_GUILD_ID` | ID server Discord untuk pengujian cepat (opsional) |
| `DATA_DIR` | Kosongkan bila memakai Volume; atau isi path data khusus (opsional) |

3. Railway otomatis menjalankan `npm run build`, lalu `npm start`.
4. Buka tab **Deployments**. Jika log menampilkan `Bot aktif sebagai ...`, bot sudah online.

### Agar leaderboard tidak hilang saat redeploy

Tambahkan **Volume** pada service Railway dengan mount path `/data`. Bot otomatis memakai path Volume tersebut melalui `RAILWAY_VOLUME_MOUNT_PATH`, jadi `DATA_DIR` tidak perlu diisi. Tanpa Volume, sistem file Railway bersifat sementara dan statistik akan hilang saat deploy ulang.

> Discord bot tidak membutuhkan domain publik atau port HTTP. Railway hanya dipakai untuk menjaga proses bot tetap berjalan.

## Perintah utama

```text
/help
/game create jenis:werewolf
/game join
/game start
/game night target:@pemain
/game vote pemain:@pemain
/game myrole
/game answer teks:jawaban
/game hint
/game status
/game stop
/leaderboard
/leaderboard jenis:trivia
/ping
```

Untuk Werewolf, **semua pemain wajib mengaktifkan Direct Messages dari anggota server** (klik nama server → Pengaturan Privasi → izinkan DM) sebelum `/game start` dijalankan, karena role hanya dikirim lewat DM dan sesi baru dimulai setelah semua DM dipastikan terkirim.

## Pemeriksaan kualitas

```powershell
npm run build
npm run typecheck
npm test
```
