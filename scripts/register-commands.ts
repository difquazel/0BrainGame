/**
 * Mendaftarkan slash command ke Discord. Jalankan sekali (dan setiap kali commands.ts berubah):
 *   npm run register
 * Membaca DISCORD_TOKEN (dan opsional DISCORD_GUILD_ID) dari file .env.
 */
import { commandData } from "../src/commands.js";
import { discordRequest } from "../src/discord-api.js";

const application = await discordRequest<{ id: string; name: string }>("GET", "/applications/@me");
const guildId = process.env.DISCORD_GUILD_ID;

if (guildId) {
  await discordRequest("PUT", `/applications/${application.id}/guilds/${guildId}/commands`, commandData);
  console.log(`✅ ${commandData.length} slash command didaftarkan untuk "${application.name}" di server ${guildId} (langsung muncul).`);
} else {
  await discordRequest("PUT", `/applications/${application.id}/commands`, commandData);
  console.log(`✅ ${commandData.length} slash command global didaftarkan untuk "${application.name}". Bisa butuh beberapa menit sampai muncul.`);
}
