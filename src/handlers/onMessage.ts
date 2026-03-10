import { BotKeyboard, type TelegramClient } from "@mtcute/node";
import type { MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, createSession, touchSession } from "../session.js";
import { devAlert } from "../devAlert.js";
import { classifyMessage } from "../flow/gate.js";
import { analyzeMessage } from "../flow/analyze.js";
import { hintSelectorText, hintSelectorKeyboard } from "../ui/hintSelector.js";
import { analysisCardText, analysisCardKeyboard } from "../ui/analysisCard.js";

export async function handleMessage(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  const text = msg.text?.trim();
  if (!text) return;

  const session = globalState.activeSession;

  // No active session — create one and process message
  if (!session || session.userId !== userId) {
    // Check if another user's session is active
    if (session && session.userId !== userId) {
      await tg.sendText(userId, CONFIG.ui.busyError);
      return;
    }

    const newSession = createSession(userId);
    newSession.phase = "WAITING_FOR_MESSAGE";
    globalState.activeSession = newSession;
    await processIncomingText(tg, userId, text);
    return;
  }

  touchSession(session);

  // AWAITING_FEEDBACK_COMMENT — user typed a comment
  if (session.phase === "AWAITING_FEEDBACK_COMMENT") {
    const { saveFeedback } = await import("../flow/feedback.js");
    saveFeedback(session, session.pendingRating!, text);
    session.pendingRating = null;
    session.phase = "RESULT_READY";
    await tg.sendText(userId, "Дякую за відгук! 🙏");
    return;
  }

  // WAITING_FOR_MESSAGE — process the text
  if (session.phase === "WAITING_FOR_MESSAGE") {
    await processIncomingText(tg, userId, text);
    return;
  }

  // Any other phase — interruption
  session.pendingInterruptText = text;
  session.previousPhase = session.phase;
  session.phase = "AWAITING_INTERRUPT_RESOLUTION";

  await tg.sendText(userId, CONFIG.ui.interruptPrompt, {
    replyMarkup: BotKeyboard.inline([
      [
        BotKeyboard.callback("🔴 Скасувати і почати знову", "interrupt:cancel"),
        BotKeyboard.callback("↩️ Продовжити поточну", "interrupt:continue"),
      ],
    ]),
  });
}

async function processIncomingText(tg: TelegramClient, userId: number, text: string): Promise<void> {
  const session = globalState.activeSession!;

  try {
    const result = await classifyMessage(text);

    if (!result.isFunnelMessage) {
      await tg.sendText(userId, CONFIG.ui.notFunnelMsg);
      return;
    }

    session.inputText = text;
    session.phase = "HINT_SELECTION";

    await tg.sendText(userId, hintSelectorText(), {
      replyMarkup: hintSelectorKeyboard(session),
    });
  } catch (err) {
    await devAlert("onMessage / gate classification", err, { userId, phase: session.phase });
    await tg.sendText(userId, CONFIG.ui.retryError);
  }
}
