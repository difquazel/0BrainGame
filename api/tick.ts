import { timingSafeEqual } from "node:crypto";
import { runInBackground } from "../src/background.js";
import { runDueTimers } from "../src/bot.js";
import { tickSecret } from "../src/channel-state.js";
import { LockBusyError } from "../src/kv.js";

/** Batas tidur per tick; harus di bawah maxDuration function ini di vercel.json. */
const MAX_SLEEP_MS = 240_000;

function sameSecret(given: string | null): boolean {
  const expected = Buffer.from(tickSecret());
  const actual = Buffer.from(given ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sleep = (ms: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, ms));

/**
 * Timer fase Werewolf. Dipanggil oleh bot sendiri saat fase baru dimulai: langsung membalas 202,
 * lalu (di latar belakang) menunggu sampai waktunya dan menjalankan fase berikutnya.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameSecret(request.headers.get("x-tick-secret"))) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { channelId?: unknown; dueAt?: unknown } | null;
  const channelId = typeof body?.channelId === "string" ? body.channelId : null;
  const dueAt = typeof body?.dueAt === "number" ? body.dueAt : null;
  if (!channelId || !/^\d{5,25}$/.test(channelId) || dueAt === null) return new Response("Bad request", { status: 400 });

  runInBackground(async () => {
    await sleep(Math.min(MAX_SLEEP_MS, Math.max(0, dueAt - Date.now() + 250)));
    try {
      await runDueTimers(channelId);
    } catch (error) {
      if (!(error instanceof LockBusyError)) throw error;
      await sleep(1500);
      await runDueTimers(channelId);
    }
  });
  return new Response("Scheduled", { status: 202 });
}
