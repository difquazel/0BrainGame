import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commandData } from "./commands.js";
import { GameService, werewolfRoleSummary } from "./game-service.js";
import { GAME_TYPES, type GameResult, type GameSession, type GameType, type Player, type WerewolfRole } from "./domain/types.js";
import { ProfileStore, levelSummaryText, xpProgress } from "./profile-store.js";

const token = process.env.DISCORD_TOKEN ?? "";
if (!token) {
  throw new Error("DISCORD_TOKEN belum diisi. Salin .env.example menjadi .env lalu isi token bot.");
}

const games = new GameService();
// Railway exposes the mount point automatically when a Volume is attached.
// This keeps the leaderboard after a deploy without requiring another variable.
const dataDirectory = process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? "./data";
const profiles = new ProfileStore(dataDirectory);
const recordedSessionIds = new Set<string>();
const automatedTimers = new Map<string, NodeJS.Timeout>();
const BOT_VERSION = "2.0.0";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

type SendableChannel = {
  id: string;
  send: (options: { content?: string; embeds?: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }) => Promise<unknown>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return typeof channel === "object" && channel !== null && "send" in channel && typeof (channel as { send?: unknown }).send === "function";
}

function playerFrom(interaction: ChatInputCommandInteraction | ButtonInteraction): Player {
  return { id: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username };
}

function errorReply(interaction: ChatInputCommandInteraction | ButtonInteraction, message: string): Promise<unknown> {
  if (interaction.isRepliable()) return interaction.reply({ content: `⚠️ ${message}`, ephemeral: true });
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tampilan: embed berwarna sesuai fase, agar terasa lebih hidup & interaktif.
// ---------------------------------------------------------------------------

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

function eventEmbed(session: GameSession | undefined, text: string): EmbedBuilder {
  const title = session ? `${gameEmoji(session.gameType)} ${games.gameLabel(session.gameType)}` : "🎮 Game";
  return new EmbedBuilder().setColor(phaseColor(session)).setTitle(title).setDescription(text);
}

function buildHelpEmbed(): EmbedBuilder {
  const botName = client.user?.username ?? "Game Master";
  const avatarUrl = client.user?.displayAvatarURL();
  const embed = new EmbedBuilder()
    .setColor(0x00aeef)
    .setTitle("📌 Panel Bantuan & Fitur Bot")
    .setDescription("Berikut perintah untuk memainkan game text-based bersama teman di server ini.")
    .addFields(
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
    )
    .setFooter({ text: `${botName} • Versi ${BOT_VERSION} • Gunakan /help kapan saja` })
    .setTimestamp();
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

function componentsFor(session: GameSession | undefined): ActionRowBuilder<ButtonBuilder>[] {
  if (!session || session.phase === "finished") return [];
  if (session.phase === "lobby") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("game:join").setLabel("Gabung").setEmoji("🙋").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("game:leave").setLabel("Keluar").setEmoji("🚪").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("game:start").setLabel("Mulai").setEmoji("▶️").setStyle(ButtonStyle.Primary),
      ),
    ];
  }
  if (session.data.kind === "trivia" && session.phase === "playing") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...session.data.choices.map((choice, index) =>
          new ButtonBuilder().setCustomId(`game:trivia:${index}`).setLabel(`${String.fromCharCode(65 + index)}. ${choice}`).setStyle(ButtonStyle.Secondary),
        ),
      ),
    ];
  }
  if ((session.data.kind === "guess-word" || session.data.kind === "word-scramble") && session.phase === "playing") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("game:hint").setLabel("Minta hint").setEmoji("💡").setStyle(ButtonStyle.Secondary))];
  }
  // Fase Werewolf lain (night/day/voting) tidak lagi punya tombol kontrol manual —
  // hanya bot AI yang memoderasi jalannya fase tersebut.
  return [];
}

async function deliverDirectMessages(result: GameResult): Promise<void> {
  if (!result.ok) return;
  for (const event of result.events) {
    for (const message of event.directMessages ?? []) {
      try {
        const user = await client.users.fetch(message.userId);
        await user.send(message.text);
      } catch {
        console.warn(`DM untuk user ${message.userId} gagal dikirim.`);
      }
    }
  }
}

async function recordIfFinished(channelId: string): Promise<void> {
  const session = games.findByChannel(channelId);
  if (!session || session.phase !== "finished" || recordedSessionIds.has(session.id)) return;
  recordedSessionIds.add(session.id);
  try {
    await profiles.recordFinishedGame(session);
  } catch (error) {
    recordedSessionIds.delete(session.id);
    console.error("Gagal menyimpan statistik game:", error);
  }
}

/** Memproses pointAwards dari sebuah hasil aksi: menambah XP, lalu mengumumkan progress/level-up. */
async function announcePointAwards(channelId: string, result: GameResult): Promise<void> {
  if (!result.ok) return;
  const aggregate = new Map<string, number>();
  for (const event of result.events) {
    for (const award of event.pointAwards ?? []) {
      aggregate.set(award.userId, (aggregate.get(award.userId) ?? 0) + award.amount);
    }
  }
  if (aggregate.size === 0) return;

  const session = games.findByChannel(channelId);
  const lines: string[] = [];
  for (const [userId, amount] of aggregate) {
    const displayName = session?.players.find((player) => player.id === userId)?.displayName ?? "Pemain";
    const { profile, leveledUp, previousLevel } = await profiles.addPoints({ id: userId, displayName }, amount);
    const summary = levelSummaryText(profile.xp);
    const newLevel = xpProgress(profile.xp).level;
    const prefix = leveledUp ? `🎉 **NAIK LEVEL!** (${previousLevel} ➜ ${newLevel})` : "⭐ +poin";
    lines.push(`${prefix} <@${userId}> +${amount} XP — ${summary}`);
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("📈 Progress Pemain").setDescription(lines.join("\n"));
  await channel.send({ embeds: [embed], components: [] });
}

async function sendResult(channel: SendableChannel, result: GameResult): Promise<void> {
  if (!result.ok) return;
  await deliverDirectMessages(result);
  const session = games.findByChannel(channel.id);
  for (const event of result.events) {
    await channel.send({ embeds: [eventEmbed(session, event.text)], components: componentsFor(session) });
  }
  await recordIfFinished(channel.id);
  await announcePointAwards(channel.id, result);
}

async function replyWithResult(interaction: ChatInputCommandInteraction, result: GameResult): Promise<void> {
  if (!result.ok) {
    await errorReply(interaction, result.error);
    return;
  }
  await deliverDirectMessages(result);
  const [first, ...rest] = result.events;
  if (!first) {
    await interaction.reply({ content: "Aksi selesai.", ephemeral: true });
    return;
  }
  const session = games.findByChannel(interaction.channelId);
  await interaction.reply({ embeds: [eventEmbed(session, first.text)], components: componentsFor(session) });
  for (const event of rest) {
    await interaction.followUp({ embeds: [eventEmbed(session, event.text)], components: componentsFor(session) });
  }
  await recordIfFinished(interaction.channelId);
  await announcePointAwards(interaction.channelId, result);
}

// ---------------------------------------------------------------------------
// Werewolf: pengiriman DM role yang aman (dicoba dahulu, baru sesi dimulai).
// Ini memperbaiki bug lama di mana sesi bisa "terlanjur" dimulai walau DM
// role gagal terkirim ke sebagian pemain.
// ---------------------------------------------------------------------------

async function tryDm(userId: string, text: string, attempts = 2): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(text);
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 400));
      }
    }
  }
  return false;
}

async function sendWerewolfRoleDms(session: GameSession, roles: Record<string, WerewolfRole>): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const player of session.players) {
    const role = roles[player.id];
    const text = `🎭 Role rahasiamu di **Werewolf** (server: sesi di <#${session.channelId}>):\n**${role ? werewolfRoleSummary(role) : "Villager"}**\n\nJaga kerahasiaan role-mu! Gunakan \`/game myrole\` kapan saja bila perlu mengirim ulang pesan ini.`;
    const sent = await tryDm(player.id, text);
    if (!sent) failed.push(`<@${player.id}>`);
  }
  return { failed };
}

/**
 * Alur mulai Werewolf yang aman: hitung role → kirim semua DM role secara nyata →
 * baru commit state sesi bila SEMUA DM berhasil. Bila ada yang gagal, sesi tidak
 * berubah sama sekali dan host mendapat daftar jelas siapa yang perlu membuka DM-nya.
 * Karena role sudah dihitung dari roster yang sama, percobaan ulang tidak akan
 * mengacak ulang role pemain yang sudah menerimanya.
 */
async function startWerewolfSafely(channelId: string, actorId: string): Promise<GameResult> {
  const prepared = games.prepareWerewolfStart(channelId, actorId);
  if (!prepared.ok) return prepared;
  const session = games.findByChannel(channelId);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };
  const { failed } = await sendWerewolfRoleDms(session, prepared.roles);
  if (failed.length > 0) {
    return {
      ok: false,
      error: `Game belum dimulai karena role gagal terkirim lewat DM ke: ${failed.join(", ")}. Minta mereka mengaktifkan "Izinkan pesan langsung dari anggota server" di pengaturan privasi server, lalu jalankan /game start lagi.`,
    };
  }
  return games.commitWerewolfStart(channelId, prepared.roles);
}

function clearAutomatedTimer(channelId: string): void {
  const timer = automatedTimers.get(channelId);
  if (timer) clearTimeout(timer);
  automatedTimers.delete(channelId);
}

function scheduleAiWerewolf(channelId: string): void {
  clearAutomatedTimer(channelId);
  const session = games.findByChannel(channelId);
  if (!session || session.gameType !== "werewolf" || session.phase === "finished") return;

  let delayMs: number;
  let action: "resolve-night" | "begin-voting" | "resolve-voting" | "next-night";
  if (session.phase === "night") {
    delayMs = 75_000;
    action = "resolve-night";
  } else if (session.phase === "voting") {
    delayMs = 45_000;
    action = "resolve-voting";
  } else if (session.phase === "day" && session.data.kind === "werewolf" && session.data.dayStage === "after-vote") {
    delayMs = 15_000;
    action = "next-night";
  } else if (session.phase === "day") {
    delayMs = 90_000;
    action = "begin-voting";
  } else {
    return;
  }

  const timer = setTimeout(() => {
    void runAutomatedAction(channelId, action);
  }, delayMs);
  automatedTimers.set(channelId, timer);
}

async function runAutomatedAction(channelId: string, action: "resolve-night" | "begin-voting" | "resolve-voting" | "next-night"): Promise<void> {
  const session = games.findByChannel(channelId);
  if (!session) return;
  const result =
    action === "resolve-night"
      ? games.resolveNight(channelId, session.hostId)
      : action === "begin-voting"
        ? games.beginVoting(channelId, session.hostId)
        : action === "resolve-voting"
          ? games.resolveVotingByModerator(channelId, session.hostId)
          : games.beginNextNight(channelId, session.hostId);
  if (!result.ok) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased() && isSendableChannel(channel)) await sendResult(channel, result);
  scheduleAiWerewolf(channelId);
}

/** Dipanggil setiap kali ada aksi malam masuk: begitu semua aksi yang dibutuhkan sudah
 * terkumpul, bot langsung menyelesaikan malam tanpa menunggu timer penuh — lebih interaktif. */
async function maybeAutoResolveNight(channelId: string): Promise<void> {
  if (!games.isNightReadyToResolve(channelId)) return;
  const session = games.findByChannel(channelId);
  if (!session) return;
  clearAutomatedTimer(channelId);
  const result = games.resolveNight(channelId, session.hostId);
  if (!result.ok) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased() && isSendableChannel(channel)) await sendResult(channel, result);
  scheduleAiWerewolf(channelId);
}

function isGameType(value: string): value is GameType {
  return (GAME_TYPES as readonly string[]).includes(value);
}

async function handleGameCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await errorReply(interaction, "Gunakan perintah ini di dalam server Discord.");
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  const actor = playerFrom(interaction);

  if (subcommand === "create") {
    const gameTypeValue = interaction.options.getString("jenis", true);
    if (!isGameType(gameTypeValue)) {
      await errorReply(interaction, "Pilihan game tidak valid.");
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await errorReply(interaction, "Server Discord tidak dapat dikenali.");
      return;
    }
    const result = games.create({ guildId, channelId: interaction.channelId, host: actor, gameType: gameTypeValue });
    await replyWithResult(interaction, result);
    return;
  }

  if (subcommand === "join") {
    await replyWithResult(interaction, games.join(interaction.channelId, actor));
    return;
  }
  if (subcommand === "leave") {
    await replyWithResult(interaction, games.leave(interaction.channelId, actor.id));
    return;
  }
  if (subcommand === "status") {
    await replyWithResult(interaction, games.status(interaction.channelId));
    return;
  }
  if (subcommand === "stop") {
    const result = games.stop(interaction.channelId, actor.id);
    if (result.ok) clearAutomatedTimer(interaction.channelId);
    await replyWithResult(interaction, result);
    return;
  }
  if (subcommand === "start") {
    const session = games.findByChannel(interaction.channelId);
    if (session?.gameType === "werewolf" && session.phase === "lobby") {
      if (!games.canControl(session, actor.id)) {
        await errorReply(interaction, "Hanya host yang dapat memulai game.");
        return;
      }
      await interaction.deferReply();
      const result = await startWerewolfSafely(interaction.channelId, actor.id);
      if (!result.ok) {
        await interaction.editReply({ content: `⚠️ ${result.error}` });
        return;
      }
      const committedSession = games.findByChannel(interaction.channelId);
      const first = result.events[0];
      await interaction.editReply({ embeds: [eventEmbed(committedSession, first?.text ?? "Game dimulai.")], components: componentsFor(committedSession) });
      await recordIfFinished(interaction.channelId);
      await announcePointAwards(interaction.channelId, result);
      scheduleAiWerewolf(interaction.channelId);
      return;
    }
    const result = games.start(interaction.channelId, actor.id);
    await replyWithResult(interaction, result);
    if (result.ok) scheduleAiWerewolf(interaction.channelId);
    return;
  }
  if (subcommand === "hint") {
    await replyWithResult(interaction, games.revealHint(interaction.channelId, actor.id));
    return;
  }
  if (subcommand === "answer") {
    await replyWithResult(interaction, games.submitTextAnswer(interaction.channelId, actor.id, interaction.options.getString("teks", true)));
    return;
  }
  if (subcommand === "night") {
    const result = games.submitNightAction(interaction.channelId, actor.id, interaction.options.getUser("target", true).id);
    if (!result.ok) {
      await errorReply(interaction, result.error);
      return;
    }
    await interaction.reply({ content: "🌙 Aksi malammu sudah disimpan secara rahasia.", ephemeral: true });
    await maybeAutoResolveNight(interaction.channelId);
    return;
  }
  if (subcommand === "vote") {
    const result = games.submitVote(interaction.channelId, actor.id, interaction.options.getUser("pemain", true).id);
    await replyWithResult(interaction, result);
    if (result.ok) scheduleAiWerewolf(interaction.channelId);
    return;
  }
  if (subcommand === "myrole") {
    const session = games.findByChannel(interaction.channelId);
    if (!session || session.gameType !== "werewolf" || session.data.kind !== "werewolf" || session.phase === "lobby") {
      await errorReply(interaction, "Tidak ada sesi Werewolf yang sedang berjalan di channel ini.");
      return;
    }
    if (!session.players.some((player) => player.id === actor.id)) {
      await errorReply(interaction, "Kamu bukan pemain dalam sesi ini.");
      return;
    }
    const role = session.data.roles[actor.id];
    const text = `🎭 Role rahasiamu di **Werewolf**: **${role ? werewolfRoleSummary(role) : "Villager"}**`;
    const sent = await tryDm(actor.id, text);
    await interaction.reply({
      content: sent ? "✅ Role sudah dikirim ulang lewat DM." : "⚠️ Gagal mengirim DM. Aktifkan \"Izinkan pesan langsung dari anggota server\" lalu coba lagi.",
      ephemeral: true,
    });
    return;
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!interaction.inGuild() || !channel?.isTextBased() || !isSendableChannel(channel)) {
    await errorReply(interaction, "Tombol ini hanya dapat digunakan di channel server.");
    return;
  }
  const actor = playerFrom(interaction);
  const [prefix, action, choice] = interaction.customId.split(":");
  if (prefix !== "game" || !action) return;

  if (action === "start") {
    const session = games.findByChannel(interaction.channelId);
    if (session?.gameType === "werewolf" && session.phase === "lobby") {
      if (!games.canControl(session, actor.id)) {
        await errorReply(interaction, "Hanya host yang dapat memulai game.");
        return;
      }
      await interaction.deferUpdate();
      const result = await startWerewolfSafely(interaction.channelId, actor.id);
      if (!result.ok) {
        await interaction.followUp({ content: `⚠️ ${result.error}`, ephemeral: true });
        return;
      }
      const committedSession = games.findByChannel(interaction.channelId);
      const first = result.events[0];
      await interaction.editReply({ embeds: [eventEmbed(committedSession, first?.text ?? "Game dimulai.")], components: componentsFor(committedSession) });
      await recordIfFinished(interaction.channelId);
      await announcePointAwards(interaction.channelId, result);
      scheduleAiWerewolf(interaction.channelId);
      return;
    }
  }

  let result: GameResult;
  switch (action) {
    case "join":
      result = games.join(interaction.channelId, actor);
      break;
    case "leave":
      result = games.leave(interaction.channelId, actor.id);
      break;
    case "start":
      result = games.start(interaction.channelId, actor.id);
      break;
    case "hint":
      result = games.revealHint(interaction.channelId, actor.id);
      break;
    case "trivia":
      result = games.submitTriviaAnswer(interaction.channelId, actor.id, Number(choice));
      break;
    default:
      return;
  }
  if (!result.ok) {
    await errorReply(interaction, result.error);
    return;
  }
  await interaction.deferUpdate();
  await sendResult(channel, result);
  scheduleAiWerewolf(interaction.channelId);
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const applicationId = client.user?.id;
  if (!applicationId) throw new Error("ID aplikasi Discord tidak tersedia setelah login.");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commandData });
    console.log(`Slash command didaftarkan ke server pengembangan ${guildId}.`);
    return;
  }
  await rest.put(Routes.applicationCommands(applicationId), { body: commandData });
  console.log("Slash command global didaftarkan. Discord dapat membutuhkan waktu hingga satu jam untuk menampilkannya.");
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot aktif sebagai ${readyClient.user.tag} (v${BOT_VERSION}).`);
  try {
    await profiles.load();
    await registerCommands();
  } catch (error) {
    console.error("Gagal menyiapkan bot:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "game") await handleGameCommand(interaction);
      if (interaction.commandName === "help") {
        await interaction.reply({ embeds: [buildHelpEmbed()] });
      }
      if (interaction.commandName === "ping") {
        await interaction.reply({ content: `🏓 Pong! Respons Gateway: **${Math.max(0, Math.round(client.ws.ping))} ms**.` });
      }
      if (interaction.commandName === "level") {
        const targetUser = interaction.options.getUser("pemain") ?? interaction.user;
        const targetPlayer: Player = { id: targetUser.id, displayName: targetUser.globalName ?? targetUser.username };
        const profile = await profiles.getProfile(targetPlayer);
        const rank = await profiles.rank(targetPlayer);
        const progress = xpProgress(profile.xp);
        const byGameLines = Object.entries(profile.byGame)
          .filter(([, stat]) => (stat?.played ?? 0) > 0)
          .map(([type, stat]) => `${games.gameLabel(type as GameType)}: ${stat?.wins ?? 0}/${stat?.played ?? 0} menang`)
          .join("\n");
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`📈 Level ${targetPlayer.displayName}`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setDescription(levelSummaryText(profile.xp))
          .addFields(
            { name: "Total XP", value: `${profile.xp}`, inline: true },
            { name: "Menang / Main", value: `${profile.wins}/${profile.gamesPlayed}`, inline: true },
            { name: "Peringkat", value: rank ? `#${rank}` : "Belum masuk peringkat", inline: true },
          );
        if (byGameLines) embed.addFields({ name: "Rincian per game", value: byGameLines });
        if (progress.isMaxLevel) embed.setFooter({ text: "Level maksimum tercapai! ✨" });
        await interaction.reply({ embeds: [embed] });
      }
      if (interaction.commandName === "leaderboard") {
        const gameTypeValue = interaction.options.getString("jenis");
        const gameType = gameTypeValue && isGameType(gameTypeValue) ? gameTypeValue : undefined;
        const rows = await profiles.leaderboard(gameType);
        const title = gameType ? `Leaderboard ${games.gameLabel(gameType)}` : "Leaderboard Semua Game";
        const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 ${title}`);
        if (rows.length === 0) {
          embed.setDescription("Belum ada statistik permainan.");
        } else {
          embed.setDescription(
            rows
              .map((profile, index) => `**${index + 1}. ${profile.displayName}** — ${levelSummaryText(profile.xp)}\n${profile.wins}/${profile.gamesPlayed} menang · ${profile.xp} XP total`)
              .join("\n\n"),
          );
        }
        await interaction.reply({ embeds: [embed] });
      }
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error("Kesalahan saat menangani interaksi:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "⚠️ Terjadi kesalahan tak terduga. Coba ulangi aksinya.", ephemeral: true });
    }
  }
});

client.on(Events.Error, (error) => console.error("Discord client error:", error));
client.login(token);
