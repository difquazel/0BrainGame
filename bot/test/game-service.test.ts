import assert from "node:assert/strict";
import test from "node:test";
import { GameService } from "../src/game-service.js";
import type { Player } from "../src/domain/types.js";
import { levelForXp, xpProgress, progressBar, MAX_LEVEL, XP_PER_LEVEL, ProfileStore } from "../src/profile-store.js";

function player(index: number): Player {
  return { id: `player-${index}`, displayName: `Pemain ${index}` };
}

function mustSucceed<T extends { ok: boolean }>(result: T): asserts result is Extract<T, { ok: true }> {
  assert.equal(result.ok, true, "Aksi seharusnya berhasil");
}

test("hanya host yang dapat mengontrol sesi (moderator selalu bot AI)", () => {
  const games = new GameService();
  const host = player(1);
  const created = games.create({ guildId: "guild", channelId: "room-b", host, gameType: "trivia" });
  mustSucceed(created);
  const session = games.findByChannel("room-b");
  assert.ok(session);
  assert.equal(games.canControl(session, host.id), true);
  assert.equal(games.canControl(session, player(2).id), false);
});

test("tebak kata menyelesaikan sesi, mencatat pemenang, dan memberi 1 poin XP", () => {
  const games = new GameService();
  const host = player(1);
  mustSucceed(games.create({ guildId: "guild", channelId: "word-room", host, gameType: "guess-word" }));
  mustSucceed(games.start("word-room", host.id));
  const session = games.findByChannel("word-room");
  assert.ok(session && session.data.kind === "guess-word");

  const result = games.submitTextAnswer("word-room", host.id, session.data.answer);
  mustSucceed(result);
  assert.equal(session.phase, "finished");
  assert.deepEqual(session.winnerIds, [host.id]);
  const finishEvent = result.events.at(-1);
  assert.ok(finishEvent?.pointAwards);
  assert.deepEqual(finishEvent.pointAwards, [{ userId: host.id, amount: 1 }]);
});

test("Werewolf: prepare lalu commit tidak mengacak ulang role pada roster yang sama", () => {
  const games = new GameService();
  const host = player(1);
  const players = [host, player(2), player(3), player(4), player(5)];
  mustSucceed(games.create({ guildId: "guild", channelId: "wolf-room", host, gameType: "werewolf" }));
  for (const joining of players.slice(1)) mustSucceed(games.join("wolf-room", joining));

  const firstAttempt = games.prepareWerewolfStart("wolf-room", host.id);
  mustSucceed(firstAttempt);
  const secondAttempt = games.prepareWerewolfStart("wolf-room", host.id);
  mustSucceed(secondAttempt);
  // Roster belum berubah antar dua percobaan, sehingga role yang dihitung harus identik
  // (mensimulasikan retry setelah DM gagal terkirim).
  assert.deepEqual(firstAttempt.roles, secondAttempt.roles);

  const committed = games.commitWerewolfStart("wolf-room", secondAttempt.roles);
  mustSucceed(committed);
  const session = games.findByChannel("wolf-room");
  assert.ok(session && session.data.kind === "werewolf");
  assert.equal(session.phase, "night");
  assert.deepEqual(session.data.roles, secondAttempt.roles);
});

test("Werewolf: night auto-resolve siap begitu semua aksi yang dibutuhkan masuk, lalu voting & finish memberi poin", () => {
  const games = new GameService();
  const host = player(1);
  const players = [host, player(2), player(3), player(4), player(5), player(6)];
  mustSucceed(games.create({ guildId: "guild", channelId: "wolf-room-2", host, gameType: "werewolf" }));
  for (const joining of players.slice(1)) mustSucceed(games.join("wolf-room-2", joining));
  const prepared = games.prepareWerewolfStart("wolf-room-2", host.id);
  mustSucceed(prepared);
  mustSucceed(games.commitWerewolfStart("wolf-room-2", prepared.roles));

  const session = games.findByChannel("wolf-room-2");
  assert.ok(session && session.data.kind === "werewolf");
  const werewolfId = Object.entries(session.data.roles).find(([, role]) => role === "werewolf")?.[0];
  const doctorId = Object.entries(session.data.roles).find(([, role]) => role === "doctor")?.[0];
  const seerId = Object.entries(session.data.roles).find(([, role]) => role === "seer")?.[0];
  const villagerId = Object.entries(session.data.roles).find(([, role]) => role === "villager")?.[0];
  assert.ok(werewolfId && doctorId && seerId && villagerId);

  assert.equal(games.isNightReadyToResolve("wolf-room-2"), false);
  mustSucceed(games.submitNightAction("wolf-room-2", werewolfId, villagerId));
  mustSucceed(games.submitNightAction("wolf-room-2", doctorId, villagerId));
  mustSucceed(games.submitNightAction("wolf-room-2", seerId, werewolfId));
  assert.equal(games.isNightReadyToResolve("wolf-room-2"), true);

  mustSucceed(games.resolveNight("wolf-room-2", host.id));
  assert.equal(session.phase, "day");
  // Dokter melindungi target werewolf, sehingga tidak ada yang tersingkir malam ini.
  assert.equal(session.data.aliveIds.includes(villagerId), true);

  mustSucceed(games.beginVoting("wolf-room-2", host.id));
  for (const aliveId of [...session.data.aliveIds]) {
    const target = aliveId === werewolfId ? (session.data.aliveIds.find((candidate) => candidate !== werewolfId) ?? werewolfId) : werewolfId;
    const voteResult = games.submitVote("wolf-room-2", aliveId, target);
    mustSucceed(voteResult);
    const updatedSession = games.findByChannel("wolf-room-2");
    if (updatedSession?.phase === "finished") {
      const finishEvent = voteResult.events.at(-1);
      assert.ok(finishEvent?.pointAwards && finishEvent.pointAwards.length > 0);
    }
  }
  const finalSession = games.findByChannel("wolf-room-2");
  assert.ok(finalSession?.phase === "finished" || finalSession?.phase === "day");
});

test("Trivia berjalan multi-ronde dan memberi 1 poin per jawaban benar tiap ronde", () => {
  const games = new GameService();
  const host = player(1);
  const second = player(2);
  mustSucceed(games.create({ guildId: "guild", channelId: "trivia-room", host, gameType: "trivia" }));
  mustSucceed(games.join("trivia-room", second));
  mustSucceed(games.start("trivia-room", host.id));

  let session = games.findByChannel("trivia-room");
  assert.ok(session && session.data.kind === "trivia");
  const totalRounds = session.data.totalRounds;
  assert.ok(totalRounds >= 1);

  let roundsPlayed = 0;
  while (true) {
    session = games.findByChannel("trivia-room");
    assert.ok(session && session.data.kind === "trivia");
    if (session.phase === "finished") break;
    const data = session.data;
    const partial = games.submitTriviaAnswer("trivia-room", host.id, data.correctIndex);
    mustSucceed(partial);
    // Ronde belum selesai (baru 1 dari 2 pemain menjawab) → belum ada pointAwards.
    assert.equal(partial.events[0]?.pointAwards, undefined);
    const final = games.submitTriviaAnswer("trivia-room", second.id, data.correctIndex);
    mustSucceed(final);
    const roundEvent = final.events[0];
    assert.deepEqual(
      roundEvent?.pointAwards?.slice().sort((a, b) => a.userId.localeCompare(b.userId)),
      [
        { userId: host.id, amount: 1 },
        { userId: second.id, amount: 1 },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
    roundsPlayed += 1;
    if (roundsPlayed > totalRounds + 1) throw new Error("Trivia tidak pernah selesai; kemungkinan ada bug.");
  }
  assert.equal(roundsPlayed, totalRounds);
  session = games.findByChannel("trivia-room");
  assert.ok(session);
  assert.deepEqual(new Set(session.winnerIds), new Set([host.id, second.id]));
});

test("sistem level: naik tiap XP_PER_LEVEL poin dan dibatasi di MAX_LEVEL", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(XP_PER_LEVEL - 1), 1);
  assert.equal(levelForXp(XP_PER_LEVEL), 2);
  assert.equal(levelForXp(XP_PER_LEVEL * 2), 3);
  assert.equal(levelForXp(XP_PER_LEVEL * (MAX_LEVEL + 20)), MAX_LEVEL);

  const progress = xpProgress(XP_PER_LEVEL + 3);
  assert.equal(progress.level, 2);
  assert.equal(progress.intoLevel, 3);
  assert.equal(progress.isMaxLevel, false);

  const maxProgress = xpProgress(XP_PER_LEVEL * 200);
  assert.equal(maxProgress.level, MAX_LEVEL);
  assert.equal(maxProgress.isMaxLevel, true);

  assert.equal(progressBar(0, 10, 10), "⬜".repeat(10));
  assert.equal(progressBar(10, 10, 10), "🟩".repeat(10));
  assert.equal(progressBar(5, 10, 10), `${"🟩".repeat(5)}${"⬜".repeat(5)}`);
});

test("ProfileStore.getProfile & rank mendukung /level (termasuk pemain yang belum pernah main)", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpDir = path.join(os.tmpdir(), `profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const store = new ProfileStore(tmpDir);
  const alice = player(101);
  const bob = player(102);

  const freshPreview = await store.getProfile(alice);
  assert.equal(freshPreview.xp, 0);
  assert.equal(levelForXp(freshPreview.xp), 1);
  assert.equal(await store.rank(alice), null);

  await store.addPoints(alice, 15);
  await store.addPoints(bob, 25);

  const aliceProfile = await store.getProfile(alice);
  assert.equal(aliceProfile.xp, 15);
  assert.equal(await store.rank(bob), 1);
  assert.equal(await store.rank(alice), 2);
});
