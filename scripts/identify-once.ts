/**
 * Discord mensyaratkan bot pernah login ke Gateway minimal SEKALI sebelum bisa mengirim pesan
 * lewat REST API (dipakai untuk DM role & pesan timer). Bila bot ini belum pernah dinyalakan
 * dengan cara lama, jalankan sekali saja:
 *   npm run identify-once
 * Skrip ini login sebentar ke Gateway lalu keluar.
 */
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN belum diisi di file .env.");

const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
const timeout = setTimeout(() => {
  console.error("❌ Tidak ada respons READY dari Discord dalam 20 detik. Periksa token.");
  process.exit(1);
}, 20_000);

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(String(event.data)) as { op: number; t?: string; d?: { user?: { username: string } } };
  if (payload.op === 10) {
    socket.send(JSON.stringify({ op: 2, d: { token, intents: 0, properties: { os: process.platform, browser: "vercel-bot", device: "vercel-bot" } } }));
  } else if (payload.op === 0 && payload.t === "READY") {
    console.log(`✅ Bot ${payload.d?.user?.username ?? ""} berhasil login ke Gateway. Sekarang bot bisa mengirim pesan lewat Vercel.`);
    clearTimeout(timeout);
    socket.close(1000);
  } else if (payload.op === 9) {
    console.error("❌ Login ditolak Discord (token salah?).");
    process.exit(1);
  }
});
socket.addEventListener("close", () => process.exit(0));
