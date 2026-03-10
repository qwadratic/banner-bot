import type { TelegramClient } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
import type { MessageContext } from "@mtcute/dispatcher";
import { globalState } from "./session.js";
import { handleStart, handleCancel } from "./handlers/onCommand.js";
import { handleMessage } from "./handlers/onMessage.js";
import { handleCallback } from "./handlers/onCallback.js";

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

  // Text messages from authorized users (non-command)
  dp.onNewMessage(filters.text, async (msg) => {
    if (!isAuthorizedUser(msg)) return;
    if (msg.text?.startsWith("/")) return;
    await handleMessage(tg, msg);
  });

  // Callback queries from authorized users (non-dev callbacks)
  dp.onCallbackQuery(async (cb) => {
    const uid = cb.user.id;
    if (uid === devTgId && !globalState.devUserMode) return;
    if (!isAuthorized(uid)) return;
    if (cb.dataStr?.startsWith("dev:")) return;
    await handleCallback(tg, cb);
  });
}
