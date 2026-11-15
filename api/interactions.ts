import { handleInteraction, type Interaction } from "../src/bot.js";
import { verifyDiscordRequest } from "../src/verify.js";

/**
 * Interactions Endpoint URL untuk Discord Developer Portal:
 *   https://<nama-project>.vercel.app/api/interactions
 */
export async function POST(request: Request): Promise<Response> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return new Response("DISCORD_PUBLIC_KEY belum diisi.", { status: 500 });

  const rawBody = await request.text();
  const valid = verifyDiscordRequest(rawBody, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), publicKey);
  if (!valid) return new Response("Signature tidak valid.", { status: 401 });

  const interaction = JSON.parse(rawBody) as Interaction;
  return Response.json(await handleInteraction(interaction));
}

export function GET(): Response {
  const missing = ["DISCORD_TOKEN", "DISCORD_PUBLIC_KEY"].filter((name) => !process.env[name]);
  const redis = Boolean(process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL);
  if (!redis) missing.push("Upstash Redis (KV_REST_API_URL / UPSTASH_REDIS_REST_URL)");
  const text = missing.length === 0 ? "✅ Bot siap. Pasang URL ini sebagai Interactions Endpoint URL di Discord Developer Portal." : `⚠️ Belum diisi: ${missing.join(", ")}`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
