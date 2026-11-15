import { randomUUID } from "node:crypto";
import { TRIVIA_QUESTIONS, WORDS, type TriviaQuestion, type WordEntry } from "./game-content.js";
import {
  type GameData,
  type GameEvent,
  type GameResult,
  type GameSession,
  type GameType,
  type GuessWordData,
  type HangmanData,
  type Player,
  type WordScrambleData,
  type TriviaData,
  type WerewolfData,
  type WerewolfRole,
} from "./domain/types.js";

const MIN_PLAYERS: Record<GameType, number> = {
  werewolf: 5,
  "guess-word": 1,
  trivia: 1,
  hangman: 1,
  "word-scramble": 1,
};

const TRIVIA_ROUNDS = 5;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]/gu, "");
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex]!;
    copy[swapIndex] = current!;
  }
  return copy;
}

function choose<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("Kumpulan konten game kosong.");
  }
  return items[Math.floor(Math.random() * items.length)]!;
}

function scramble(word: string): string {
  const characters = Array.from(word);
  if (characters.length < 2) return word;

  let result = word;
  for (let attempt = 0; attempt < 8 && result === word; attempt += 1) {
    result = shuffled(characters).join("");
  }
  return result;
}

export function maskedWord(answer: string, letters: readonly string[]): string {
  const known = new Set(letters.map(normalize));
  return Array.from(answer)
    .map((character) => {
      if (character === " ") return " ";
      return known.has(normalize(character)) ? character : "＿";
    })
    .join(" ");
}

export function werewolfRoleSummary(role: WerewolfRole): string {
  switch (role) {
    case "werewolf":
      return "🐺 Werewolf — pilih satu warga untuk disingkirkan pada malam hari.";
    case "seer":
      return "🔮 Seer — periksa apakah satu pemain adalah Werewolf setiap malam.";
    case "doctor":
      return "💉 Doctor — lindungi satu pemain setiap malam, termasuk dirimu sendiri.";
    case "villager":
      return "🧑‍🌾 Villager — amati diskusi dan temukan Werewolf saat voting.";
  }
}

function isWerewolfData(data: GameData): data is WerewolfData {
  return data.kind === "werewolf";
}

function isTriviaData(data: GameData): data is TriviaData {
  return data.kind === "trivia";
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Jarak edit (Levenshtein) — dipakai untuk mendeteksi jawaban yang "hampir benar". */
export function editDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** Jawaban dianggap "hampir benar" bila hanya beda 1 huruf (atau 2 untuk kata panjang). */
function isNearMiss(submitted: string, answer: string): boolean {
  const tolerance = answer.length >= 7 ? 2 : 1;
  return editDistance(submitted, answer) <= tolerance;
}

/** Acak urutan pilihan supaya posisi jawaban benar tidak bisa ditebak. */
export function shuffleQuestion(question: TriviaQuestion): TriviaQuestion {
  const correct = question.choices[question.correctIndex]!;
  const choices = shuffled(question.choices) as unknown as TriviaQuestion["choices"];
  return { ...question, choices, correctIndex: choices.indexOf(correct) };
}

/** Berapa soal/kata terakhir per channel yang diingat agar tidak cepat terulang. */
const RECENT_TRIVIA_LIMIT = 100;
const RECENT_WORD_LIMIT = 60;
/** Setiap berapa kali salah tebak bot otomatis memberi hint. */
const AUTO_HINT_EVERY = 3;

/** Bungkus daftar pemenang menjadi field pointAwards (1 poin per pemenang), atau kosong bila tidak ada. */
function winnerPointAwards(winnerIds: readonly string[]): Pick<GameEvent, "pointAwards"> {
  return winnerIds.length > 0 ? { pointAwards: winnerIds.map((userId) => ({ userId, amount: 1 })) } : {};
}

export interface PendingWerewolfRoles {
  playerIds: string[];
  roles: Record<string, WerewolfRole>;
}

/** Keadaan satu channel yang bisa disimpan ke database lalu dimuat ulang di request berikutnya. */
export interface ChannelGameState {
  session?: GameSession;
  pendingWerewolf?: PendingWerewolfRoles;
  /** Soal/kata yang baru saja keluar di channel ini ("t:<soal>" / "w:<kata>"). */
  recent?: string[];
}

export class GameService {
  private readonly sessionsByChannel = new Map<string, GameSession>();
  /** Role yang sudah dihitung untuk lobby Werewolf tertentu, menunggu DM dikonfirmasi terkirim.
   * Dipertahankan antar percobaan /game start yang gagal (mis. DM tertutup) selama susunan
   * pemain di lobby tidak berubah, supaya pemain tidak mendapat role yang berbeda-beda di
   * setiap percobaan. */
  private readonly pendingWerewolfRoles = new Map<string, PendingWerewolfRoles>();
  private readonly recentByChannel = new Map<string, string[]>();

  /** Di Vercel setiap request berjalan terpisah, jadi state satu channel dimuat dari database ke sini. */
  public loadChannel(channelId: string, state: ChannelGameState): void {
    if (state.session) this.sessionsByChannel.set(channelId, state.session);
    if (state.pendingWerewolf) this.pendingWerewolfRoles.set(channelId, state.pendingWerewolf);
    if (state.recent) this.recentByChannel.set(channelId, [...state.recent]);
  }

  public exportChannel(channelId: string): ChannelGameState {
    const state: ChannelGameState = {};
    const session = this.sessionsByChannel.get(channelId);
    const pending = this.pendingWerewolfRoles.get(channelId);
    const recent = this.recentByChannel.get(channelId);
    if (session) state.session = session;
    if (pending) state.pendingWerewolf = pending;
    if (recent && recent.length > 0) state.recent = recent;
    return state;
  }

  private remember(channelId: string, key: string, limit: number): void {
    const prefix = key.slice(0, 2);
    const recent = (this.recentByChannel.get(channelId) ?? []).filter((item) => item !== key);
    recent.push(key);
    // Batasi per jenis (soal trivia vs kata) supaya satu jenis tidak menggusur yang lain.
    const sameKind = recent.filter((item) => item.startsWith(prefix));
    const overflow = new Set(sameKind.slice(0, Math.max(0, sameKind.length - limit)));
    this.recentByChannel.set(channelId, recent.filter((item) => !overflow.has(item)));
  }

  private recentSet(channelId: string): Set<string> {
    return new Set(this.recentByChannel.get(channelId) ?? []);
  }

  /** Pilih kata yang belum keluar baru-baru ini di channel ini. */
  private pickWord(channelId: string): WordEntry {
    const recent = this.recentSet(channelId);
    const fresh = WORDS.filter((word) => !recent.has(`w:${word.answer}`));
    const word = choose<WordEntry>(fresh.length > 0 ? fresh : WORDS);
    this.remember(channelId, `w:${word.answer}`, RECENT_WORD_LIMIT);
    return word;
  }

  /** Pilih soal trivia yang belum keluar di sesi/channel ini, dan sebisa mungkin beda kategori dari soal sebelumnya. */
  private pickTrivia(channelId: string, usedPrompts: readonly string[], previousCategory?: string): TriviaQuestion {
    const recent = this.recentSet(channelId);
    const unusedInSession = TRIVIA_QUESTIONS.filter((question) => !usedPrompts.includes(question.prompt));
    const pool = unusedInSession.length > 0 ? unusedInSession : TRIVIA_QUESTIONS;
    const fresh = pool.filter((question) => !recent.has(`t:${question.prompt}`));
    const candidates = fresh.length > 0 ? fresh : pool;
    const otherCategory = candidates.filter((question) => question.category !== previousCategory);
    const question = choose<TriviaQuestion>(otherCategory.length > 0 ? otherCategory : candidates);
    this.remember(channelId, `t:${question.prompt}`, RECENT_TRIVIA_LIMIT);
    return shuffleQuestion(question);
  }

  private hintFor(data: GuessWordData | WordScrambleData): string {
    const { answer } = data;
    const revealCount = Math.min(answer.length, Math.max(1, data.hintLevel + 1));
    data.hintLevel = revealCount;
    const hint = `${answer.slice(0, revealCount)}${" _".repeat(Math.max(0, answer.length - revealCount))}`;
    const clue = data.kind === "word-scramble" && data.clue ? `\n🧩 Petunjuk: *${data.clue}*` : "";
    return `💡 Hint: **${hint}**${clue}`;
  }

  public findByChannel(channelId: string): GameSession | undefined {
    return this.sessionsByChannel.get(channelId);
  }

  public allSessions(): readonly GameSession[] {
    return [...this.sessionsByChannel.values()];
  }

  public create(input: {
    guildId: string;
    channelId: string;
    host: Player;
    gameType: GameType;
  }): GameResult {
    if (this.sessionsByChannel.has(input.channelId)) {
      return { ok: false, error: "Sudah ada game aktif atau lobby di channel ini." };
    }

    const session: GameSession = {
      id: randomUUID(),
      guildId: input.guildId,
      channelId: input.channelId,
      hostId: input.host.id,
      gameType: input.gameType,
      phase: "lobby",
      players: [input.host],
      createdAt: Date.now(),
      round: 0,
      winnerIds: [],
      data: this.createEmptyData(input.gameType),
    };
    this.sessionsByChannel.set(input.channelId, session);

    return {
      ok: true,
      events: [
        {
          text: `Lobby **${this.gameLabel(input.gameType)}** dibuat oleh <@${input.host.id}>. Moderator: **🤖 Bot AI otomatis**. Gunakan tombol **Gabung** atau **/game join**.`,
        },
      ],
    };
  }

  public join(channelId: string, player: Player): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada lobby atau game aktif di channel ini." };
    if (session.phase !== "lobby") return { ok: false, error: "Game sudah dimulai; pemain baru tidak dapat bergabung." };
    if (session.players.some(({ id }) => id === player.id)) {
      return { ok: false, error: "Kamu sudah berada di lobby ini." };
    }
    if (session.players.length >= 25) return { ok: false, error: "Batas lobby adalah 25 pemain." };

    session.players.push(player);
    return { ok: true, events: [{ text: `<@${player.id}> bergabung. Pemain: **${session.players.length}**.` }] };
  }

  public leave(channelId: string, playerId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada lobby atau game aktif di channel ini." };
    if (session.phase !== "lobby") return { ok: false, error: "Pemain tidak dapat keluar setelah game dimulai." };
    if (session.hostId === playerId) return { ok: false, error: "Host tidak dapat keluar. Gunakan /game stop untuk membatalkan lobby." };
    const index = session.players.findIndex(({ id }) => id === playerId);
    if (index < 0) return { ok: false, error: "Kamu tidak berada di lobby ini." };

    session.players.splice(index, 1);
    return { ok: true, events: [{ text: `<@${playerId}> keluar. Pemain: **${session.players.length}**.` }] };
  }

  public start(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada lobby di channel ini." };
    if (session.phase !== "lobby") return { ok: false, error: "Game ini sudah dimulai." };
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat memulai game." };

    const minimum = MIN_PLAYERS[session.gameType];
    if (session.players.length < minimum) {
      return { ok: false, error: `${this.gameLabel(session.gameType)} membutuhkan minimal ${minimum} pemain.` };
    }

    switch (session.gameType) {
      case "werewolf": {
        // Jalur normal (bot Discord) memakai prepareWerewolfStart + commitWerewolfStart agar
        // DM role dipastikan terkirim sebelum sesi benar-benar dimulai. Jalur ini hanya
        // fallback (mis. dipakai pengujian) dan langsung meng-commit tanpa pengiriman DM nyata.
        const prepared = this.prepareWerewolfStart(session.channelId, actorId);
        if (!prepared.ok) return prepared;
        return this.commitWerewolfStart(session.channelId, prepared.roles);
      }
      case "guess-word":
        return this.startGuessWord(session);
      case "trivia":
        return this.startTrivia(session);
      case "hangman":
        return this.startHangman(session);
      case "word-scramble":
        return this.startWordScramble(session);
    }
  }

  public stop(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada game yang dapat dihentikan." };
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat menghentikan game." };

    this.sessionsByChannel.delete(channelId);
    this.pendingWerewolfRoles.delete(channelId);
    return { ok: true, events: [{ text: "Game dibatalkan dan sesi telah ditutup." }] };
  }

  public status(channelId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada lobby atau game aktif di channel ini." };
    const players = session.players.map((player) => `<@${player.id}>`).join(", ");
    const phase = session.phase === "lobby" ? "Lobby" : this.phaseLabel(session.phase);
    const details = this.statusDetails(session);
    return {
      ok: true,
      events: [
        {
          text: `**${this.gameLabel(session.gameType)}** · ${phase}\nModerator: **🤖 Bot AI**\nPemain (${session.players.length}): ${players}${details ? `\n${details}` : ""}`,
        },
      ],
    };
  }

  public revealHint(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada game aktif." };
    if (session.phase !== "playing") return { ok: false, error: "Hint hanya tersedia saat game sedang dimainkan." };
    if (!session.players.some(({ id }) => id === actorId)) return { ok: false, error: "Hanya pemain dalam game ini yang dapat meminta hint." };
    if (session.data.kind !== "guess-word" && session.data.kind !== "word-scramble") {
      return { ok: false, error: "Game ini tidak mendukung hint." };
    }

    return { ok: true, events: [{ text: this.hintFor(session.data) }] };
  }

  public submitTextAnswer(channelId: string, actorId: string, answer: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada game aktif." };
    if (!session.players.some(({ id }) => id === actorId)) return { ok: false, error: "Kamu bukan pemain dalam game ini." };
    if (session.phase !== "playing") return { ok: false, error: "Game ini belum siap menerima jawaban." };
    const submitted = normalize(answer);
    if (!submitted) return { ok: false, error: "Jawaban tidak boleh kosong." };

    if (session.data.kind === "guess-word" || session.data.kind === "word-scramble") {
      const data = session.data;
      data.attempts += 1;
      const target = normalize(data.answer);
      if (submitted !== target) {
        const lines = [
          isNearMiss(submitted, target)
            ? `🔥 <@${actorId}> **hampir benar!** Tinggal sedikit lagi. (percobaan ke-${data.attempts})`
            : `<@${actorId}> belum tepat. Coba lagi! (percobaan ke-${data.attempts})`,
        ];
        // Bot membantu otomatis bila pemain kesulitan.
        if (data.attempts % AUTO_HINT_EVERY === 0 && data.hintLevel < target.length - 1) {
          lines.push(`🤖 Sudah ${data.attempts} kali salah, bot kasih bantuan:\n${this.hintFor(data)}`);
        }
        return { ok: true, events: [{ text: lines.join("\n") }] };
      }
      return this.finish(session, [actorId], `🎉 <@${actorId}> menebak dengan benar: **${data.answer}**! (${data.attempts} percobaan)`);
    }

    if (session.data.kind === "hangman") {
      const data = session.data;
      const target = normalize(data.answer);
      // Tebak langsung satu kata utuh: benar = menang, salah = kena 1 kesalahan.
      if (Array.from(submitted).length > 1) {
        if (submitted === target) {
          return this.finish(
            session,
            session.players.map(({ id }) => id),
            `🎯 <@${actorId}> menebak kata utuh dengan tepat: **${data.answer}**! Semua pemain selamat.`,
          );
        }
        data.wrongGuesses += 1;
        if (data.wrongGuesses >= data.maxWrongGuesses) {
          return this.finish(session, [], `💀 Tebakan **${answer}** salah dan kesempatan habis. Jawabannya adalah **${data.answer}**.`);
        }
        const near = isNearMiss(submitted, target) ? " 🔥 Hampir benar!" : "";
        return {
          ok: true,
          events: [{ text: `<@${actorId}> menebak kata **${answer}**: ❌ salah.${near}\n${maskedWord(data.answer, data.guessedLetters)}\nKesalahan: **${data.wrongGuesses}/${data.maxWrongGuesses}**.${this.hangmanClue(data)}` }],
        };
      }
      if (data.guessedLetters.includes(submitted)) {
        return { ok: false, error: "Huruf itu sudah pernah ditebak." };
      }
      data.guessedLetters.push(submitted);
      const correct = target.includes(submitted);
      if (!correct) data.wrongGuesses += 1;

      const isSolved = Array.from(normalize(data.answer)).every((letter) => data.guessedLetters.includes(letter));
      if (isSolved) {
        return this.finish(
          session,
          session.players.map(({ id }) => id),
          `🎉 Kata berhasil diselamatkan berkat <@${actorId}>: **${data.answer}**!`,
        );
      }
      if (data.wrongGuesses >= data.maxWrongGuesses) {
        return this.finish(session, [], `💀 Kesempatan habis. Jawabannya adalah **${data.answer}**.`);
      }
      const result = correct ? "✅ benar" : "❌ salah";
      return {
        ok: true,
        events: [
          {
            text: `<@${actorId}> menebak **${answer}**: ${result}.\n${maskedWord(data.answer, data.guessedLetters)}\nKesalahan: **${data.wrongGuesses}/${data.maxWrongGuesses}**.${correct ? "" : this.hangmanClue(data)}`,
          },
        ],
      };
    }

    return { ok: false, error: "Gunakan tombol jawaban untuk Trivia." };
  }

  public submitTriviaAnswer(channelId: string, actorId: string, choiceIndex: number): GameResult {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Trivia tidak aktif." };
    if (session.phase !== "playing" || !isTriviaData(session.data)) {
      return { ok: false, error: "Tidak ada sesi Trivia yang menerima jawaban." };
    }
    if (!session.players.some(({ id }) => id === actorId)) return { ok: false, error: "Kamu bukan pemain dalam game ini." };
    const data = session.data;
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= data.choices.length) {
      return { ok: false, error: "Pilihan jawaban tidak valid." };
    }
    if (data.answers[actorId] !== undefined) return { ok: false, error: "Kamu sudah mengunci jawaban ronde ini." };

    data.answers[actorId] = choiceIndex;
    if (choiceIndex === data.correctIndex) {
      data.scores[actorId] = (data.scores[actorId] ?? 0) + 1;
    }
    if (Object.keys(data.answers).length < session.players.length) {
      return { ok: true, events: [{ text: `🔒 <@${actorId}> sudah mengunci jawaban ronde ${data.round}/${data.totalRounds}.` }] };
    }
    return this.resolveTriviaRound(session);
  }

  public submitNightAction(channelId: string, actorId: string, targetId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || session.gameType !== "werewolf" || session.phase !== "night" || !isWerewolfData(session.data)) {
      return { ok: false, error: "Tidak ada fase malam Werewolf aktif." };
    }
    const data = session.data;
    if (!data.aliveIds.includes(actorId)) return { ok: false, error: "Kamu sudah tidak aktif dalam game ini." };
    if (!data.aliveIds.includes(targetId)) return { ok: false, error: "Target harus pemain yang masih hidup." };
    const role = data.roles[actorId];
    if (!role) return { ok: false, error: "Role kamu tidak ditemukan." };

    if (role === "werewolf") {
      if (data.roles[targetId] === "werewolf") return { ok: false, error: "Werewolf tidak boleh menargetkan sesama Werewolf." };
      data.night.werewolfTargetId = targetId;
    } else if (role === "doctor") {
      data.night.doctorTargetId = targetId;
    } else if (role === "seer") {
      if (targetId === actorId) return { ok: false, error: "Seer tidak dapat memeriksa dirinya sendiri." };
      data.night.seerTargetId = targetId;
      data.pendingSeerResult = { seerId: actorId, targetId, isWerewolf: data.roles[targetId] === "werewolf" };
    } else {
      return { ok: false, error: "Role Villager tidak memiliki aksi malam." };
    }
    return { ok: true, events: [{ text: "🌙 Aksi malammu sudah disimpan secara rahasia." }] };
  }

  /** Dipakai bot untuk mempercepat alur: begitu semua aksi malam yang dibutuhkan sudah masuk, malam bisa langsung diselesaikan tanpa menunggu timer penuh. */
  public isNightReadyToResolve(channelId: string): boolean {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "night") return false;
    return this.nightActionsReady(session.data);
  }

  private nightActionsReady(data: WerewolfData): boolean {
    const aliveRoles = data.aliveIds.map((id) => data.roles[id]);
    const needsWolf = aliveRoles.includes("werewolf");
    const needsSeer = aliveRoles.includes("seer");
    const needsDoctor = aliveRoles.includes("doctor");
    if (needsWolf && data.night.werewolfTargetId === null) return false;
    if (needsSeer && data.night.seerTargetId === null) return false;
    if (needsDoctor && data.night.doctorTargetId === null) return false;
    return true;
  }

  public resolveNight(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "night") {
      return { ok: false, error: "Tidak ada fase malam yang perlu diselesaikan." };
    }
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat menyelesaikan fase." };

    const data = session.data;
    const victimId = data.night.werewolfTargetId;
    const wasProtected = victimId !== null && victimId === data.night.doctorTargetId;
    const events: GameEvent[] = [];
    if (data.pendingSeerResult) {
      const target = this.playerName(session, data.pendingSeerResult.targetId);
      const alignment = data.pendingSeerResult.isWerewolf ? "adalah **Werewolf**" : "bukan Werewolf";
      events.push({ text: "🔮 Hasil pemeriksaan Seer tersedia lewat DM.", directMessages: [{ userId: data.pendingSeerResult.seerId, text: `🔮 Hasil Seer: **${target}** ${alignment}.` }] });
    }
    if (victimId && !wasProtected) {
      this.removeAlivePlayer(data, victimId);
      events.push({ text: `☀️ Pagi tiba. <@${victimId}> ditemukan telah tersingkir.` });
    } else if (victimId && wasProtected) {
      events.push({ text: "☀️ Pagi tiba. Dokter berhasil melindungi korban malam ini — tidak ada yang tersingkir!" });
    } else {
      events.push({ text: "☀️ Pagi tiba. Tidak ada pemain yang tersingkir malam ini." });
    }
    data.night = { werewolfTargetId: null, doctorTargetId: null, seerTargetId: null };
    data.pendingSeerResult = null;

    const winner = this.resolveWerewolfWinner(session);
    if (winner?.ok) {
      events.push(...winner.events);
      return { ok: true, events };
    }
    session.phase = "day";
    // Reset tahap siang; tanpa ini, setelah voting pertama bot langsung melompat ke malam
    // berikutnya di setiap siang dan voting tidak pernah dibuka lagi.
    data.dayStage = "discussion";
    events.push({ text: "💬 Fase **siang** dimulai. Diskusikan kecurigaanmu — voting akan dibuka otomatis oleh bot." });
    return { ok: true, events };
  }

  public beginVoting(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "day") {
      return { ok: false, error: "Voting hanya dapat dimulai pada fase siang Werewolf." };
    }
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat membuka voting." };
    session.phase = "voting";
    session.data.votes = {};
    return { ok: true, events: [{ text: "🗳️ Voting dibuka. Gunakan `/game vote pemain:@nama` untuk memilih." }] };
  }

  public submitVote(channelId: string, actorId: string, targetId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "voting") {
      return { ok: false, error: "Tidak ada voting Werewolf aktif." };
    }
    const { aliveIds, votes } = session.data;
    if (!aliveIds.includes(actorId)) return { ok: false, error: "Hanya pemain yang masih hidup dapat memilih." };
    if (!aliveIds.includes(targetId)) return { ok: false, error: "Target vote harus pemain yang masih hidup." };
    votes[actorId] = targetId;

    if (Object.keys(votes).length === aliveIds.length) return this.resolveVoting(session);
    return { ok: true, events: [{ text: `🗳️ <@${actorId}> mengunci voting. (${Object.keys(votes).length}/${aliveIds.length})` }] };
  }

  public resolveVotingByModerator(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "voting") {
      return { ok: false, error: "Tidak ada voting yang perlu diselesaikan." };
    }
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat menutup voting." };
    return this.resolveVoting(session);
  }

  public beginNextNight(channelId: string, actorId: string): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || !isWerewolfData(session.data) || session.phase !== "day") {
      return { ok: false, error: "Malam berikutnya hanya dapat dimulai setelah fase siang." };
    }
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat mengganti fase." };
    session.phase = "night";
    session.round += 1;
    return { ok: true, events: [{ text: `🌙 Malam ke-${session.round} dimulai. Pemain dengan role malam, cek DM-mu.` }] };
  }

  /** Sekarang hanya bot (AI) yang memoderasi jalannya fase; host tetap bisa membuat/menutup sesi. */
  public canControl(session: GameSession, actorId: string): boolean {
    return session.hostId === actorId;
  }

  public gameLabel(gameType: GameType): string {
    const labels: Record<GameType, string> = {
      werewolf: "Werewolf",
      "guess-word": "Tebak Kata",
      trivia: "Trivia",
      hangman: "Hangman",
      "word-scramble": "Acak Kata",
    };
    return labels[gameType];
  }

  private createEmptyData(gameType: GameType): GameData {
    switch (gameType) {
      case "werewolf":
        return { kind: "werewolf", roles: {}, aliveIds: [], dayStage: "discussion", night: { werewolfTargetId: null, doctorTargetId: null, seerTargetId: null }, votes: {}, pendingSeerResult: null };
      case "guess-word":
        return { kind: "guess-word", answer: "", category: "", hintLevel: 0, attempts: 0 };
      case "trivia":
        return { kind: "trivia", prompt: "", category: "", choices: [], correctIndex: 0, answers: {}, scores: {}, round: 0, totalRounds: 0, usedPrompts: [] };
      case "hangman":
        return { kind: "hangman", answer: "", category: "", guessedLetters: [], wrongGuesses: 0, maxWrongGuesses: 6 };
      case "word-scramble":
        return { kind: "word-scramble", answer: "", scrambled: "", category: "", hintLevel: 0, attempts: 0 };
    }
  }

  /**
   * Langkah 1 dari alur mulai Werewolf yang aman: hitung pembagian role tanpa mengubah state
   * sesi. Pemanggil (bot) harus berhasil mengirim DM role ke SEMUA pemain memakai hasil ini
   * sebelum memanggil commitWerewolfStart. Dengan begitu, sesi tidak pernah dimulai dalam
   * kondisi "setengah jadi" di mana sebagian pemain tidak tahu role mereka.
   */
  public prepareWerewolfStart(channelId: string, actorId: string): { ok: true; roles: Record<string, WerewolfRole> } | { ok: false; error: string } {
    const session = this.findByChannel(channelId);
    if (!session) return { ok: false, error: "Tidak ada lobby di channel ini." };
    if (session.gameType !== "werewolf") return { ok: false, error: "Sesi ini bukan Werewolf." };
    if (session.phase !== "lobby") return { ok: false, error: "Game ini sudah dimulai." };
    if (!this.canControl(session, actorId)) return { ok: false, error: "Hanya host yang dapat memulai game." };
    const minimum = MIN_PLAYERS.werewolf;
    if (session.players.length < minimum) {
      return { ok: false, error: `Werewolf membutuhkan minimal ${minimum} pemain.` };
    }
    const currentIds = session.players.map(({ id }) => id).sort();
    const cached = this.pendingWerewolfRoles.get(channelId);
    if (cached && arraysEqual(cached.playerIds, currentIds)) {
      return { ok: true, roles: cached.roles };
    }
    const roles = this.assignWerewolfRoles(session.players);
    this.pendingWerewolfRoles.set(channelId, { playerIds: currentIds, roles });
    return { ok: true, roles };
  }

  /** Langkah 2: baru mengubah state sesi menjadi "night" setelah semua DM role dipastikan terkirim. */
  public commitWerewolfStart(channelId: string, roles: Record<string, WerewolfRole>): GameResult {
    const session = this.findByChannel(channelId);
    if (!session || session.gameType !== "werewolf" || session.phase !== "lobby") {
      return { ok: false, error: "Sesi Werewolf tidak dapat dimulai (sudah berjalan atau tidak ditemukan)." };
    }
    this.pendingWerewolfRoles.delete(channelId);
    const data: WerewolfData = {
      kind: "werewolf",
      roles,
      aliveIds: session.players.map(({ id }) => id),
      dayStage: "discussion",
      night: { werewolfTargetId: null, doctorTargetId: null, seerTargetId: null },
      votes: {},
      pendingSeerResult: null,
    };
    session.data = data;
    session.phase = "night";
    session.round = 1;
    return {
      ok: true,
      events: [
        {
          text: "🐺 **Werewolf dimulai!** Semua role rahasia berhasil dikirim lewat DM.\n**Malam ke-1** dimulai — cek DM-mu bila memiliki aksi malam, lalu kirim lewat `/game night target:@pemain`.",
        },
      ],
    };
  }

  private startGuessWord(session: GameSession): GameResult {
    const word = this.pickWord(session.channelId);
    session.data = { kind: "guess-word", answer: word.answer, category: word.category, clue: word.clue, hintLevel: 0, attempts: 0 };
    session.phase = "playing";
    return {
      ok: true,
      events: [
        {
          text: `🔤 **Tebak Kata** dimulai!\n📂 Kategori: **${word.category}**\n🧩 Petunjuk: *${word.clue}*\n🔢 Jumlah huruf: **${Array.from(word.answer).length}**\nKirim jawaban dengan **/game answer teks:…**. Bot memberi hint otomatis setiap ${AUTO_HINT_EVERY}x salah.`,
        },
      ],
    };
  }

  private hangmanClue(data: HangmanData): string {
    // Petunjuk deskriptif baru muncul setelah 3 kesalahan, supaya tetap menantang.
    return data.clue && data.wrongGuesses === 3 ? `\n🧩 Bot kasih petunjuk: *${data.clue}*` : "";
  }

  private startTrivia(session: GameSession): GameResult {
    const totalRounds = Math.min(TRIVIA_ROUNDS, TRIVIA_QUESTIONS.length);
    const question = this.pickTrivia(session.channelId, []);
    session.data = {
      kind: "trivia",
      prompt: question.prompt,
      category: question.category,
      choices: question.choices,
      correctIndex: question.correctIndex,
      answers: {},
      scores: {},
      round: 1,
      totalRounds,
      usedPrompts: [question.prompt],
    };
    session.phase = "playing";
    return { ok: true, events: [{ text: this.triviaRoundText(session.data) }] };
  }

  private startHangman(session: GameSession): GameResult {
    const word = this.pickWord(session.channelId);
    session.data = { kind: "hangman", answer: word.answer, category: word.category, clue: word.clue, guessedLetters: [], wrongGuesses: 0, maxWrongGuesses: 6 };
    session.phase = "playing";
    return {
      ok: true,
      events: [
        {
          text: `🪢 **Hangman** dimulai! Kategori: **${word.category}** (${Array.from(word.answer).length} huruf).\n${maskedWord(word.answer, [])}\nTebak satu huruf dengan **/game answer teks:…**, atau tebak langsung kata utuhnya (salah = 1 kesalahan).`,
        },
      ],
    };
  }

  private startWordScramble(session: GameSession): GameResult {
    const word = this.pickWord(session.channelId);
    const scrambled = scramble(word.answer);
    session.data = { kind: "word-scramble", answer: word.answer, scrambled, category: word.category, clue: word.clue, hintLevel: 0, attempts: 0 };
    session.phase = "playing";
    return {
      ok: true,
      events: [
        {
          text: `🔀 **Acak Kata** dimulai! Kategori: **${word.category}**.\nSusun kata ini: **${scrambled.toUpperCase()}**\nKirim jawaban dengan **/game answer teks:…**. Butuh bantuan? Tekan **Minta hint**.`,
        },
      ],
    };
  }

  private triviaRoundText(data: TriviaData): string {
    return `🧠 **Trivia** — Ronde **${data.round}/${data.totalRounds}**\n📚 Kategori: *${data.category}*\n${data.prompt}\nA. ${data.choices[0]}\nB. ${data.choices[1]}\nC. ${data.choices[2]}\nD. ${data.choices[3]}\nPilih jawaban lewat tombol di bawah!`;
  }

  private resolveTriviaRound(session: GameSession): GameResult {
    if (!isTriviaData(session.data)) return { ok: false, error: "Data Trivia tidak tersedia." };
    const data = session.data;
    const correctAnswer = data.choices[data.correctIndex] ?? "(jawaban tidak tersedia)";
    const correctIds = Object.entries(data.answers)
      .filter(([, choiceIndex]) => choiceIndex === data.correctIndex)
      .map(([playerId]) => playerId);
    const correctText = correctIds.length > 0 ? correctIds.map((id) => `<@${id}>`).join(", ") : "Tidak ada yang benar";

    const events: GameEvent[] = [
      {
        text: `📣 Ronde ${data.round}/${data.totalRounds} selesai! Jawaban benar: **${correctAnswer}**.\n✅ Benar: ${correctText}`,
        ...winnerPointAwards(correctIds),
      },
    ];

    if (data.round >= data.totalRounds) {
      const maxScore = Math.max(0, ...Object.values(data.scores));
      const winners = maxScore > 0 ? Object.entries(data.scores).filter(([, score]) => score === maxScore).map(([playerId]) => playerId) : [];
      const scoreboard = session.players.map((player) => `<@${player.id}>: **${data.scores[player.id] ?? 0}** poin`).join("\n");
      const winnerText = winners.length > 0 ? winners.map((id) => `<@${id}>`).join(", ") : "Tidak ada";
      const finished = this.finish(session, winners, `🏁 **Trivia selesai!**\nSkor akhir:\n${scoreboard}\n👑 Juara ronde: ${winnerText}`);
      if (finished.ok) events.push(...finished.events);
      return { ok: true, events };
    }

    const next = this.pickTrivia(session.channelId, data.usedPrompts, data.category);
    data.prompt = next.prompt;
    data.category = next.category;
    data.choices = next.choices;
    data.correctIndex = next.correctIndex;
    data.answers = {};
    data.round += 1;
    data.usedPrompts.push(next.prompt);
    events.push({ text: this.triviaRoundText(data) });
    return { ok: true, events };
  }

  private resolveWerewolfWinner(session: GameSession): GameResult | null {
    const data = session.data;
    if (!isWerewolfData(data)) return null;
    const wolves = data.aliveIds.filter((id) => data.roles[id] === "werewolf");
    const villagers = data.aliveIds.filter((id) => data.roles[id] !== "werewolf");
    if (wolves.length === 0) return this.finish(session, villagers, "🎉 Semua Werewolf telah tersingkir. **Tim warga menang!**");
    if (wolves.length >= villagers.length) return this.finish(session, wolves, "🐺 Werewolf telah menguasai desa. **Tim Werewolf menang!**");
    return null;
  }

  private finish(session: GameSession, winnerIds: string[], text: string): GameResult {
    session.winnerIds = winnerIds;
    session.phase = "finished";
    return {
      ok: true,
      events: [
        {
          text: `${text}\nGunakan **/game stop** untuk menutup sesi.`,
          ...winnerPointAwards(winnerIds),
        },
      ],
    };
  }

  private removeAlivePlayer(data: WerewolfData, playerId: string): void {
    data.aliveIds = data.aliveIds.filter((id) => id !== playerId);
  }

  private assignWerewolfRoles(players: readonly Player[]): Record<string, WerewolfRole> {
    const wolfCount = Math.max(1, Math.floor(players.length / 4));
    const roles: WerewolfRole[] = [
      ...Array<WerewolfRole>(wolfCount).fill("werewolf"),
      "seer",
      ...(players.length >= 6 ? (["doctor"] as const) : []),
      ...Array<WerewolfRole>(players.length - wolfCount - 1 - (players.length >= 6 ? 1 : 0)).fill("villager"),
    ];
    const shuffledRoles = shuffled(roles);
    return Object.fromEntries(players.map((player, index) => [player.id, shuffledRoles[index]!])) as Record<string, WerewolfRole>;
  }

  private resolveVoting(session: GameSession): GameResult {
    const data = session.data;
    if (!isWerewolfData(data)) return { ok: false, error: "Data Werewolf tidak tersedia." };
    const totals = new Map<string, number>();
    for (const targetId of Object.values(data.votes)) {
      totals.set(targetId, (totals.get(targetId) ?? 0) + 1);
    }
    const highest = Math.max(0, ...totals.values());
    const targets = [...totals.entries()].filter(([, count]) => count === highest).map(([targetId]) => targetId);
    const events: GameEvent[] = [];
    if (highest === 0 || targets.length !== 1) {
      events.push({ text: "🤷 Voting seri atau tidak ada suara mayoritas. Tidak ada pemain yang tersingkir." });
    } else {
      const eliminatedId = targets[0]!;
      this.removeAlivePlayer(data, eliminatedId);
      events.push({ text: `⚖️ <@${eliminatedId}> tersingkir melalui voting. Role-nya adalah **${data.roles[eliminatedId]}**.` });
    }
    const winner = this.resolveWerewolfWinner(session);
    if (winner?.ok) {
      events.push(...winner.events);
      return { ok: true, events };
    }
    session.phase = "day";
    data.dayStage = "after-vote";
    events.push({ text: "💬 Diskusi berlanjut. Bot akan memulai malam berikutnya secara otomatis." });
    return { ok: true, events };
  }

  private playerName(session: GameSession, playerId: string): string {
    return session.players.find(({ id }) => id === playerId)?.displayName ?? "Pemain";
  }

  private phaseLabel(phase: GameSession["phase"]): string {
    const labels: Record<GameSession["phase"], string> = {
      lobby: "Lobby",
      night: "Malam",
      day: "Siang",
      voting: "Voting",
      playing: "Bermain",
      finished: "Selesai",
    };
    return labels[phase];
  }

  private statusDetails(session: GameSession): string {
    if (session.data.kind === "hangman" && session.phase === "playing") {
      return `${maskedWord(session.data.answer, session.data.guessedLetters)} · Kesalahan: ${session.data.wrongGuesses}/${session.data.maxWrongGuesses}`;
    }
    if (session.data.kind === "trivia" && session.phase === "playing") {
      return `Ronde: ${session.data.round}/${session.data.totalRounds} · Kategori: ${session.data.category}`;
    }
    if (session.data.kind === "guess-word" && session.phase === "playing") {
      return `Kategori: ${session.data.category}${session.data.clue ? ` · Petunjuk: *${session.data.clue}*` : ""} · Percobaan: ${session.data.attempts}`;
    }
    if (session.data.kind === "word-scramble" && session.phase === "playing") {
      return `Susun: **${session.data.scrambled.toUpperCase()}** · Kategori: ${session.data.category} · Percobaan: ${session.data.attempts}`;
    }
    if (session.data.kind === "werewolf" && session.phase !== "lobby") {
      return `Pemain aktif: ${session.data.aliveIds.map((id) => `<@${id}>`).join(", ")}`;
    }
    return "";
  }
}
