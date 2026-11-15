import { createPublicKey, verify, type KeyObject } from "node:crypto";

// Header DER SPKI untuk kunci publik Ed25519 mentah 32 byte.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const keyCache = new Map<string, KeyObject>();

function publicKey(hex: string): KeyObject {
  let key = keyCache.get(hex);
  if (!key) {
    key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
    keyCache.set(hex, key);
  }
  return key;
}

/** Memverifikasi bahwa request benar-benar dikirim Discord (wajib untuk Interactions Endpoint). */
export function verifyDiscordRequest(rawBody: string, signature: string | null, timestamp: string | null, publicKeyHex: string): boolean {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  try {
    return verify(null, Buffer.from(timestamp + rawBody), publicKey(publicKeyHex), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
