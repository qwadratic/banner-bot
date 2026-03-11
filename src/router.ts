import { BotKeyboard, type TelegramClient } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
import type { MessageContext } from "@mtcute/dispatcher";
import { globalState } from "./session.js";
import { handleStart, handleCancel } from "./handlers/onCommand.js";
import { handleMessage } from "./handlers/onMessage.js";
import { handleCallback } from "./handlers/onCallback.js";
import { handleDevCallback, devPanelKeyboard, startupMessageText } from "./handlers/onDevPanel.js";
import { handleConfigCallback, handleConfigInput } from "./handlers/onDevConfig.js";
import { getAdminUserIds } from "./runtimeConfig.js";

export function registerBotHandlers(
  tg: TelegramClient,
  dp: Dispatcher,
  devTgId: number,
): void {
  const isAuthorized = (userId: number): boolean => {
    return getAdminUserIds().includes(userId) || userId === devTgId;
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

    await tg.sendText(uid, startupMessageText(), {
      replyMarkup: devPanelKeyboard(),
    });
  });

  // /config command — open config panel for any authorized user
  dp.onNewMessage(filters.command("config"), async (msg) => {
    const uid = msg.sender?.id;
    if (!uid || !isAuthorized(uid)) return;

    // For dev user, exit user mode
    if (uid === devTgId) {
      globalState.devUserMode = false;
    }

    await tg.sendText(uid, "⚙️ Configuration", {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("📷 Photos", "cfg:photos"),
          BotKeyboard.callback("📝 Annotations", "cfg:ann"),
        ],
        [
          BotKeyboard.callback("🤖 Prompts", "cfg:pr"),
          BotKeyboard.callback("🎨 Image tpl", "cfg:tpl"),
        ],
        [
          BotKeyboard.callback("📊 Stage modules", "cfg:stg"),
          BotKeyboard.callback("🧩 Module opts", "cfg:mo"),
        ],
        [BotKeyboard.callback("👥 Admins", "dev:admins")],
        [BotKeyboard.callback("✕ Close", "cfg:close")],
      ]),
    });
  });

  // All non-command messages — single handler for all users
  dp.onNewMessage(async (msg) => {
    const uid = msg.sender?.id;
    if (!uid) return;
    if (msg.text?.startsWith("/")) return;

    console.log(`[router] message from ${uid}: ${msg.text?.slice(0, 100) ?? "(no text)"}`);

    // Dev user
    if (uid === devTgId) {
      // Config input awaiting (only outside user mode)
      if (globalState.devConfigAwait?.userId === uid && !globalState.devUserMode) {
        const handled = await handleConfigInput(tg, msg);
        if (handled) return;
      }
      // Only process as regular message if in user mode
      if (!globalState.devUserMode) return;
      await handleMessage(tg, msg);
      return;
    }

    // Non-dev users
    if (!isAuthorized(uid)) return;

    // Config input awaiting
    if (globalState.devConfigAwait?.userId === uid) {
      const handled = await handleConfigInput(tg, msg);
      if (handled) return;
    }

    // Regular text message handling
    if (!msg.text) return;
    await handleMessage(tg, msg);
  });

  // Single unified callback handler for ALL inline button clicks
  dp.onCallbackQuery(async (cb) => {
    const uid = cb.user.id;

    // Config callbacks — any authorized user
    if (cb.dataStr?.startsWith("cfg:")) {
      if (isAuthorized(uid)) {
        await handleConfigCallback(tg, cb);
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
