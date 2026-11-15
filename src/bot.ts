import { runInBackground } from "./background.js";
import { peekSession, scheduleTick, withChannel, type ChannelOutcome } from "./channel-state.js";
import { EPHEMERAL, editOriginal, followUp, sendChannelMessage, sendDirectMessage, type Embed, type MessagePayload } from "./discord-api.js";
import { GAME_TYPES, type GameResult, type GameSession, type GameType, type Player, type WerewolfRole } from "./domain/types.js";
import { werewolfRoleSummary } from "./game-service.js";
import { getKV, LockBusyError } from "./kv.js";
import { ProfileStore, levelSummaryText, xpProgress } from "./profile-store.js";
import { buildHelpEmbed, componentsFor, eventEmbed, gameLabel } from "./ui.js";

// ---------------------------------------------------------------------------
// Bentuk payload interaksi Discord (hanya bagian yang dipakai).
// ---------------------------------------------------------------------------

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string };
  member?: { user: DiscordUser };
  user?: DiscordUser;
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    resolved?: { users?: Record<string, DiscordUser> };
  };
}

export interface InteractionResponse {
  type: number;
  data?: MessagePayload;
}

const InteractionType = { Ping: 1, Command: 2, Component: 3 } as const;
const ResponseType = { Pong: 1, Message: 4, Deferred: 5 } as const;

/** Hanya mention pengguna yang diizinkan, agar teks dari pemain tidak bisa memicu @everyone. */
const SAFE_MENTIONS: NonNullable<MessagePayload["allowed_mentions"]> = { parse: ["users"] };

function message(payload: MessagePayload): InteractionResponse {
  return { type: ResponseType.Message, data: { allowed_mentions: SAFE_MENTIONS, ...payload } };
}

function ephemeral(content: string): InteractionResponse {
  return message({ content, flags: EPHEMERAL });
}

function errorResponse(text: string): InteractionResponse {
  return ephemeral(`⚠️ ${text}`);
}

function userOf(interaction: Interaction): DiscordUser {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) throw new Error("Interaksi tanpa pengguna.");
  return user;
}

function playerOf(user: DiscordUser): Player {
  return { id: user.id, displayName: user.global_name ?? user.username };
}

function avatarUrl(user: DiscordUser): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function isGameType(value: unknown): value is GameType {
  return typeof value === "string" && (GAME_TYPES as readonly string[]).includes(value);
}

function profiles(): ProfileStore {
  return new ProfileStore(getKV());
}

// ---------------------------------------------------------------------------
// Efek lanjutan (dijalankan di latar belakang setelah Discord menerima respons).
// ---------------------------------------------------------------------------

interface Publisher {
  post(payload: MessagePayload): Promise<void>;
}

function interactionPublisher(interaction: Interaction): Publisher {
  return { post: (payload) => followUp(interaction.application_id, interaction.token, { allowed_mentions: SAFE_MENTIONS, ...payload }) };
}

export function channelPublisher(channelId: string): Publisher {
  return { post: (payload) => sendChannelMessage(channelId, { allowed_mentions: SAFE_MENTIONS, ...payload }) };
}

function eventPayload(session: GameSession | undefined, text: string): MessagePayload {
  return { embeds: [eventEmbed(session, text)], components: componentsFor(session) };
}

async function deliverDirectMessages(results: readonly GameResult[]): Promise<void> {
  for (const result of results) {
    if (!result.ok) continue;
    for (const event of result.events) {
      for (const dm of event.directMessages ?? []) await sendDirectMessage(dm.userId, dm.text);
    }
  }
}

async function announcePointAwards(publisher: Publisher, session: GameSession | undefined, results: readonly GameResult[]): Promise<void> {
  const aggregate = new Map<string, number>();
  for (const result of results) {
    if (!result.ok) continue;
    for (const event of result.events) {
      for (const award of event.pointAwards ?? []) aggregate.set(award.userId, (aggregate.get(award.userId) ?? 0) + award.amount);
    }
  }
  if (aggregate.size === 0) return;

  const store = profiles();
  const lines: string[] = [];
  for (const [userId, amount] of aggregate) {
    const displayName = session?.players.find((player) => player.id === userId)?.displayName ?? "Pemain";
    const { profile, leveledUp, previousLevel } = await store.addPoints({ id: userId, displayName }, amount);
    const newLevel = xpProgress(profile.xp).level;
    const prefix = leveledUp ? `🎉 **NAIK LEVEL!** (${previousLevel} ➜ ${newLevel})` : "⭐ +poin";
    lines.push(`${prefix} <@${userId}> +${amount} XP — ${levelSummaryText(profile.xp)}`);
  }
  await publisher.post({ embeds: [{ color: 0xf1c40f, title: "📈 Progress Pemain", description: lines.join("\n") }] });
}

/**
 * Semua efek setelah sebuah aksi: DM, pesan lanjutan, statistik, XP, dan penjadwalan timer.
 * `extraPosts` adalah pesan tambahan dari aksi pengguna (event ke-2 dst.).
 */
export async function applyEffects(
  publisher: Publisher,
  channelId: string,
  outcome: ChannelOutcome<unknown>,
  actionResults: readonly GameResult[],
  extraPosts: readonly MessagePayload[] = [],
): Promise<void> {
  const results = [...outcome.autoResults, ...actionResults];
  await deliverDirectMessages(results);
  for (const auto of outcome.autoResults) {
    if (!auto.ok) continue;
    for (const event of auto.events) await publisher.post(eventPayload(outcome.session, event.text));
  }
  for (const post of extraPosts) await publisher.post(post);
  if (outcome.finishedSession) {
    try {
      await profiles().recordFinishedGame(outcome.finishedSession);
    } catch (error) {
      console.error("Gagal menyimpan statistik game:", error);
    }
  }
  await announcePointAwards(publisher, outcome.session, results);
  if (outcome.newTimer) await scheduleTick(channelId, outcome.newTimer);
}

/** Balas interaksi dengan event pertama; event lain, DM, XP, dsb. menyusul di latar belakang. */
function respondWithResult(interaction: Interaction, channelId: string, outcome: ChannelOutcome<GameResult>): InteractionResponse {
  const result = outcome.value;
  const publisher = interactionPublisher(interaction);
  if (!result.ok) {
    if (outcome.autoResults.length > 0 || outcome.newTimer || outcome.finishedSession) {
      runInBackground(() => applyEffects(publisher, channelId, outcome, []));
    }
    return errorResponse(result.error);
  }
  const [first, ...rest] = result.events;
  const extra = rest.map((event) => eventPayload(outcome.session, event.text));
  runInBackground(() => applyEffects(publisher, channelId, outcome, [result], extra));
  if (!first) return ephemeral("Aksi selesai.");
  return message(eventPayload(outcome.session, first.text));
}

// ---------------------------------------------------------------------------
// Werewolf: DM role dikirim ke SEMUA pemain dulu, baru sesi dimulai.
// ---------------------------------------------------------------------------

function roleDmText(session: GameSession, role: WerewolfRole | undefined): string {
  return `🎭 Role rahasiamu di **Werewolf** (server: sesi di <#${session.channelId}>):\n**${role ? werewolfRoleSummary(role) : "Villager"}**\n\nJaga kerahasiaan role-mu! Gunakan \`/game myrole\` kapan saja bila perlu mengirim ulang pesan ini.`;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function startWerewolfSafely(interaction: Interaction, channelId: string, actor: Player): Promise<void> {
  const reply = (payload: MessagePayload): Promise<void> => editOriginal(interaction.application_id, interaction.token, { allowed_mentions: SAFE_MENTIONS, ...payload });

  const prepared = await withChannel(channelId, (games) => {
    const roles = games.prepareWerewolfStart(channelId, actor.id);
    const session = games.findByChannel(channelId);
    return roles.ok && session ? { ok: true as const, roles: roles.roles, session: structuredClone(session) } : { ok: false as const, error: roles.ok ? "Sesi tidak ditemukan." : roles.error };
  });
  if (!prepared.value.ok) {
    await reply({ content: `⚠️ ${prepared.value.error}` });
    return;
  }
  const { roles, session } = prepared.value;

  const failed: string[] = [];
  for (const player of session.players) {
    if (!(await sendDirectMessage(player.id, roleDmText(session, roles[player.id])))) failed.push(`<@${player.id}>`);
  }
  if (failed.length > 0) {
    await reply({
      content: `⚠️ Game belum dimulai karena role gagal terkirim lewat DM ke: ${failed.join(", ")}. Minta mereka mengaktifkan "Izinkan pesan langsung dari anggota server" di pengaturan privasi server, lalu jalankan /game start lagi.`,
    });
    return;
  }

  const committed = await withChannel(channelId, (games): GameResult => {
    const current = games.findByChannel(channelId);
    if (!current || !sameIds(current.players.map(({ id }) => id), Object.keys(roles))) {
      return { ok: false, error: "Susunan pemain di lobby berubah saat role sedang dikirim. Jalankan /game start lagi." };
    }
    return games.commitWerewolfStart(channelId, roles);
  });
  const result = committed.value;
  if (!result.ok) {
    await reply({ content: `⚠️ ${result.error}` });
    return;
  }
  const [first, ...rest] = result.events;
  await reply(eventPayload(committed.session, first?.text ?? "Game dimulai."));
  await applyEffects(
    interactionPublisher(interaction),
    channelId,
    committed,
    [result],
    rest.map((event) => eventPayload(committed.session, event.text)),
  );
}

/** /game start dan tombol Mulai. Werewolf memakai respons tertunda karena perlu mengirim banyak DM. */
async function handleStart(interaction: Interaction, channelId: string, actor: Player): Promise<InteractionResponse> {
  const session = await peekSession(channelId);
  if (session?.gameType === "werewolf" && session.phase === "lobby") {
    if (session.hostId !== actor.id) return errorResponse("Hanya host yang dapat memulai game.");
    runInBackground(() =>
      startWerewolfSafely(interaction, channelId, actor).catch(async (error: unknown) => {
        const text = error instanceof LockBusyError ? error.message : "Terjadi kesalahan saat memulai Werewolf. Coba /game start lagi.";
        await editOriginal(interaction.application_id, interaction.token, { content: `⚠️ ${text}` });
        throw error;
      }),
    );
    return { type: ResponseType.Deferred };
  }
  return respondWithResult(interaction, channelId, await withChannel(channelId, (games) => games.start(channelId, actor.id)));
}

// ---------------------------------------------------------------------------
// Slash command & tombol
// ---------------------------------------------------------------------------

function optionValue(options: readonly CommandOption[] | undefined, name: string): string | undefined {
  const value = options?.find((option) => option.name === name)?.value;
  return value === undefined ? undefined : String(value);
}

async function handleGameCommand(interaction: Interaction, channelId: string): Promise<InteractionResponse> {
  if (!interaction.guild_id) return errorResponse("Gunakan perintah ini di dalam server Discord.");
  const sub = interaction.data?.options?.[0];
  const options = sub?.options;
  const actor = playerOf(userOf(interaction));
  const run = async (action: Parameters<typeof withChannel<GameResult>>[1]): Promise<InteractionResponse> =>
    respondWithResult(interaction, channelId, await withChannel(channelId, action));

  switch (sub?.name) {
    case "create": {
      const gameType = optionValue(options, "jenis");
      if (!isGameType(gameType)) return errorResponse("Pilihan game tidak valid.");
      const guildId = interaction.guild_id;
      return run((games) => games.create({ guildId, channelId, host: actor, gameType }));
    }
    case "join":
      return run((games) => games.join(channelId, actor));
    case "leave":
      return run((games) => games.leave(channelId, actor.id));
    case "status":
      return run((games) => games.status(channelId));
    case "stop":
      return run((games) => games.stop(channelId, actor.id));
    case "start":
      return handleStart(interaction, channelId, actor);
    case "hint":
      return run((games) => games.revealHint(channelId, actor.id));
    case "answer":
      return run((games) => games.submitTextAnswer(channelId, actor.id, optionValue(options, "teks") ?? ""));
    case "vote":
      return run((games) => games.submitVote(channelId, actor.id, optionValue(options, "pemain") ?? ""));
    case "night": {
      const targetId = optionValue(options, "target") ?? "";
      const outcome = await withChannel(channelId, (games) => {
        const saved = games.submitNightAction(channelId, actor.id, targetId);
        if (!saved.ok || !games.isNightReadyToResolve(channelId)) return { saved, resolved: undefined };
        // Semua aksi malam sudah masuk → malam langsung diselesaikan tanpa menunggu timer.
        const session = games.findByChannel(channelId);
        return { saved, resolved: session ? games.resolveNight(channelId, session.hostId) : undefined };
      });
      const { saved, resolved } = outcome.value;
      const publisher = interactionPublisher(interaction);
      const results = resolved?.ok ? [resolved] : [];
      const posts = results.flatMap((result) => (result.ok ? result.events.map((event) => eventPayload(outcome.session, event.text)) : []));
      runInBackground(() => applyEffects(publisher, channelId, outcome, results, posts));
      if (!saved.ok) return errorResponse(saved.error);
      return ephemeral("🌙 Aksi malammu sudah disimpan secara rahasia.");
    }
    case "myrole": {
      const session = await peekSession(channelId);
      if (!session || session.data.kind !== "werewolf" || session.phase === "lobby") {
        return errorResponse("Tidak ada sesi Werewolf yang sedang berjalan di channel ini.");
      }
      if (!session.players.some((player) => player.id === actor.id)) return errorResponse("Kamu bukan pemain dalam sesi ini.");
      const role = session.data.roles[actor.id];
      runInBackground(async () => {
        const sent = await sendDirectMessage(actor.id, `🎭 Role rahasiamu di **Werewolf**: **${role ? werewolfRoleSummary(role) : "Villager"}**`);
        await editOriginal(interaction.application_id, interaction.token, {
          content: sent ? "✅ Role sudah dikirim ulang lewat DM." : '⚠️ Gagal mengirim DM. Aktifkan "Izinkan pesan langsung dari anggota server" lalu coba lagi.',
        });
      });
      return { type: ResponseType.Deferred, data: { flags: EPHEMERAL } };
    }
    default:
      return errorResponse("Subcommand tidak dikenal.");
  }
}

async function handleButton(interaction: Interaction, channelId: string): Promise<InteractionResponse> {
  if (!interaction.guild_id) return errorResponse("Tombol ini hanya dapat digunakan di channel server.");
  const actor = playerOf(userOf(interaction));
  const [prefix, action, choice] = (interaction.data?.custom_id ?? "").split(":");
  if (prefix !== "game") return errorResponse("Tombol tidak dikenal.");
  const run = async (fn: Parameters<typeof withChannel<GameResult>>[1]): Promise<InteractionResponse> =>
    respondWithResult(interaction, channelId, await withChannel(channelId, fn));

  switch (action) {
    case "join":
      return run((games) => games.join(channelId, actor));
    case "leave":
      return run((games) => games.leave(channelId, actor.id));
    case "start":
      return handleStart(interaction, channelId, actor);
    case "hint":
      return run((games) => games.revealHint(channelId, actor.id));
    case "trivia":
      return run((games) => games.submitTriviaAnswer(channelId, actor.id, Number(choice)));
    default:
      return errorResponse("Tombol tidak dikenal.");
  }
}

async function handleLevel(interaction: Interaction): Promise<InteractionResponse> {
  const targetId = optionValue(interaction.data?.options, "pemain");
  const targetUser = (targetId && interaction.data?.resolved?.users?.[targetId]) || userOf(interaction);
  const target = playerOf(targetUser);
  const store = profiles();
  const [profile, rank] = await Promise.all([store.getProfile(target), store.rank(target)]);
  const byGameLines = Object.entries(profile.byGame)
    .filter(([, stat]) => (stat?.played ?? 0) > 0)
    .map(([type, stat]) => `${gameLabel(type as GameType)}: ${stat?.wins ?? 0}/${stat?.played ?? 0} menang`)
    .join("\n");
  const embed: Embed = {
    color: 0x5865f2,
    title: `📈 Level ${target.displayName}`,
    thumbnail: { url: avatarUrl(targetUser) },
    description: levelSummaryText(profile.xp),
    fields: [
      { name: "Total XP", value: `${profile.xp}`, inline: true },
      { name: "Menang / Main", value: `${profile.wins}/${profile.gamesPlayed}`, inline: true },
      { name: "Peringkat", value: rank ? `#${rank}` : "Belum masuk peringkat", inline: true },
    ],
  };
  if (byGameLines) embed.fields?.push({ name: "Rincian per game", value: byGameLines });
  if (xpProgress(profile.xp).isMaxLevel) embed.footer = { text: "Level maksimum tercapai! ✨" };
  return message({ embeds: [embed] });
}

async function handleLeaderboard(interaction: Interaction): Promise<InteractionResponse> {
  const value = optionValue(interaction.data?.options, "jenis");
  const gameType = isGameType(value) ? value : undefined;
  const rows = await profiles().leaderboard(gameType);
  const title = gameType ? `Leaderboard ${gameLabel(gameType)}` : "Leaderboard Semua Game";
  const description =
    rows.length === 0
      ? "Belum ada statistik permainan."
      : rows
          .map((profile, index) => `**${index + 1}. ${profile.displayName}** — ${levelSummaryText(profile.xp)}\n${profile.wins}/${profile.gamesPlayed} menang · ${profile.xp} XP total`)
          .join("\n\n");
  return message({ embeds: [{ color: 0xf1c40f, title: `🏆 ${title}`, description }] });
}

function handlePing(interaction: Interaction): InteractionResponse {
  const createdAt = Number((BigInt(interaction.id) >> 22n) + 1420070400000n);
  const latency = Math.max(0, Date.now() - createdAt);
  return message({ content: `🏓 Pong! Bot berjalan di Vercel. Waktu respons: **${latency} ms**.` });
}

export async function handleInteraction(interaction: Interaction): Promise<InteractionResponse> {
  if (interaction.type === InteractionType.Ping) return { type: ResponseType.Pong };
  const channelId = interaction.channel_id ?? interaction.channel?.id ?? "";
  try {
    if (interaction.type === InteractionType.Command) {
      switch (interaction.data?.name) {
        case "game":
          return await handleGameCommand(interaction, channelId);
        case "help":
          return message({ embeds: [buildHelpEmbed()] });
        case "ping":
          return handlePing(interaction);
        case "level":
          return await handleLevel(interaction);
        case "leaderboard":
          return await handleLeaderboard(interaction);
        default:
          return errorResponse("Perintah tidak dikenal.");
      }
    }
    if (interaction.type === InteractionType.Component) return await handleButton(interaction, channelId);
    return errorResponse("Jenis interaksi tidak didukung.");
  } catch (error) {
    if (error instanceof LockBusyError) return errorResponse(error.message);
    console.error("Kesalahan saat menangani interaksi:", error);
    return errorResponse("Terjadi kesalahan tak terduga. Coba ulangi aksinya.");
  }
}

/** Dipanggil oleh /api/tick ketika timer fase Werewolf sudah waktunya. */
export async function runDueTimers(channelId: string): Promise<void> {
  const outcome = await withChannel(channelId, () => null);
  await applyEffects(channelPublisher(channelId), channelId, outcome, []);
}
