# Discord Text Games Bot

Bot Discord interaktif untuk game berbasis teks, berjalan **serverless di Vercel** memakai
Discord *HTTP Interactions* (bukan koneksi Gateway yang harus menyala terus).

## Fitur

- **Werewolf**: role rahasia dikirim lewat DM dengan alur yang aman — role dihitung, DM dicoba dikirim ke **semua** pemain terlebih dahulu, dan sesi baru benar-benar dimulai jika semua DM berhasil. Jika ada yang gagal (DM tertutup), game tidak dimulai dan host mendapat daftar jelas siapa yang perlu membuka DM-nya; percobaan ulang tidak mengacak ulang role pemain yang sudah menerimanya. Pemain juga bisa memakai `/game myrole` kapan saja untuk meminta role dikirim ulang.
- Fase malam Werewolf otomatis lanjut lebih cepat begitu semua aksi yang dibutuhkan (Werewolf, Seer, Doctor bila hidup) sudah masuk — tidak perlu menunggu penuh timer.
- **Moderator: hanya bot AI.** Bot yang mengatur seluruh alur malam/siang/voting secara otomatis; host cukup membuat, memulai, dan menutup sesi.
- **Trivia** 5 ronde per sesi (40+ soal), **Tebak Kata**, **Hangman**, **Acak Kata** (32 kata).
- **Sistem level & progress bar**: menang atau menjawab benar memberi **+1 XP**. Setiap 10 XP naik satu level, maksimal **Level 99**.
- `/help`, `/ping`, `/level`, `/leaderboard`, tombol Gabung/Keluar/Mulai/Hint/pilihan Trivia.

## Cara kerja di Vercel

| Bagian | Fungsinya |
| --- | --- |
| `api/interactions.ts` | Endpoint yang dipanggil Discord setiap ada slash command / klik tombol. |
| `api/tick.ts` | Timer fase Werewolf (malam 75 dtk, siang 90 dtk, voting 45 dtk). Dipanggil oleh bot sendiri. |
| Upstash Redis | Menyimpan sesi game per channel dan statistik/level pemain. Vercel tidak punya memori/disk permanen. |

Bila sebuah timer sempat gagal jalan, fase tetap dilanjutkan otomatis saat ada interaksi berikutnya di channel itu (misalnya `/game status`).

## Deploy ke Vercel

### 1. Siapkan aplikasi Discord

1. Buka <https://discord.com/developers/applications> → pilih aplikasi bot.
2. **General Information** → salin **Public Key**.
3. **Bot** → **Reset Token** → salin token (simpan baik-baik, jangan dibagikan).

### 2. Import repo ke Vercel

1. Di <https://vercel.com/new>, pilih **Import** repository GitHub ini.
2. **Framework Preset**: `Other`. Biarkan Build/Output Command kosong.
3. Buka **Environment Variables**, tambahkan:

| Nama | Nilai |
| --- | --- |
| `DISCORD_TOKEN` | Token bot (wajib) |
| `DISCORD_PUBLIC_KEY` | Public Key aplikasi (wajib) |

4. Klik **Deploy**.

### 3. Tambahkan database Redis (gratis)

1. Di project Vercel → tab **Storage** → **Create Database** → pilih **Upstash for Redis** (Marketplace) → paket gratis → **Connect** ke project ini.
2. Vercel otomatis menambahkan `KV_REST_API_URL` dan `KV_REST_API_TOKEN`.
3. Tab **Deployments** → titik tiga pada deployment terbaru → **Redeploy** (agar variabel baru terbaca).
4. Buka `https://<nama-project>.vercel.app/api/interactions` di browser. Harus muncul **✅ Bot siap**. Bila muncul ⚠️, variabel yang disebut belum diisi.

### 4. Sambungkan Discord ke Vercel

1. Discord Developer Portal → **General Information** → **Interactions Endpoint URL** →
   isi `https://<nama-project>.vercel.app/api/interactions` → **Save Changes**.
   Discord langsung menguji URL ini; bila gagal tersimpan, cek langkah 3.4.
2. Di komputer (sekali saja), daftarkan slash command:

```powershell
copy .env.example .env      # lalu isi DISCORD_TOKEN (dan DISCORD_GUILD_ID untuk tes cepat)
npm install
npm run register
```

3. **Hanya bila bot ini belum pernah dinyalakan sama sekali** (misalnya belum pernah `npm run dev` versi lama):
   Discord mewajibkan bot login ke Gateway sekali sebelum bisa mengirim pesan/DM. Jalankan:

```powershell
npm run identify-once
```

### 5. Undang bot ke server

Developer Portal → **OAuth2** → **URL Generator** → scope `bot` + `applications.commands`,
permission **View Channels**, **Send Messages**, **Embed Links** → buka URL yang dihasilkan.

> Bot akan terlihat **offline** di daftar member. Ini normal untuk bot HTTP Interactions — semua perintah tetap berjalan.

> Jangan aktifkan **Deployment Protection → All Deployments** di Vercel; Discord harus bisa mengakses domain produksi.

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
/level
/leaderboard
/leaderboard jenis:trivia
/ping
```

Untuk Werewolf, **semua pemain wajib mengaktifkan Direct Messages dari anggota server** (klik nama server → Pengaturan Privasi → izinkan DM) sebelum `/game start` dijalankan.

## Pemeriksaan kualitas

```powershell
npm run typecheck
npm test
```

Test menyimulasikan request Discord bertanda tangan ke endpoint Vercel, termasuk alur Trivia, Werewolf (DM, timer fase, aksi malam), dan penolakan signature palsu.
