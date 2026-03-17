import { BotKeyboard, type TelegramClient } from "@mtcute/node";
import type { MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { createSession, getSession, setSession, touchSession } from "../session.js";
import { devAlert } from "../devAlert.js";
import { classifyMessage, GateTimeoutError } from "../flow/gate.js";
import { stageStepText, stageStepKeyboard } from "../ui/hintSelector.js";

export async function handleMessage(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  const text = msg.text?.trim();
  if (!text) return;

  let session = getSession(userId);

  // No active session for this user — create one
  if (!session) {
    const newSession = createSession(userId);
    newSession.phase = "WAITING_FOR_MESSAGE";
    setSession(userId, newSession);
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
    await tg.sendText(userId, "Дякую за відгук! 🙏", {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("🔁 Повторити", "generate:same"),
          BotKeyboard.callback("🎲 Варіація", "generate:variation"),
        ],
        [BotKeyboard.callback("❌ Завершити сесію", "session:end")],
      ]),
    });
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
  const session = getSession(userId)!;

  try {
    const result = await classifyMessage(text);

    if (!result.isFunnelMessage) {
      await tg.sendText(userId, CONFIG.ui.notFunnelMsg);
      return;
    }

    session.inputText = text;
    session.phase = "HINT_STAGE";

    await tg.sendText(userId, stageStepText(session), {
      replyMarkup: stageStepKeyboard(session),
    });
  } catch (err) {
    await devAlert("onMessage / gate classification", err, { userId, phase: session.phase });
    if (err instanceof GateTimeoutError) {
      await tg.sendText(userId, CONFIG.ui.timeoutError);
    } else {
      await tg.sendText(userId, CONFIG.ui.retryError);
    }
  }
}
