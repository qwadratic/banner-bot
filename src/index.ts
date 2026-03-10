import "dotenv/config";
import { TelegramClient, BotKeyboard } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
import { devAlert, initDevAlert } from "./devAlert.js";
import { registerDevPanel } from "./handlers/onDevPanel.js";
import { registerBotHandlers } from "./router.js";
import { initFeedbackDb } from "./db/feedback.js";
import { startSessionTtl } from "./sessionTtl.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const DEV_TG_ID = Number(process.env.DEV_TG_ID);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!API_ID || isNaN(API_ID)) throw new Error("API_ID is required");
if (!API_HASH) throw new Error("API_HASH is required");
if (!DEV_TG_ID || isNaN(DEV_TG_ID)) throw new Error("DEV_TG_ID is required");

// Parse admin user IDs
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n) && n > 0);

const tg = new TelegramClient({
  apiId: API_ID,
  apiHash: API_HASH,
});

const dp = Dispatcher.for(tg);

// Initialize dev alert system
initDevAlert(tg, DEV_TG_ID);

// Initialize feedback database
initFeedbackDb();

// Register global error handlers BEFORE bot.start()
process.on("uncaughtException", (error) => {
  devAlert("uncaughtException", error);
  // Do not exit — keep bot running
});

process.on("unhandledRejection", (reason) => {
  devAlert("unhandledRejection", reason);
  // Do not exit — keep bot running
});

// Register dev panel handler (must be first — takes priority)
registerDevPanel(tg, dp, DEV_TG_ID);

// Register bot handlers for admin users
registerBotHandlers(tg, dp, ADMIN_USER_IDS, DEV_TG_ID);

// Start session TTL checker
startSessionTtl(tg);

// Start the bot
async function main() {
  const self = await tg.start({ botToken: BOT_TOKEN });
  console.log(`Bot started as @${self.username ?? self.displayName}`);
  console.log(`Dev TG ID: ${DEV_TG_ID}`);
  console.log(`Admin user IDs: ${ADMIN_USER_IDS.join(", ") || "(none)"}`);
  console.log(`PID: ${process.pid}`);

  // Set bot commands visible in menu
  await tg.call({
    _: "bots.setBotCommands",
    scope: { _: "botCommandScopeDefault" },
    langCode: "",
    commands: [
      { _: "botCommand", command: "start", description: "Почати" },
      { _: "botCommand", command: "cancel", description: "Скасувати сесію" },
    ],
  });

  await tg.sendText(
    DEV_TG_ID,
    `🟢 Bot started\n\n@${self.username ?? self.displayName}\nNode ${process.version}\nPID: ${process.pid}\n${new Date().toISOString()}`,
    {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("📊 Status", "dev:status"),
          BotKeyboard.callback("🔬 Health check", "dev:healthcheck"),
        ],
        [
          BotKeyboard.callback("🔄 Restart", "dev:restart"),
          BotKeyboard.callback("⬇️ Update & restart", "dev:update"),
        ],
        [BotKeyboard.url("🖥 Shelley", "https://banner-bot.shelley.exe.xyz")],
      ]),
    },
  );
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
