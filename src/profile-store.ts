import type { GameSession, GameType, Player } from "./domain/types.js";
import { withLock, type KV } from "./kv.js";

export const MAX_LEVEL = 99;
export const XP_PER_LEVEL = 10;

export interface Profile {
  id: string;
  displayName: string;
  gamesPlayed: number;
  wins: number;
  xp: number;
  byGame: Partial<Record<GameType, { played: number; wins: number }>>;
}

export interface LevelProgress {
  level: number;
  intoLevel: number;
  needed: number;
  isMaxLevel: boolean;
}

/** Level 1 dimulai dari 0 XP; setiap XP_PER_LEVEL poin XP menaikkan satu level, dibatasi di MAX_LEVEL. */
export function levelForXp(xp: number): number {
  const rawLevel = Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
  return Math.min(MAX_LEVEL, rawLevel);
}

export function xpProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const isMaxLevel = level >= MAX_LEVEL;
  const intoLevel = isMaxLevel ? XP_PER_LEVEL : Math.max(0, xp) % XP_PER_LEVEL;
  return { level, intoLevel, needed: XP_PER_LEVEL, isMaxLevel };
}

/** Bar progres berbasis emoji, mis. 🟩🟩🟩⬜⬜⬜⬜⬜⬜⬜ */
export function progressBar(intoLevel: number, needed: number, length = 10): string {
  const ratio = needed > 0 ? Math.min(1, Math.max(0, intoLevel / needed)) : 1;
  const filled = Math.round(ratio * length);
  return "🟩".repeat(filled) + "⬜".repeat(Math.max(0, length - filled));
}

export function levelSummaryText(xp: number): string {
  const progress = xpProgress(xp);
  const bar = progressBar(progress.intoLevel, progress.needed);
  if (progress.isMaxLevel) return `Level **99 (MAX)** ${bar} ✨`;
  return `Level **${progress.level}** ${bar} ${progress.intoLevel}/${progress.needed} XP`;
}

const PROFILES_KEY = "profiles";

function emptyProfile(player: Player): Profile {
  return { id: player.id, displayName: player.displayName, gamesPlayed: 0, wins: 0, xp: 0, byGame: {} };
}

function parseProfile(raw: string | null | undefined): Profile | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

function byRanking(left: Profile, right: Profile): number {
  return right.xp - left.xp || right.wins - left.wins || left.displayName.localeCompare(right.displayName);
}

/** Statistik pemain disimpan di Redis (hash "profiles": userId → JSON profil). */
export class ProfileStore {
  public constructor(private readonly kv: KV) {}

  private async all(): Promise<Profile[]> {
    const raw = await this.kv.hgetall(PROFILES_KEY);
    return Object.values(raw)
      .map((value) => parseProfile(value))
      .filter((profile): profile is Profile => profile !== null);
  }

  /** Mencatat statistik menang/main per sesi game yang selesai (tidak mengubah XP; XP diberikan real-time lewat addPoints). */
  public async recordFinishedGame(session: GameSession): Promise<void> {
    await withLock(this.kv, PROFILES_KEY, async () => {
      const updates: Record<string, string> = {};
      for (const player of session.players) {
        const profile = parseProfile(await this.kv.hget(PROFILES_KEY, player.id)) ?? emptyProfile(player);
        profile.displayName = player.displayName;
        const gameStat = profile.byGame[session.gameType] ?? { played: 0, wins: 0 };
        const won = session.winnerIds.includes(player.id);
        profile.gamesPlayed += 1;
        gameStat.played += 1;
        if (won) {
          profile.wins += 1;
          gameStat.wins += 1;
        }
        profile.byGame[session.gameType] = gameStat;
        updates[player.id] = JSON.stringify(profile);
      }
      await this.kv.hset(PROFILES_KEY, updates);
    }, 8000);
  }

  /** Menambahkan XP ke satu pemain (dipanggil saat menang atau berhasil menjawab). Mengembalikan info naik level untuk ditampilkan. */
  public async addPoints(player: Player, amount: number): Promise<{ profile: Profile; leveledUp: boolean; previousLevel: number }> {
    return withLock(this.kv, PROFILES_KEY, async () => {
      const profile = parseProfile(await this.kv.hget(PROFILES_KEY, player.id)) ?? emptyProfile(player);
      profile.displayName = player.displayName;
      const previousLevel = levelForXp(profile.xp);
      profile.xp += amount;
      await this.kv.hset(PROFILES_KEY, { [player.id]: JSON.stringify(profile) });
      return { profile, leveledUp: levelForXp(profile.xp) > previousLevel, previousLevel };
    }, 8000);
  }

  public async leaderboard(gameType?: GameType): Promise<readonly Profile[]> {
    return (await this.all())
      .filter((profile) => !gameType || (profile.byGame[gameType]?.played ?? 0) > 0)
      .sort(byRanking)
      .slice(0, 10);
  }

  /** Mengambil profil satu pemain untuk /level. Bila belum pernah main, kembalikan pratinjau level 1 tanpa menyimpannya. */
  public async getProfile(player: Player): Promise<Profile> {
    const existing = parseProfile(await this.kv.hget(PROFILES_KEY, player.id));
    if (existing) return { ...existing, displayName: player.displayName };
    return emptyProfile(player);
  }

  public async rank(player: Player): Promise<number | null> {
    const ordered = (await this.all()).sort(byRanking);
    const index = ordered.findIndex((profile) => profile.id === player.id);
    return index >= 0 ? index + 1 : null;
  }
}
