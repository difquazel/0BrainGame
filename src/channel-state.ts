import { createHash } from "node:crypto";
import type { GameResult, GameSession } from "./domain/types.js";
import { GameService, type ChannelGameState } from "./game-service.js";
import { getKV, withLock } from "./kv.js";

/**
 * State game per channel disimpan di Redis. Setiap interaksi: kunci channel → muat state →
 * jalankan aksi → simpan → lepas kunci. Timer fase Werewolf juga disimpan di sini (dueAt),
 * dan dijalankan oleh endpoint /api/tick atau, sebagai cadangan, oleh interaksi berikutnya
 * yang datang setelah waktunya lewat.
 */

export type TimerAction = "resolve-night" | "begin-voting" | "resolve-voting" | "next-night";

export interface PhaseTimer {
  action: TimerAction;
  dueAt: number;
  /** Identitas fase saat timer dibuat; timer tidak di-reset selama fase masih sama. */
  phaseKey: string;
}

interface StoredChannel extends ChannelGameState {
  timer?: PhaseTimer;
  recorded?: boolean;
}

export interface ChannelOutcome<T> {
  value: T;
  /** Sesi setelah aksi (undefined bila sesi ditutup). */
  session: GameSession | undefined;
  /** Hasil fase otomatis yang dijalankan karena timernya sudah lewat. */
  autoResults: GameResult[];
  /** Timer baru yang perlu dijadwalkan lewat /api/tick. */
  newTimer?: PhaseTimer;
  /** Sesi yang baru saja selesai dan statistiknya perlu dicatat (sekali saja). */
  finishedSession?: GameSession;
}

/** Sesi yang ditinggal begitu saja otomatis terhapus setelah 2 hari. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 2;
/** Riwayat soal per channel disimpan 30 hari. */
const RECENT_TTL_SECONDS = 60 * 60 * 24 * 30;

const channelKey = (channelId: string): string => `channel:${channelId}`;

async function readStored(channelId: string): Promise<StoredChannel> {
  const raw = await getKV().get(channelKey(channelId));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredChannel;
  } catch {
    console.warn(`State channel ${channelId} rusak; diabaikan.`);
    return {};
  }
}

/** Membaca sesi tanpa mengunci (untuk pengecekan cepat sebelum aksi). */
export async function peekSession(channelId: string): Promise<GameSession | undefined> {
  return (await readStored(channelId)).session;
}

function phaseKey(session: GameSession): string {
  const stage = session.data.kind === "werewolf" ? session.data.dayStage : "";
  return `${session.id}:${session.phase}:${session.round}:${stage}`;
}

/** Durasi tiap fase Werewolf (sama seperti versi sebelumnya). */
export function timerFor(session: GameSession | undefined): { action: TimerAction; delayMs: number } | null {
  if (!session || session.gameType !== "werewolf" || session.data.kind !== "werewolf") return null;
  if (session.phase === "night") return { action: "resolve-night", delayMs: 75_000 };
  if (session.phase === "voting") return { action: "resolve-voting", delayMs: 45_000 };
  if (session.phase === "day" && session.data.dayStage === "after-vote") return { action: "next-night", delayMs: 15_000 };
  if (session.phase === "day") return { action: "begin-voting", delayMs: 90_000 };
  return null;
}

function runTimerAction(games: GameService, channelId: string, action: TimerAction): GameResult {
  const session = games.findByChannel(channelId);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };
  switch (action) {
    case "resolve-night":
      return games.resolveNight(channelId, session.hostId);
    case "begin-voting":
      return games.beginVoting(channelId, session.hostId);
    case "resolve-voting":
      return games.resolveVotingByModerator(channelId, session.hostId);
    case "next-night":
      return games.beginNextNight(channelId, session.hostId);
  }
}

export async function withChannel<T>(channelId: string, action: (games: GameService) => T): Promise<ChannelOutcome<T>> {
  const kv = getKV();
  return withLock(kv, channelKey(channelId), async () => {
    const stored = await readStored(channelId);
    const games = new GameService();
    games.loadChannel(channelId, stored);
    const now = Date.now();

    const autoResults: GameResult[] = [];
    let timer = stored.timer;
    if (timer && timer.dueAt <= now) {
      const result = runTimerAction(games, channelId, timer.action);
      if (result.ok) autoResults.push(result);
      timer = undefined;
    }

    const value = action(games);
    const after = games.exportChannel(channelId);
    const session = after.session;

    let newTimer: PhaseTimer | undefined;
    const wanted = timerFor(session);
    if (!wanted || !session) {
      timer = undefined;
    } else if (!timer || timer.phaseKey !== phaseKey(session) || timer.action !== wanted.action) {
      timer = { action: wanted.action, dueAt: now + wanted.delayMs, phaseKey: phaseKey(session) };
      newTimer = timer;
    }

    let recorded = stored.recorded ?? false;
    let finishedSession: GameSession | undefined;
    if (session?.phase === "finished" && !recorded) {
      recorded = true;
      finishedSession = structuredClone(session);
    }

    if (session) {
      const next: StoredChannel = { ...after };
      if (timer) next.timer = timer;
      if (recorded) next.recorded = true;
      await kv.set(channelKey(channelId), JSON.stringify(next), SESSION_TTL_SECONDS);
    } else if (after.recent) {
      // Sesi ditutup, tapi daftar soal/kata yang baru keluar tetap diingat agar game berikutnya tidak mengulang.
      await kv.set(channelKey(channelId), JSON.stringify({ recent: after.recent }), RECENT_TTL_SECONDS);
    } else {
      await kv.del(channelKey(channelId));
    }

    const outcome: ChannelOutcome<T> = { value, session, autoResults };
    if (newTimer) outcome.newTimer = newTimer;
    if (finishedSession) outcome.finishedSession = finishedSession;
    return outcome;
  });
}

// ---------------------------------------------------------------------------
// Penjadwalan timer: memanggil endpoint /api/tick milik sendiri. Endpoint itu langsung
// membalas 202, lalu menunggu sampai dueAt di latar belakang (waitUntil) dan menjalankan fase.
// ---------------------------------------------------------------------------

export function tickSecret(): string {
  return process.env.TICK_SECRET ?? createHash("sha256").update(`tick:${process.env.DISCORD_TOKEN ?? ""}`).digest("hex");
}

function appUrl(): string | null {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

export async function scheduleTick(channelId: string, timer: PhaseTimer): Promise<void> {
  const base = appUrl();
  if (!base) {
    console.warn("APP_URL tidak diketahui; fase Werewolf akan lanjut saat ada interaksi berikutnya.");
    return;
  }
  try {
    const response = await fetch(`${base}/api/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tick-Secret": tickSecret() },
      body: JSON.stringify({ channelId, dueAt: timer.dueAt }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) console.warn(`Penjadwalan timer gagal (${response.status}).`);
  } catch (error) {
    console.warn("Penjadwalan timer gagal:", error instanceof Error ? error.message : error);
  }
}
