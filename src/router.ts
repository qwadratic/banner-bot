import { BotKeyboard, type TelegramClient } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
import type { MessageContext } from "@mtcute/dispatcher";
import { globalState } from "./session.js";
import { handleStart, handleCancel } from "./handlers/onCommand.js";
import { handleMessage } from "./handlers/onMessage.js";
import { handleCallback } from "./handlers/onCallback.js";
import { handleDevCallback } from "./handlers/onDevPanel.js";
import { handleDevConfigCallback, handleDevConfigInput } from "./handlers/onDevConfig.js";

export function registerBotHandlers(
  tg: TelegramClient,
  dp: Dispatcher,
  adminUserIds: number[],
  devTgId: number,
): void {
  const isAuthorized = (userId: number): boolean => {
    return adminUserIds.includes(userId) || userId === devTgId;
  };

  const isAuthorizedUser = (msg: MessageContext): boolean => {
    const uid = msg.sender?.id;
    if (!uid) return false;
    if (uid === devTgId && !globalState.devUserMode) return false;
    return isAuthorized(uid);
  };

  // /start command from authorized users
  dp.onNewMessage(filters.command("start"), async (msg) => {
    if (!isAuthorizedUser(msg)) return;
    await handleStart(tg, msg);
  });

  // /cancel command from authorized users
  dp.onNewMessage(filters.command("cancel"), async (msg) => {
    if (!isAuthorizedUser(msg)) return;
    await handleCancel(tg, msg);
  });

  // /dev command — switch dev user back to dev mode
  dp.onNewMessage(filters.command("dev"), async (msg) => {
    const uid = msg.sender?.id;
    if (uid !== devTgId) return;

    globalState.devUserMode = false;
    globalState.devConfigAwait = null;

    // End active session if it belongs to the dev user
    if (globalState.activeSession?.userId === uid) {
      globalState.activeSession = null;
    }

    await tg.sendText(uid, "🛠 Dev Panel", {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("📊 Status", "dev:status"),
          BotKeyboard.callback("🔬 Health check", "dev:healthcheck"),
        ],
        [
          BotKeyboard.callback("🔄 Restart", "dev:restart"),
          BotKeyboard.callback("⬇️ Update & restart", "dev:update"),
        ],
        [BotKeyboard.callback("⚙️ Config", "cfg:main")],
        [BotKeyboard.callback("👤 User mode", "dev:usermode")],
      ]),
    });
  });

  // Messages from dev user — check for config input awaiting first
  dp.onNewMessage(async (msg) => {
    const uid = msg.sender?.id;
    if (uid !== devTgId) return;
    if (msg.text?.startsWith("/")) return;

    // If dev is awaiting config input (text or photo), handle it
    if (globalState.devConfigAwait && !globalState.devUserMode) {
      const handled = await handleDevConfigInput(tg, msg, devTgId);
      if (handled) return;
    }

    // Otherwise, fall through to regular message handling only if in user mode
    if (!globalState.devUserMode) return;
    await handleMessage(tg, msg);
  });

  // Text messages from authorized non-dev users (non-command)
  dp.onNewMessage(filters.text, async (msg) => {
    const uid = msg.sender?.id;
    if (!uid) return;
    if (uid === devTgId) return; // handled above
    if (!isAuthorized(uid)) return;
    if (msg.text?.startsWith("/")) return;
    await handleMessage(tg, msg);
  });

  // Single unified callback handler for ALL inline button clicks
  dp.onCallbackQuery(async (cb) => {
    const uid = cb.user.id;

    // Dev config callbacks — only for dev user
    if (cb.dataStr?.startsWith("cfg:")) {
      if (uid === devTgId) {
        await handleDevConfigCallback(tg, cb, devTgId);
      } else {
        await cb.answer({});
      }
      return;
    }

    // Dev panel callbacks — only for dev user
    if (cb.dataStr?.startsWith("dev:")) {
      if (uid === devTgId) {
        await handleDevCallback(tg, cb, devTgId);
      } else {
        await cb.answer({});
      }
      return;
    }

    // Regular callbacks — dev user must be in user mode
    if (uid === devTgId && !globalState.devUserMode) {
      await cb.answer({});
      return;
    }
    if (!isAuthorized(uid)) {
      await cb.answer({});
      return;
    }
    await handleCallback(tg, cb);
  });
}
