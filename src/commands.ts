/** Definisi slash command (format JSON Discord API) — didaftarkan lewat `npm run register`. */

const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;

const gameChoices = [
  { name: "Werewolf", value: "werewolf" },
  { name: "Tebak Kata", value: "guess-word" },
  { name: "Trivia", value: "trivia" },
  { name: "Hangman", value: "hangman" },
  { name: "Acak Kata", value: "word-scramble" },
];

function sub(name: string, description: string, options: unknown[] = []) {
  return { type: SUB_COMMAND, name, description, options };
}

export const commandData = [
  {
    name: "game",
    description: "Kelola game text-based di channel ini",
    // Hanya di server (bukan DM).
    contexts: [0],
    options: [
      sub("create", "Buat lobby game baru (dimoderasi otomatis oleh bot)", [
        { type: STRING, name: "jenis", description: "Jenis game", required: true, choices: gameChoices },
      ]),
      sub("join", "Gabung ke lobby di channel ini"),
      sub("leave", "Keluar dari lobby sebelum game dimulai"),
      sub("start", "Mulai game"),
      sub("status", "Lihat status game"),
      sub("stop", "Batalkan atau tutup game (host saja)"),
      sub("hint", "Berikan hint untuk Tebak Kata atau Acak Kata"),
      sub("answer", "Kirim jawaban atau satu huruf untuk Hangman", [
        { type: STRING, name: "teks", description: "Jawabanmu", required: true },
      ]),
      sub("night", "Kirim aksi malam Werewolf", [{ type: USER, name: "target", description: "Pemain target", required: true }]),
      sub("vote", "Berikan vote Werewolf", [{ type: USER, name: "pemain", description: "Pemain yang dipilih", required: true }]),
      sub("myrole", "Kirim ulang role rahasia Werewolf-mu lewat DM"),
    ],
  },
  {
    name: "level",
    description: "Cek level dan progress XP kamu (atau pemain lain)",
    options: [{ type: USER, name: "pemain", description: "Cek level pemain lain (opsional)" }],
  },
  {
    name: "leaderboard",
    description: "Lihat papan peringkat level pemain",
    options: [{ type: STRING, name: "jenis", description: "Saring berdasarkan game", choices: gameChoices }],
  },
  { name: "help", description: "Lihat panduan dan daftar fitur bot" },
  { name: "ping", description: "Cek status dan respons bot" },
];
