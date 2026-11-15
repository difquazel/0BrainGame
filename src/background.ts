import { waitUntil } from "@vercel/functions";

const pending = new Set<Promise<unknown>>();

/**
 * Menjalankan pekerjaan setelah respons dikirim ke Discord (Discord hanya memberi 3 detik).
 * Di Vercel, waitUntil menjaga function tetap hidup sampai pekerjaan ini selesai.
 */
export function runInBackground(task: () => Promise<unknown>): void {
  const promise = task()
    .catch((error: unknown) => console.error("Pekerjaan latar belakang gagal:", error))
    .finally(() => pending.delete(promise));
  pending.add(promise);
  waitUntil(promise);
}

/** Hanya untuk pengujian: tunggu semua pekerjaan latar belakang selesai. */
export async function flushBackground(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
