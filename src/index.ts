import "dotenv/config";
import { TelegramClient } from "@mtcute/node";
import { Dispatcher } from "@mtcute/dispatcher";
import { devAlert, initDevAlert } from "./devAlert.js";
import { registerBotHandlers } from "./router.js";
import { devPanelKeyboard, startupMessageText, shutdownMessageText } from "./handlers/onDevPanel.js";
import { initFeedbackDb } from "./db/feedback.js";
import { initRuntimeConfig, seedAdminUserIds } from "./runtimeConfig.js";
import { startSessionTtl } from "./sessionTtl.js";
import { startupSmokeTest } from "./startupSmokeTest.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const DEV_TG_ID = Number(process.env.DEV_TG_ID);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!API_ID || isNaN(API_ID)) throw new Error("API_ID is required");
if (!API_HASH) throw new Error("API_HASH is required");
if (!DEV_TG_ID || isNaN(DEV_TG_ID)) throw new Error("DEV_TG_ID is required");

// Parse admin user IDs from env and seed into runtime config
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n) && n > 0);
seedAdminUserIds(ADMIN_USER_IDS);

const tg = new TelegramClient({
  apiId: API_ID,
  apiHash: API_HASH,
});

const dp = Dispatcher.for(tg);

// Initialize dev alert system
initDevAlert(tg, DEV_TG_ID);

// Initialize feedback database
initFeedbackDb();

// Initialize runtime config (load overrides from disk)
initRuntimeConfig();

// Register global error handlers BEFORE bot.start()
process.on("uncaughtException", (error) => {
  devAlert("uncaughtException", error);
  // Do not exit — keep bot running
});

process.on("unhandledRejection", (reason) => {
  devAlert("unhandledRejection", reason);
  // Do not exit — keep bot running
});

// Register bot handlers
registerBotHandlers(tg, dp, DEV_TG_ID);

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
      { _: "botCommand", command: "config", description: "Налаштування" },
      { _: "botCommand", command: "dev", description: "Dev panel" },
    ],
  });

  const startupKeyboard = devPanelKeyboard();

  await tg.sendText(
    DEV_TG_ID,
    startupMessageText(),
    { replyMarkup: startupKeyboard },
  );

  // Run startup smoke test (non-blocking)
  startupSmokeTest(tg, DEV_TG_ID).catch((err) => {
    devAlert("startupSmokeTest / unhandled", err);
  });

  // Shutdown handler — send message to dev before exit
  let shuttingDown = false;
  const onShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    try {
      await tg.sendText(DEV_TG_ID, shutdownMessageText());
    } catch {
      // best-effort
    }
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", () => onShutdown("SIGINT"));
  process.on("SIGTERM", () => onShutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
