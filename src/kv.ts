import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

/**
 * Penyimpanan key-value kecil yang dipakai bot. Di Vercel memakai Upstash Redis (REST),
 * karena setiap request berjalan di proses terpisah dan memori/filesystem tidak bertahan.
 * Saat pengujian lokal tanpa Redis, dipakai versi in-memory.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** SET NX PX — true bila key berhasil dibuat (dipakai untuk lock). */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Hapus key hanya bila nilainya masih sama (melepas lock milik sendiri). */
  delIfEquals(key: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
}

const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

class UpstashKV implements KV {
  public constructor(private readonly redis: Redis) {}

  public async get(key: string): Promise<string | null> {
    return asString(await this.redis.get(key));
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.redis.set(key, value, { ex: ttlSeconds });
    else await this.redis.set(key, value);
  }

  public async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(key, value, { nx: true, px: ttlMs })) === "OK";
  }

  public async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  public async delIfEquals(key: string, value: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, [key], [value]);
  }

  public async hget(key: string, field: string): Promise<string | null> {
    return asString(await this.redis.hget(key, field));
  }

  public async hset(key: string, values: Record<string, string>): Promise<void> {
    if (Object.keys(values).length > 0) await this.redis.hset(key, values);
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    const raw = (await this.redis.hgetall<Record<string, unknown>>(key)) ?? {};
    const result: Record<string, string> = {};
    for (const [field, value] of Object.entries(raw)) {
      const text = asString(value);
      if (text !== null) result[field] = text;
    }
    return result;
  }
}

export class MemoryKV implements KV {
  private readonly values = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly hashes = new Map<string, Map<string, string>>();

  private live(key: string): string | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  public async get(key: string): Promise<string | null> {
    return this.live(key);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  public async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(key) !== null) return false;
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  public async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  public async delIfEquals(key: string, value: string): Promise<void> {
    if (this.live(key) === value) this.values.delete(key);
  }

  public async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  public async hset(key: string, values: Record<string, string>): Promise<void> {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(values)) hash.set(field, value);
    this.hashes.set(key, hash);
  }

  public async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
}

let shared: KV | undefined;

/** Membaca kredensial Upstash dari variabel yang dibuat integrasi Vercel (KV_*) atau Upstash langsung (UPSTASH_*). */
export function getKV(): KV {
  if (shared) return shared;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    shared = new UpstashKV(new Redis({ url, token, automaticDeserialization: false }));
  } else if (process.env.VERCEL) {
    throw new Error(
      "Database Redis belum terhubung. Tambahkan Upstash Redis dari tab Storage di Vercel (atau isi UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN), lalu redeploy.",
    );
  } else {
    console.warn("Redis tidak dikonfigurasi; memakai penyimpanan in-memory (hanya untuk pengujian lokal).");
    shared = new MemoryKV();
  }
  return shared;
}

/** Hanya untuk pengujian. */
export function setKV(kv: KV | undefined): void {
  shared = kv;
}

export class LockBusyError extends Error {
  public constructor() {
    super("Bot sedang memproses aksi lain di channel ini. Coba lagi sebentar.");
  }
}

/** Lock sederhana berbasis Redis agar dua interaksi bersamaan tidak saling menimpa state. */
export async function withLock<T>(kv: KV, name: string, task: () => Promise<T>, waitMs = 2500): Promise<T> {
  const key = `lock:${name}`;
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  while (!(await kv.setIfAbsent(key, owner, 15_000))) {
    if (Date.now() >= deadline) throw new LockBusyError();
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  try {
    return await task();
  } finally {
    await kv.delIfEquals(key, owner);
  }
}
