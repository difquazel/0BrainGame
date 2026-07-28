export const GAME_TYPES = [
  "werewolf",
  "guess-word",
  "trivia",
  "hangman",
  "word-scramble",
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export type SessionPhase =
  | "lobby"
  | "night"
  | "day"
  | "voting"
  | "playing"
  | "finished";

export interface Player {
  id: string;
  displayName: string;
}

export interface SessionBase {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  gameType: GameType;
  phase: SessionPhase;
  players: Player[];
  createdAt: number;
  round: number;
  winnerIds: string[];
}

export type WerewolfRole = "werewolf" | "seer" | "doctor" | "villager";

export interface WerewolfData {
  kind: "werewolf";
  roles: Record<string, WerewolfRole>;
  aliveIds: string[];
  dayStage: "discussion" | "after-vote";
  night: {
    werewolfTargetId: string | null;
    doctorTargetId: string | null;
    seerTargetId: string | null;
  };
  votes: Record<string, string>;
  pendingSeerResult: { seerId: string; targetId: string; isWerewolf: boolean } | null;
}

export interface GuessWordData {
  kind: "guess-word";
  answer: string;
  category: string;
  hintLevel: number;
  attempts: number;
}

export interface TriviaData {
  kind: "trivia";
  prompt: string;
  category: string;
  choices: readonly string[];
  correctIndex: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  round: number;
  totalRounds: number;
  usedPrompts: string[];
}

export interface HangmanData {
  kind: "hangman";
  answer: string;
  category: string;
  guessedLetters: string[];
  wrongGuesses: number;
  maxWrongGuesses: number;
}

export interface WordScrambleData {
  kind: "word-scramble";
  answer: string;
  scrambled: string;
  category: string;
  hintLevel: number;
  attempts: number;
}

export type GameData = WerewolfData | GuessWordData | TriviaData | HangmanData | WordScrambleData;

export interface GameSession extends SessionBase {
  data: GameData;
}

export interface PointAward {
  userId: string;
  amount: number;
}

export interface GameEvent {
  text: string;
  directMessages?: Array<{ userId: string; text: string }>;
  pointAwards?: PointAward[];
}

export type GameResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; error: string };
