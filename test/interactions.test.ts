import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, test } from "node:test";
import { flushBackground } from "../src/background.js";
import { MemoryKV, setKV } from "../src/kv.js";

// --- Lingkungan uji: kunci Discord palsu, Redis in-memory, dan Discord API tiruan. ---
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.DISCORD_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_API_BASE = "https://discord.test/api";
process.env.APP_URL = "https://bot.test";

const { POST: interactions } = await import("../api/interactions.js");
const { POST: tick } = await import("../api/tick.js");
const { runDueTimers } = await import("../src/bot.js");
const { tickSecret } = await import("../src/channel-state.js");

interface Call {
  method: string;
  url: string;
  body: any;
}

let kv: MemoryKV;
let calls: Call[] = [];
let closedDms = new Set<string>();

beforeEach(() => {
  kv = new MemoryKV();
  setKV(kv);
  calls = [];
  closedDms = new Set();
});

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  if (url.endsWith("/users/@me/channels")) {
    return Response.json({ id: `dm-${body.recipient_id}` });
  }
  const dm = url.match(/\/channels\/dm-(\w+)\/messages$/);
  if (dm && closedDms.has(dm[1]!)) {
    return Response.json({ message: "Cannot send messages to this user", code: 50007 }, { status: 403 });
  }
  if (url === "https://bot.test/api/tick") return new Response("Scheduled", { status: 202 });
  return Response.json({});
}) as typeof fetch;

let nextId = 1n;
function snowflake(): string {
  nextId += 1n;
  return String(((BigInt(Date.now()) - 1420070400000n) << 22n) + nextId);
}

const CHANNEL = "111111111111111111";
const users = ["1001", "1002", "1003", "1004", "1005", "1006"].map((id) => ({ id: `${id}00000000000000`, username: `user${id}` }));

async function send(payload: Record<string, unknown>, signature?: string): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = signature ?? sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  return interactions(
    new Request("https://bot.test/api/interactions", {
      method: "POST",
      body,
      headers: { "x-signature-ed25519": sig, "x-signature-timestamp": timestamp },
    }),
  );
}

async function command(userIndex: number, name: string, options: unknown[] = []): Promise<any> {
  const response = await send({
    id: snowflake(),
    application_id: "999",
    type: 2,
    token: `token-${snowflake()}`,
    guild_id: "222",
    channel_id: CHANNEL,
    member: { user: users[userIndex] },
    data: { name, options },
  });
  assert.equal(response.status, 200);
  return response.json();
}

const game = (userIndex: number, sub: string, options: unknown[] = []) => command(userIndex, "game", [{ type: 1, name: sub, options }]);

async function button(userIndex: number, customId: string): Promise<any> {
  const response = await send({
    id: snowflake(),
    application_id: "999",
    type: 3,
    token: `token-${snowflake()}`,
    guild_id: "222",
    channel_id: CHANNEL,
    member: { user: users[userIndex] },
    data: { custom_id: customId },
  });
  return response.json();
}

function stored(): any {
  const raw = (kv as any).values.get(`channel:${CHANNEL}`)?.value;
  return raw ? JSON.parse(raw) : undefined;
}

test("PING dibalas PONG dan signature palsu ditolak", async () => {
  const pong = await send({ id: snowflake(), application_id: "999", type: 1, token: "t" });
  assert.deepEqual(await pong.json(), { type: 1 });
  const rejected = await send({ type: 1 }, "00".repeat(64));
  assert.equal(rejected.status, 401);
});

test("Trivia lengkap lewat slash command + tombol, XP tersimpan di Redis", async () => {
  const created = await game(0, "create", [{ type: 3, name: "jenis", value: "trivia" }]);
  assert.equal(created.type, 4);
  assert.match(created.data.embeds[0].description, /Lobby \*\*Trivia\*\*/);
  assert.equal(created.data.components[0].components[0].custom_id, "game:join");

  const joined = await button(1, "game:join");
  assert.match(joined.data.embeds[0].description, /bergabung/);

  const notHost = await button(1, "game:start");
  assert.equal(notHost.data.flags, 64);

  let response = await game(0, "start");
  assert.match(response.data.embeds[0].description, /Ronde \*\*1\/5\*\*/);

  for (let round = 0; round < 5; round += 1) {
    const correct = stored().session.data.correctIndex;
    await button(0, `game:trivia:${correct}`);
    response = await button(1, `game:trivia:${correct}`);
    await flushBackground();
  }
  assert.equal(stored().session.phase, "finished");
  assert.equal(stored().recorded, true);

  const followUps = calls.filter((call) => call.url.startsWith("https://discord.test/api/webhooks/999/"));
  assert.ok(followUps.some((call) => /Trivia selesai/.test(call.body.embeds?.[0]?.description ?? "")));
  assert.ok(followUps.some((call) => call.body.embeds?.[0]?.title === "📈 Progress Pemain"));

  const level = await command(0, "level");
  // 5 jawaban benar + 1 kemenangan = 6 XP
  assert.equal(level.data.embeds[0].fields[0].value, "6");
  const board = await command(0, "leaderboard", [{ type: 3, name: "jenis", value: "trivia" }]);
  assert.match(board.data.embeds[0].description, /user1001/);

  const stopped = await game(0, "stop");
  assert.match(stopped.data.embeds[0].description, /ditutup/);
  assert.equal(stored().session, undefined);
  // Soal yang sudah keluar tetap diingat untuk game berikutnya di channel ini.
  assert.ok(stored().recent.filter((key: string) => key.startsWith("t:")).length >= 5);
});

async function werewolfLobby(count: number): Promise<void> {
  await game(0, "create", [{ type: 3, name: "jenis", value: "werewolf" }]);
  for (let index = 1; index < count; index += 1) await game(index, "join");
}

test("Werewolf: DM role dikirim dulu, timer fase berjalan lewat /api/tick", async () => {
  await werewolfLobby(6);
  const deferred = await game(0, "start");
  assert.equal(deferred.type, 5);
  await flushBackground();

  const dmMessages = calls.filter((call) => /\/channels\/dm-\w+\/messages$/.test(call.url));
  assert.equal(dmMessages.length, 6);
  const edit = calls.find((call) => call.method === "PATCH" && call.url.endsWith("/messages/@original"));
  assert.match(edit?.body.embeds[0].description, /Werewolf dimulai/);

  const state = stored();
  assert.equal(state.session.phase, "night");
  assert.equal(state.timer.action, "resolve-night");
  const scheduled = calls.find((call) => call.url === "https://bot.test/api/tick");
  assert.equal(scheduled?.body.channelId, CHANNEL);

  // Timer malam lewat → /api/tick menjalankan fase berikutnya dan mengirim pesan ke channel.
  state.timer.dueAt = Date.now() - 1;
  await kv.set(`channel:${CHANNEL}`, JSON.stringify(state));
  calls = [];
  await runDueTimers(CHANNEL);
  assert.equal(stored().session.phase, "day");
  assert.equal(stored().timer.action, "begin-voting");
  const posted = calls.filter((call) => call.url === `https://discord.test/api/channels/${CHANNEL}/messages`);
  assert.ok(posted.some((call) => /Pagi tiba/.test(call.body.embeds[0].description)));
  assert.ok(calls.some((call) => call.url === "https://bot.test/api/tick"));

  // Siang lewat → voting dibuka; semua vote masuk → hasil langsung keluar.
  const dayState = stored();
  dayState.timer.dueAt = Date.now() - 1;
  await kv.set(`channel:${CHANNEL}`, JSON.stringify(dayState));
  await runDueTimers(CHANNEL);
  assert.equal(stored().session.phase, "voting");
  const roles: Record<string, string> = stored().session.data.roles;
  const wolf = Object.keys(roles).find((id) => roles[id] === "werewolf")!;
  const voteTarget = Object.keys(roles).find((id) => id !== wolf)!;
  for (const id of stored().session.data.aliveIds as string[]) {
    const index = users.findIndex((user) => user.id === id);
    await game(index, "vote", [{ type: 6, name: "pemain", value: id === wolf ? voteTarget : wolf }]);
  }
  await flushBackground();
  const after = stored();
  assert.ok(after.session.phase === "finished" || after.session.data.dayStage === "after-vote");
});

test("Werewolf: aksi malam lengkap langsung menyelesaikan malam", async () => {
  await werewolfLobby(6);
  await game(0, "start");
  await flushBackground();
  const roles: Record<string, string> = stored().session.data.roles;
  const byRole = (role: string) => Object.keys(roles).find((id) => roles[id] === role)!;
  const idx = (id: string) => users.findIndex((user) => user.id === id);
  const villager = byRole("villager");
  calls = [];
  const saved = await game(idx(byRole("werewolf")), "night", [{ type: 6, name: "target", value: villager }]);
  assert.equal(saved.data.flags, 64);
  await game(idx(byRole("doctor")), "night", [{ type: 6, name: "target", value: byRole("seer") }]);
  await game(idx(byRole("seer")), "night", [{ type: 6, name: "target", value: byRole("werewolf") }]);
  await flushBackground();
  assert.equal(stored().session.phase, "day");
  assert.equal(stored().session.data.dayStage, "discussion");
  assert.ok(calls.some((call) => call.url.includes("/webhooks/999/") && /tersingkir/.test(call.body.embeds?.[0]?.description ?? "")));
  // Seer menerima hasil pemeriksaan lewat DM.
  assert.ok(calls.some((call) => call.url === `https://discord.test/api/channels/dm-${byRole("seer")}/messages`));
});

test("Werewolf: bila satu DM gagal, game tidak dimulai", async () => {
  await werewolfLobby(5);
  closedDms.add(users[3]!.id);
  await game(0, "start");
  await flushBackground();
  const edit = calls.find((call) => call.method === "PATCH" && call.url.endsWith("/messages/@original"));
  assert.match(edit?.body.content, /Game belum dimulai/);
  assert.match(edit?.body.content, new RegExp(users[3]!.id));
  assert.equal(stored().session.phase, "lobby");
});

test("/api/tick menolak request tanpa secret", async () => {
  const forbidden = await tick(new Request("https://bot.test/api/tick", { method: "POST", body: "{}" }));
  assert.equal(forbidden.status, 403);
  const accepted = await tick(
    new Request("https://bot.test/api/tick", {
      method: "POST",
      headers: { "x-tick-secret": tickSecret() },
      body: JSON.stringify({ channelId: CHANNEL, dueAt: Date.now() }),
    }),
  );
  assert.equal(accepted.status, 202);
  await flushBackground();
});
