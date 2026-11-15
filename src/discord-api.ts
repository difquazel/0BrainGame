/** Pembungkus kecil Discord REST API v10 (tanpa discord.js, agar cold start di Vercel ringan). */

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  thumbnail?: { url: string };
  timestamp?: string;
}

export interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4;
  custom_id: string;
  label: string;
  emoji?: { name: string };
}

export interface ActionRow {
  type: 1;
  components: Button[];
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  /** 64 = ephemeral (hanya terlihat oleh pengguna yang memicu interaksi). */
  flags?: number;
  allowed_mentions?: { parse: Array<"users" | "roles" | "everyone"> };
}

export const EPHEMERAL = 64;

function apiBase(): string {
  return process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10";
}

function botToken(): string {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN belum diisi di Environment Variables.");
  return token;
}

const sleep = (ms: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, ms));

export class DiscordApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly body: string,
    path: string,
  ) {
    super(`Discord API ${status} pada ${path}: ${body.slice(0, 300)}`);
  }
}

/** Request ke Discord dengan penanganan rate limit (429) sederhana. */
export async function discordRequest<T = unknown>(method: string, path: string, body?: unknown, options: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) headers.Authorization = `Bot ${botToken()}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${apiBase()}${path}`, init);
    if (response.status === 429 && attempt < 2) {
      const info = (await response.json().catch(() => ({}))) as { retry_after?: number };
      await sleep(Math.min(5000, Math.ceil((info.retry_after ?? 1) * 1000)));
      continue;
    }
    const text = await response.text();
    if (!response.ok) throw new DiscordApiError(response.status, text, path);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  throw new Error(`Discord API terus membatasi request ke ${path}.`);
}

export async function sendChannelMessage(channelId: string, payload: MessagePayload): Promise<void> {
  await discordRequest("POST", `/channels/${channelId}/messages`, payload);
}

/** Mengirim DM. Mengembalikan false bila pengguna menutup DM dari anggota server. */
export async function sendDirectMessage(userId: string, content: string, attempts = 2): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const channel = await discordRequest<{ id: string }>("POST", "/users/@me/channels", { recipient_id: userId });
      await sendChannelMessage(channel.id, { content });
      return true;
    } catch (error) {
      if (attempt === attempts - 1) console.warn(`DM untuk user ${userId} gagal dikirim:`, error instanceof Error ? error.message : error);
      else await sleep(400);
    }
  }
  return false;
}

/**
 * Pesan lanjutan untuk sebuah interaksi. Token interaksi baru aktif setelah Discord menerima
 * respons awal kita, jadi 404 (Unknown Webhook) di awal dicoba ulang sebentar.
 */
async function webhookRequest(method: string, path: string, payload: MessagePayload): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await discordRequest(method, path, payload, { auth: false });
      return;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404 || attempt === 3) throw error;
      await sleep(500);
    }
  }
}

export function followUp(applicationId: string, interactionToken: string, payload: MessagePayload): Promise<void> {
  return webhookRequest("POST", `/webhooks/${applicationId}/${interactionToken}`, payload);
}

export function editOriginal(applicationId: string, interactionToken: string, payload: MessagePayload): Promise<void> {
  return webhookRequest("PATCH", `/webhooks/${applicationId}/${interactionToken}/messages/@original`, payload);
}
