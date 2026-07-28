import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { GameSession, GameType, Player } from "./domain/types.js";

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

interface ProfileFile {
  profiles: Record<string, Profile>;
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

export class ProfileStore {
  private readonly filePath: string;
  private profiles: Record<string, Profile> = {};
  private loaded = false;

  public constructor(dataDirectory: string) {
    this.filePath = resolve(dataDirectory, "profiles.json");
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<ProfileFile>;
      this.profiles = parsed.profiles ?? {};
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        console.warn("Profil lama tidak dapat dibaca; file statistik baru akan dibuat.");
      }
      this.profiles = {};
    }
    this.loaded = true;
  }

  /** Mencatat statistik menang/main per sesi game yang selesai (tidak mengubah XP; XP diberikan real-time lewat addPoints). */
  public async recordFinishedGame(session: GameSession): Promise<void> {
    await this.load();
    for (const player of session.players) {
      const profile = this.getOrCreate(player);
      const gameStat = profile.byGame[session.gameType] ?? { played: 0, wins: 0 };
      const won = session.winnerIds.includes(player.id);
      profile.gamesPlayed += 1;
      gameStat.played += 1;
      if (won) {
        profile.wins += 1;
        gameStat.wins += 1;
      }
      profile.byGame[session.gameType] = gameStat;
    }
    await this.save();
  }

  /** Menambahkan XP ke satu pemain (dipanggil saat menang atau berhasil menjawab). Mengembalikan info naik level untuk ditampilkan. */
  public async addPoints(player: Player, amount: number): Promise<{ profile: Profile; leveledUp: boolean; previousLevel: number }> {
    await this.load();
    const profile = this.getOrCreate(player);
    const previousLevel = levelForXp(profile.xp);
    profile.xp += amount;
    const newLevel = levelForXp(profile.xp);
    await this.save();
    return { profile, leveledUp: newLevel > previousLevel, previousLevel };
  }

  public async leaderboard(gameType?: GameType): Promise<readonly Profile[]> {
    await this.load();
    return Object.values(this.profiles)
      .filter((profile) => !gameType || (profile.byGame[gameType]?.played ?? 0) > 0)
      .sort((left, right) => right.xp - left.xp || right.wins - left.wins || left.displayName.localeCompare(right.displayName))
      .slice(0, 10);
  }

  /** Mengambil profil satu pemain untuk /level. Bila belum pernah main, kembalikan pratinjau level 1 tanpa menyimpannya. */
  public async getProfile(player: Player): Promise<Profile> {
    await this.load();
    const existing = this.profiles[player.id];
    if (existing) {
      existing.displayName = player.displayName;
      return existing;
    }
    return { id: player.id, displayName: player.displayName, gamesPlayed: 0, wins: 0, xp: 0, byGame: {} };
  }

  public async rank(player: Player): Promise<number | null> {
    await this.load();
    if (!this.profiles[player.id]) return null;
    const ordered = Object.values(this.profiles).sort(
      (left, right) => right.xp - left.xp || right.wins - left.wins || left.displayName.localeCompare(right.displayName),
    );
    const index = ordered.findIndex((profile) => profile.id === player.id);
    return index >= 0 ? index + 1 : null;
  }

  private getOrCreate(player: Player): Profile {
    const current = this.profiles[player.id];
    if (current) {
      current.displayName = player.displayName;
      return current;
    }
    const profile: Profile = { id: player.id, displayName: player.displayName, gamesPlayed: 0, wins: 0, xp: 0, byGame: {} };
    this.profiles[player.id] = profile;
    return profile;
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify({ profiles: this.profiles }, null, 2), "utf8");
  }
}
