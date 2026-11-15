import assert from "node:assert/strict";
import test from "node:test";
import { TRIVIA_QUESTIONS, WORDS } from "../src/game-content.js";
import { GameService, editDistance, shuffleQuestion } from "../src/game-service.js";
import type { Player } from "../src/domain/types.js";

const host: Player = { id: "host", displayName: "Host" };

test("bank soal: banyak, unik, dan valid", () => {
  assert.ok(TRIVIA_QUESTIONS.length >= 150, `trivia hanya ${TRIVIA_QUESTIONS.length}`);
  assert.ok(WORDS.length >= 120, `kata hanya ${WORDS.length}`);
  assert.equal(new Set(TRIVIA_QUESTIONS.map((question) => question.prompt)).size, TRIVIA_QUESTIONS.length, "ada soal duplikat");
  for (const question of TRIVIA_QUESTIONS) {
    assert.equal(new Set(question.choices).size, 4, `pilihan ganda duplikat: ${question.prompt}`);
    assert.ok(question.correctIndex >= 0 && question.correctIndex < 4);
    for (const choice of question.choices) assert.ok(`A. ${choice}`.length <= 80, `label tombol terlalu panjang: ${choice}`);
  }
  assert.equal(new Set(WORDS.map((word) => word.answer)).size, WORDS.length, "ada kata duplikat");
  for (const word of WORDS) {
    assert.match(word.answer, /^[a-z]+$/, `kata harus huruf kecil tanpa spasi: ${word.answer}`);
    assert.ok(word.clue.length > 5);
    assert.ok(!word.clue.toLowerCase().includes(word.answer), `petunjuk membocorkan jawaban: ${word.answer}`);
  }
});

test("pilihan trivia diacak tapi jawaban benar tetap sama", () => {
  const original = TRIVIA_QUESTIONS[50]!;
  const correct = original.choices[original.correctIndex];
  const positions = new Set<number>();
  for (let index = 0; index < 60; index += 1) {
    const shuffledQuestion = shuffleQuestion(original);
    assert.equal(shuffledQuestion.choices[shuffledQuestion.correctIndex], correct);
    positions.add(shuffledQuestion.correctIndex);
  }
  assert.ok(positions.size > 1, "posisi jawaban benar seharusnya bervariasi");
});

test("soal trivia tidak diulang antar sesi di channel yang sama", () => {
  const games = new GameService();
  const seen = new Set<string>();
  for (let session = 0; session < 6; session += 1) {
    games.create({ guildId: "g", channelId: "c", host, gameType: "trivia" });
    games.start("c", host.id);
    for (let round = 0; round < 5; round += 1) {
      const current = games.findByChannel("c");
      assert.ok(current?.data.kind === "trivia");
      assert.ok(!seen.has(current.data.prompt), `soal terulang: ${current.data.prompt}`);
      seen.add(current.data.prompt);
      games.submitTriviaAnswer("c", host.id, current.data.correctIndex);
    }
    games.stop("c", host.id);
  }
  // Riwayat ikut tersimpan lewat exportChannel → loadChannel (seperti di Redis).
  const reloaded = new GameService();
  reloaded.loadChannel("c", games.exportChannel("c"));
  assert.equal(reloaded.exportChannel("c").recent?.filter((key) => key.startsWith("t:")).length, 30);
});

test("Tebak Kata: deteksi hampir benar dan hint otomatis tiap 3x salah", () => {
  assert.equal(editDistance("rendang", "rendan"), 1);
  const games = new GameService();
  games.create({ guildId: "g", channelId: "w", host, gameType: "guess-word" });
  const start = games.start("w", host.id);
  assert.ok(start.ok && /Petunjuk/.test(start.events[0]!.text));
  const session = games.findByChannel("w");
  assert.ok(session?.data.kind === "guess-word");
  const answer = session.data.answer;

  const near = games.submitTextAnswer("w", host.id, `${answer}x`);
  assert.ok(near.ok && /hampir benar/.test(near.events[0]!.text));
  games.submitTextAnswer("w", host.id, "zzzzzzzzzzzzzzzz");
  const third = games.submitTextAnswer("w", host.id, "qqqqqqqqqqqqqqqq");
  assert.ok(third.ok && /bot kasih bantuan/.test(third.events[0]!.text));
  assert.ok(third.ok && third.events[0]!.text.includes(`**${answer[0]}`));
});

test("Hangman: tebak kata utuh langsung menang, salah menambah kesalahan", () => {
  const games = new GameService();
  games.create({ guildId: "g", channelId: "h", host, gameType: "hangman" });
  games.start("h", host.id);
  const session = games.findByChannel("h");
  assert.ok(session?.data.kind === "hangman");
  const wrong = games.submitTextAnswer("h", host.id, "salahbanget");
  assert.ok(wrong.ok);
  assert.equal(session.data.wrongGuesses, 1);
  const win = games.submitTextAnswer("h", host.id, session.data.answer);
  assert.ok(win.ok && /kata utuh/.test(win.events[0]!.text));
  assert.equal(session.phase, "finished");
});
