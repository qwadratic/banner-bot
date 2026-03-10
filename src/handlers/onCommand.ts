import type { TelegramClient } from "@mtcute/node";
import type { MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, createSession, touchSession } from "../session.js";

export async function handleStart(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  // If there's an active session, end it
  if (globalState.activeSession) {
    globalState.activeSession = null;
  }

  const session = createSession(userId);
  session.phase = "WAITING_FOR_MESSAGE";
  globalState.activeSession = session;

  await tg.sendText(userId, CONFIG.ui.welcome);
}

export async function handleCancel(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  if (globalState.activeSession?.userId === userId) {
    globalState.activeSession = null;
  }

  await tg.sendText(userId, CONFIG.ui.sessionEnded);
}
