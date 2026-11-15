import type { ActionRow, Embed } from "./discord-api.js";
import type { GameSession, GameType } from "./domain/types.js";
import { GameService } from "./game-service.js";

export const BOT_VERSION = "3.0.0";

const labels = new GameService();

export function gameLabel(gameType: GameType): string {
  return labels.gameLabel(gameType);
}

function phaseColor(session?: GameSession): number {
  if (!session) return 0x5865f2;
  switch (session.phase) {
    case "lobby":
      return 0x57f287;
    case "night":
      return 0x2c2f33;
    case "day":
      return 0xfee75c;
    case "voting":
      return 0xed4245;
    case "playing":
      return 0x5865f2;
    case "finished":
      return 0xeb459e;
    default:
      return 0x5865f2;
  }
}

function gameEmoji(gameType?: GameType): string {
  switch (gameType) {
    case "werewolf":
      return "🐺";
    case "guess-word":
      return "🔤";
    case "trivia":
      return "🧠";
    case "hangman":
      return "🪢";
    case "word-scramble":
      return "🔀";
    default:
      return "🎮";
  }
}

export function eventEmbed(session: GameSession | undefined, text: string): Embed {
  const title = session ? `${gameEmoji(session.gameType)} ${gameLabel(session.gameType)}` : "🎮 Game";
  return { color: phaseColor(session), title, description: text };
}

export function buildHelpEmbed(): Embed {
  return {
    color: 0x00aeef,
    title: "📌 Panel Bantuan & Fitur Bot",
    description: "Berikut perintah untuk memainkan game text-based bersama teman di server ini.",
    fields: [
      {
        name: "🎮 Mulai bermain",
        value: "`/game create jenis:werewolf`\n`/game join` untuk masuk lobby\n`/game start` untuk memulai permainan",
      },
      {
        name: "🕹️ Pilihan game",
        value: "**Werewolf** — role rahasia & voting\n**Tebak Kata** — tebak berdasarkan kategori\n**Trivia** — 5 ronde soal pilihan A–D\n**Hangman** — selamatkan kata\n**Acak Kata** — susun kata secepatnya",
      },
      {
        name: "🤖 Moderator",
        value: "Semua game dimoderasi otomatis oleh **bot AI** — bot yang mengatur giliran malam, voting, dan ronde. Fase Werewolf akan lanjut lebih cepat begitu semua aksi yang dibutuhkan sudah masuk, atau otomatis setelah waktu tertentu.",
      },
      {
        name: "🌙 Perintah saat bermain",
        value: "`/game answer teks:...` — jawab game kata / trivia lewat tombol\n`/game hint` — minta hint\n`/game night target:@pemain` — aksi malam Werewolf\n`/game vote pemain:@pemain` — voting Werewolf\n`/game myrole` — kirim ulang role Werewolf-mu lewat DM\n`/game status` — lihat keadaan game",
      },
      {
        name: "⭐ Level & Progress",
        value: "Menang atau menjawab benar memberi **+1 poin XP**. Setiap 10 XP naik 1 level, maksimal **Level 99**. Progress ditampilkan lengkap dengan bar setiap kali kamu dapat poin!",
      },
      {
        name: "📊 Lainnya",
        value: "`/level` — cek level & progress XP kamu (atau pemain lain)\n`/leaderboard` — lihat peringkat level\n`/leaderboard jenis:trivia` — peringkat per game\n`/ping` — cek respons bot\n`/game stop` — tutup sesi (host saja)",
      },
      {
        name: "💡 Contoh cepat",
        value: "Buat game: `/game create jenis:trivia`\nUntuk Werewolf, semua pemain harus mengaktifkan DM (Pengaturan Privasi Server) agar role rahasia dapat diterima.",
      },
    ],
    footer: { text: `Game Master • Versi ${BOT_VERSION} • Gunakan /help kapan saja` },
    timestamp: new Date().toISOString(),
  };
}

export function componentsFor(session: GameSession | undefined): ActionRow[] {
  if (!session || session.phase === "finished") return [];
  if (session.phase === "lobby") {
    return [
      {
        type: 1,
        components: [
          { type: 2, custom_id: "game:join", label: "Gabung", emoji: { name: "🙋" }, style: 3 },
          { type: 2, custom_id: "game:leave", label: "Keluar", emoji: { name: "🚪" }, style: 2 },
          { type: 2, custom_id: "game:start", label: "Mulai", emoji: { name: "▶️" }, style: 1 },
        ],
      },
    ];
  }
  if (session.data.kind === "trivia" && session.phase === "playing") {
    return [
      {
        type: 1,
        components: session.data.choices.map((choice, index) => ({
          type: 2 as const,
          custom_id: `game:trivia:${index}`,
          label: `${String.fromCharCode(65 + index)}. ${choice}`.slice(0, 80),
          style: 2 as const,
        })),
      },
    ];
  }
  if ((session.data.kind === "guess-word" || session.data.kind === "word-scramble") && session.phase === "playing") {
    return [{ type: 1, components: [{ type: 2, custom_id: "game:hint", label: "Minta hint", emoji: { name: "💡" }, style: 2 }] }];
  }
  // Fase Werewolf lain (night/day/voting) tidak punya tombol kontrol manual —
  // hanya bot AI yang memoderasi jalannya fase tersebut.
  return [];
}
