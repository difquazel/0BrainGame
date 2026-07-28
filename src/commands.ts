import { SlashCommandBuilder } from "discord.js";

const gameChoices = [
  { name: "Werewolf", value: "werewolf" },
  { name: "Tebak Kata", value: "guess-word" },
  { name: "Trivia", value: "trivia" },
  { name: "Hangman", value: "hangman" },
  { name: "Acak Kata", value: "word-scramble" },
] as const;

export const commandData = [
  new SlashCommandBuilder()
    .setName("game")
    .setDescription("Kelola game text-based di channel ini")
    .addSubcommand((command) =>
      command
        .setName("create")
        .setDescription("Buat lobby game baru (dimoderasi otomatis oleh bot)")
        .addStringOption((option) => option.setName("jenis").setDescription("Jenis game").setRequired(true).addChoices(...gameChoices)),
    )
    .addSubcommand((command) => command.setName("join").setDescription("Gabung ke lobby di channel ini"))
    .addSubcommand((command) => command.setName("leave").setDescription("Keluar dari lobby sebelum game dimulai"))
    .addSubcommand((command) => command.setName("start").setDescription("Mulai game"))
    .addSubcommand((command) => command.setName("status").setDescription("Lihat status game"))
    .addSubcommand((command) => command.setName("stop").setDescription("Batalkan atau tutup game (host saja)"))
    .addSubcommand((command) => command.setName("hint").setDescription("Berikan hint untuk Tebak Kata atau Acak Kata"))
    .addSubcommand((command) =>
      command
        .setName("answer")
        .setDescription("Kirim jawaban atau satu huruf untuk Hangman")
        .addStringOption((option) => option.setName("teks").setDescription("Jawabanmu").setRequired(true)),
    )
    .addSubcommand((command) =>
      command
        .setName("night")
        .setDescription("Kirim aksi malam Werewolf")
        .addUserOption((option) => option.setName("target").setDescription("Pemain target").setRequired(true)),
    )
    .addSubcommand((command) =>
      command
        .setName("vote")
        .setDescription("Berikan vote Werewolf")
        .addUserOption((option) => option.setName("pemain").setDescription("Pemain yang dipilih").setRequired(true)),
    )
    .addSubcommand((command) => command.setName("myrole").setDescription("Kirim ulang role rahasia Werewolf-mu lewat DM")),
  new SlashCommandBuilder()
    .setName("level")
    .setDescription("Cek level dan progress XP kamu (atau pemain lain)")
    .addUserOption((option) => option.setName("pemain").setDescription("Cek level pemain lain (opsional)")),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Lihat papan peringkat level pemain")
    .addStringOption((option) => option.setName("jenis").setDescription("Saring berdasarkan game").addChoices(...gameChoices)),
  new SlashCommandBuilder().setName("help").setDescription("Lihat panduan dan daftar fitur bot"),
  new SlashCommandBuilder().setName("ping").setDescription("Cek status dan respons bot"),
].map((command) => command.toJSON());
