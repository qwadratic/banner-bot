import { BotKeyboard, InputMedia, type TelegramClient } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, touchSession, createSession } from "../session.js";
import type { Session } from "../session.js";
import { devAlert } from "../devAlert.js";
import { analyzeMessage, reanalyzeForStage } from "../flow/analyze.js";
import { assemblePrompt, generateImage } from "../flow/generate.js";
import { saveFeedback } from "../flow/feedback.js";
import {
  stageStepText, stageStepKeyboard,
  styleStepText, styleStepKeyboard,
} from "../ui/hintSelector.js";
import { analysisCardText, analysisCardKeyboard } from "../ui/analysisCard.js";

export async function handleCallback(tg: TelegramClient, cb: CallbackQueryContext): Promise<void> {
  const data = cb.dataStr;
  if (!data) {
    await cb.answer({});
    return;
  }

  const userId = cb.user.id;
  const session = globalState.activeSession;

  if (!session || session.userId !== userId) {
    await cb.answer({ text: "Немає активної сесії." });
    return;
  }

  touchSession(session);

  try {
    // Parse callback data
    const [action, ...rest] = data.split(":");
    const value = rest.join(":");

    switch (action) {
      case "hint_stage":
        await handleHintStage(cb, session, value);
        break;
      case "hint_style":
        await handleHintStyle(cb, session, value);
        break;
      case "hints":
        await handleHints(tg, cb, session, value);
        break;
      case "generate":
        await handleGenerate(tg, cb, session, value);
        break;
      case "stage":
        await handleStage(tg, cb, session, value);
        break;
      case "prompt":
        await handlePrompt(tg, cb, session);
        break;
      case "feedback":
        await handleFeedback(tg, cb, session, value);
        break;
      case "session":
        await handleSession(tg, cb, session, value);
        break;
      case "interrupt":
        await handleInterrupt(tg, cb, session, value);
        break;
      default:
        await cb.answer({ text: "Unknown action" });
    }
  } catch (err) {
    await devAlert("onCallback", err, { userId, data, phase: session.phase });
    try {
      await cb.answer({ text: "Помилка — перевірте алерти" });
    } catch {
      // ignore
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Deactivate an interactive message: replace text with an action note and
 * strip the inline keyboard. Works for text messages (replaces text) and
 * media messages (updates caption). Falls back to just removing the keyboard
 * if the text edit fails.
 */
async function deactivateMessage(cb: CallbackQueryContext, note: string): Promise<void> {
  try {
    await cb.editMessage({ text: note });
  } catch {
    try {
      await cb.editMessage({ replyMarkup: BotKeyboard.inline([]) });
    } catch {
      // Ignore — message may have been deleted
    }
  }
}

// ── Hint selection (two-step) ────────────────────────────────────────────

async function handleHintStage(cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (session.phase !== "HINT_STAGE") {
    await cb.answer({});
    return;
  }

  // Toggle: tap same to deselect
  if (session.selectedHints.stage === value) {
    delete session.selectedHints.stage;
  } else {
    session.selectedHints.stage = value;
  }

  await cb.answer({});
  await cb.editMessage({
    text: stageStepText(session),
    replyMarkup: stageStepKeyboard(session),
  });
}

async function handleHintStyle(cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (session.phase !== "HINT_STYLE") {
    await cb.answer({});
    return;
  }

  if (session.selectedHints.style === value) {
    delete session.selectedHints.style;
  } else {
    session.selectedHints.style = value;
  }

  await cb.answer({});
  await cb.editMessage({
    text: styleStepText(session),
    replyMarkup: styleStepKeyboard(session),
  });
}

async function handleHints(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "next") {
    // Stage step → Style step
    if (session.phase !== "HINT_STAGE") {
      await cb.answer({});
      return;
    }
    session.phase = "HINT_STYLE";
    await cb.answer({});
    await cb.editMessage({
      text: styleStepText(session),
      replyMarkup: styleStepKeyboard(session),
    });
  } else if (value === "skip_stage") {
    // Skip stage, go to style step
    if (session.phase !== "HINT_STAGE") {
      await cb.answer({});
      return;
    }
    delete session.selectedHints.stage;
    session.phase = "HINT_STYLE";
    await cb.answer({});
    await cb.editMessage({
      text: styleStepText(session),
      replyMarkup: styleStepKeyboard(session),
    });
  } else if (value === "back_to_stage") {
    // Style step → back to Stage step
    if (session.phase !== "HINT_STYLE") {
      await cb.answer({});
      return;
    }
    session.phase = "HINT_STAGE";
    await cb.answer({});
    await cb.editMessage({
      text: stageStepText(session),
      replyMarkup: stageStepKeyboard(session),
    });
  } else if (value === "skip_style") {
    // Skip style, run analysis
    if (session.phase !== "HINT_STYLE") {
      await cb.answer({});
      return;
    }
    delete session.selectedHints.style;
    await cb.answer({});
    await runAnalysis(tg, cb, session);
  } else if (value === "confirm") {
    // Style step confirmed, run analysis
    if (session.phase !== "HINT_STYLE") {
      await cb.answer({});
      return;
    }
    await cb.answer({});
    await runAnalysis(tg, cb, session);
  } else {
    await cb.answer({});
  }
}

// ── Analysis ─────────────────────────────────────────────────────────────

async function runAnalysis(tg: TelegramClient, cb: CallbackQueryContext, session: Session): Promise<void> {
  session.phase = "ANALYZING";

  await cb.editMessage({ text: CONFIG.ui.analyzing });

  try {
    const result = await analyzeMessage(session.inputText, session.selectedHints);

    session.detectedStage = result.detectedStage;
    session.stageConfidence = result.confidence;
    session.modelAgreesWithHint = result.modelAgreesWithHint;
    session.disagreementReason = result.disagreementReason;
    session.modules = result.modules;
    session.sonnetOutput = result;
    session.userOverrides = {};

    session.generatedPrompt = assemblePrompt(result.modules, {}, result);
    session.phase = "ANALYSIS_READY";

    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
  } catch (err) {
    await devAlert("onCallback / runAnalysis", err, { userId: session.userId });
    session.phase = "HINT_STYLE";
    await cb.editMessage({
      text: CONFIG.ui.retryError,
      replyMarkup: styleStepKeyboard(session),
    });
  }
}

// ── Generation ───────────────────────────────────────────────────────────

async function handleGenerate(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "confirm") {
    await doGenerate(tg, cb, session, false, "✅ Генерацію запущено");
  } else if (value === "same") {
    await doGenerate(tg, cb, session, false, "🔁 Повторна генерація");
  } else if (value === "variation") {
    await doGenerate(tg, cb, session, true, "🎲 Варіація");
  } else {
    await cb.answer({});
  }
}

async function doGenerate(tg: TelegramClient, cb: CallbackQueryContext, session: Session, variation: boolean, sourceNote: string): Promise<void> {
  if (!session.modules || !session.sonnetOutput) {
    await cb.answer({ text: "Немає даних для генерації" });
    return;
  }

  session.phase = "GENERATING";
  await cb.answer({});
  await deactivateMessage(cb, sourceNote);
  await tg.sendText(session.userId, CONFIG.ui.generating);

  try {
    if (variation) {
      // Swap one random module for variation
      const categories = Object.keys(session.modules) as Array<keyof typeof session.modules>;
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const options = CONFIG.moduleOptions[cat] ?? [];
      const current = (session.userOverrides[cat] ?? session.modules[cat]) as string;
      const alternatives = options.filter((o: string) => o !== current);
      if (alternatives.length > 0) {
        session.userOverrides[cat] = alternatives[Math.floor(Math.random() * alternatives.length)];
      }
    }

    const prompt = assemblePrompt(session.modules, session.userOverrides, session.sonnetOutput);
    session.generatedPrompt = prompt;

    const imageBuffer = await generateImage(prompt, session.detectedStage ?? "FOMO");
    session.generationCount++;

    await tg.sendMedia(
      session.userId,
      InputMedia.photo(new Uint8Array(imageBuffer), { fileName: "banner.png" }),
      {
        caption: `🎨 Банер згенеровано  (#${session.generationCount})`,
        replyMarkup: resultKeyboard(),
      },
    );

    session.phase = "RESULT_READY";
  } catch (err) {
    await devAlert("onCallback / doGenerate", err, { userId: session.userId });
    session.phase = "RESULT_READY";
    await tg.sendText(session.userId, CONFIG.ui.retryError, {
      replyMarkup: resultKeyboard(),
    });
  }
}

function resultKeyboard() {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("▸ Переглянути промпт", "prompt:show"),
      BotKeyboard.callback("🔁 Повторити", "generate:same"),
    ],
    [
      BotKeyboard.callback("🎲 Варіація", "generate:variation"),
      BotKeyboard.callback("⭐ Оцінити", "feedback:start"),
    ],
    [BotKeyboard.callback("❌ Завершити сесію", "session:end")],
  ]);
}

// ── Stage management ─────────────────────────────────────────────────────

async function handleStage(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "use_model") {
    // User accepts the model's suggested stage — clear conflict state
    session.modelAgreesWithHint = true;
    session.disagreementReason = null;
    session.selectedHints.stage = session.detectedStage ?? undefined;

    session.phase = "ANALYSIS_READY";
    // Re-assemble prompt with accepted stage (modules unchanged)
    if (session.modules && session.sonnetOutput) {
      session.generatedPrompt = assemblePrompt(session.modules, session.userOverrides, session.sonnetOutput);
    }
    await cb.answer({});
    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
  } else if (value === "keep_user") {
    // User insists on their hint stage — re-derive modules for that stage
    const userStage = session.selectedHints.stage;
    if (userStage) {
      await cb.answer({});
      await reanalyzeWithStage(tg, cb, session, userStage);
    } else {
      await cb.answer({});
    }
  } else {
    await cb.answer({});
  }
}

async function reanalyzeWithStage(tg: TelegramClient, cb: CallbackQueryContext, session: Session, stage: string): Promise<void> {
  session.phase = "ANALYZING";
  await cb.editMessage({ text: CONFIG.ui.analyzing });

  try {
    const result = await reanalyzeForStage(session.inputText, stage, {
      style: session.selectedHints.style,
    });

    session.detectedStage = result.detectedStage;
    session.stageConfidence = result.confidence;
    session.modelAgreesWithHint = true;
    session.disagreementReason = null;
    session.modules = result.modules;
    session.sonnetOutput = result;
    session.userOverrides = {};

    session.generatedPrompt = assemblePrompt(result.modules, {}, result);
    session.phase = "ANALYSIS_READY";

    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
  } catch (err) {
    await devAlert("onCallback / reanalyzeWithStage", err, { userId: session.userId, stage });
    session.phase = "ANALYSIS_READY";
    await cb.editMessage({
      text: CONFIG.ui.retryError,
      replyMarkup: analysisCardKeyboard(session),
    });
  }
}

// ── Prompt viewing ───────────────────────────────────────────────────────

async function handlePrompt(tg: TelegramClient, cb: CallbackQueryContext, session: Session): Promise<void> {
  await cb.answer({});
  if (session.generatedPrompt) {
    // Send as new message (spec: never edit/delete)
    const text = session.generatedPrompt.length > 4096
      ? session.generatedPrompt.slice(0, 4093) + "..."
      : session.generatedPrompt;
    await tg.sendText(session.userId, text);
  } else {
    await tg.sendText(session.userId, "Промпт не знайдено.");
  }
}

// ── Feedback ─────────────────────────────────────────────────────────────

async function handleFeedback(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "start") {
    session.phase = "AWAITING_FEEDBACK_RATING";
    await cb.answer({});
    await deactivateMessage(cb, "⭐ Оцінка");
    await tg.sendText(session.userId, "Як вам результат?", {
      replyMarkup: BotKeyboard.inline([
        [1, 2, 3, 4, 5].map((n) =>
          BotKeyboard.callback(String(n), `feedback:rate:${n}`),
        ),
      ]),
    });
  } else if (value.startsWith("rate:")) {
    const rating = parseInt(value.slice(5), 10);
    if (rating >= 1 && rating <= 5) {
      session.pendingRating = rating;
      session.phase = "AWAITING_FEEDBACK_COMMENT";
      await cb.answer({});
      await cb.editMessage({
        text: "Дякую! Є коментарі? (необов'язково)",
        replyMarkup: BotKeyboard.inline([
          [BotKeyboard.callback("Пропустити", "feedback:skip")],
        ]),
      });
    } else {
      await cb.answer({});
    }
  } else if (value === "skip") {
    if (session.pendingRating != null) {
      saveFeedback(session, session.pendingRating, null);
      session.pendingRating = null;
    }
    session.phase = "RESULT_READY";
    await cb.answer({ text: "Дякую!" });
    await cb.editMessage({
      text: "Дякую за відгук! 🙏",
      replyMarkup: resultKeyboard(),
    });
  } else {
    await cb.answer({});
  }
}

// ── Session end ──────────────────────────────────────────────────────────

async function handleSession(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "end") {
    globalState.activeSession = null;
    await cb.answer({});
    await deactivateMessage(cb, "❌ Сесію завершено");
    await tg.sendText(session.userId, CONFIG.ui.sessionEnded);
  } else {
    await cb.answer({});
  }
}

// ── Interruption ─────────────────────────────────────────────────────────

async function handleInterrupt(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "cancel") {
    // Cancel current session, start new one with the pending text
    const pendingText = session.pendingInterruptText;
    const userId = session.userId;

    // Reset session
    const newSession = createSession(userId);
    newSession.phase = "WAITING_FOR_MESSAGE";
    globalState.activeSession = newSession;

    await cb.answer({});
    await cb.editMessage({ text: "Сесію скасовано." });

    // Process the pending text as a new message
    if (pendingText) {
      const { classifyMessage } = await import("../flow/gate.js");
      try {
        const result = await classifyMessage(pendingText);
        if (!result.isFunnelMessage) {
          await tg.sendText(userId, CONFIG.ui.notFunnelMsg);
          return;
        }
        newSession.inputText = pendingText;
        newSession.phase = "HINT_STAGE";
        await tg.sendText(userId, stageStepText(newSession), {
          replyMarkup: stageStepKeyboard(newSession),
        });
      } catch (err) {
        await devAlert("onCallback / interrupt:cancel / gate", err, { userId });
        await tg.sendText(userId, CONFIG.ui.retryError);
      }
    }
  } else if (value === "continue") {
    // Restore previous phase
    session.pendingInterruptText = null;
    session.phase = session.previousPhase ?? "WAITING_FOR_MESSAGE";
    session.previousPhase = null;
    await cb.answer({});
    await cb.editMessage({ text: "Продовжуємо поточну сесію." });
  } else {
    await cb.answer({});
  }
}
