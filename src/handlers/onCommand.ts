import type { TelegramClient } from "@mtcute/node";
import type { MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, createSession, getSession, setSession, endSession } from "../session.js";
import { consumeInviteToken, getAdminUserIds } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";

export async function handleStart(tg: TelegramClient, msg: MessageContext, devTgId: number): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  // Check for invite deep-link: /start invite_<TOKEN>
  const text = msg.text?.trim() ?? "";
  const match = text.match(/^\/start\s+invite_(.+)$/);
  if (match) {
    const token = match[1];
    const isAlreadyAdmin = getAdminUserIds().includes(userId) || userId === devTgId;
    if (isAlreadyAdmin) {
      await tg.sendText(userId, "You already have access.");
      return;
    }
    const consumed = consumeInviteToken(token, userId);
    if (consumed) {
      const name = msg.sender?.displayName ?? String(userId);
      await tg.sendText(userId, "Access granted! Send /start to begin.");
      await devAlert("invite accepted", `${name} (${userId}) joined via invite link`, { token: token.slice(0, 6) + "…" });
      return;
    } else {
      await tg.sendText(userId, "This invite link is invalid or has already been used.");
      return;
    }
  }

  // End existing session for this user if any
  endSession(userId);

  const session = createSession(userId);
  session.phase = "WAITING_FOR_MESSAGE";
  setSession(userId, session);

  await tg.sendText(userId, CONFIG.ui.welcome);
}

export async function handleCancel(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  endSession(userId);
  await tg.sendText(userId, CONFIG.ui.sessionEnded);
}
