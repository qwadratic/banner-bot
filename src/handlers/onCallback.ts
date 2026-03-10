import { BotKeyboard, InputMedia, type TelegramClient } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, touchSession, createSession } from "../session.js";
import type { Session } from "../session.js";
import { devAlert } from "../devAlert.js";
import { analyzeMessage, reanalyzeForStage } from "../flow/analyze.js";
import { assemblePrompt, generateImage } from "../flow/generate.js";
import { saveFeedback } from "../flow/feedback.js";
import { hintSelectorText, hintSelectorKeyboard } from "../ui/hintSelector.js";
import { analysisCardText, analysisCardKeyboard, stagePickerKeyboard } from "../ui/analysisCard.js";
import { moduleEditorText, moduleEditorKeyboard, moduleCategoryKeyboard } from "../ui/moduleEditor.js";

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
      case "modules":
        await handleModules(tg, cb, session, value);
        break;
      case "module_cat":
        await handleModuleCategory(cb, session, value);
        break;
      case "module":
        await handleModuleSelect(cb, session, rest);
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

// ── Hint selection ───────────────────────────────────────────────────────

async function handleHintStage(cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (session.phase !== "HINT_SELECTION") {
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
    text: hintSelectorText(),
    replyMarkup: hintSelectorKeyboard(session),
  });
}

async function handleHintStyle(cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (session.phase !== "HINT_SELECTION") {
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
    text: hintSelectorText(),
    replyMarkup: hintSelectorKeyboard(session),
  });
}

async function handleHints(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (session.phase !== "HINT_SELECTION") {
    await cb.answer({});
    return;
  }

  if (value === "skip") {
    session.selectedHints = {};
  }

  await cb.answer({});
  await runAnalysis(tg, cb, session);
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
    session.phase = "ANALYSIS_READY";

    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
  } catch (err) {
    await devAlert("onCallback / runAnalysis", err, { userId: session.userId });
    session.phase = "HINT_SELECTION";
    await cb.editMessage({
      text: CONFIG.ui.retryError,
      replyMarkup: hintSelectorKeyboard(session),
    });
  }
}

// ── Generation ───────────────────────────────────────────────────────────

async function handleGenerate(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "confirm" || value === "same") {
    await doGenerate(tg, cb, session, false);
  } else if (value === "variation") {
    await doGenerate(tg, cb, session, true);
  } else {
    await cb.answer({});
  }
}

async function doGenerate(tg: TelegramClient, cb: CallbackQueryContext, session: Session, variation: boolean): Promise<void> {
  if (!session.modules || !session.sonnetOutput) {
    await cb.answer({ text: "Немає даних для генерації" });
    return;
  }

  session.phase = "GENERATING";
  await cb.answer({});
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
  if (value === "pick") {
    await cb.answer({});
    await cb.editMessage({
      text: "Оберіть етап:",
      replyMarkup: stagePickerKeyboard(),
    });
  } else if (value.startsWith("set:")) {
    const stage = value.slice(4);
    await cb.answer({});
    await reanalyzeWithStage(tg, cb, session, stage);
  } else if (value === "use_model") {
    // User accepts the model's suggested stage — clear conflict state
    session.modelAgreesWithHint = true;
    session.disagreementReason = null;
    session.selectedHints.stage = session.detectedStage ?? undefined;
    session.phase = "ANALYSIS_READY";
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
  } else if (value === "back") {
    // Return to analysis card from stage picker
    session.phase = "ANALYSIS_READY";
    await cb.answer({});
    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
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

// ── Module editing ───────────────────────────────────────────────────────

async function handleModules(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value === "edit") {
    await cb.answer({});
    await cb.editMessage({
      text: moduleEditorText(session),
      replyMarkup: moduleEditorKeyboard(session),
    });
  } else if (value === "done") {
    await doGenerate(tg, cb, session, false);
  } else if (value === "back") {
    session.phase = "ANALYSIS_READY";
    await cb.answer({});
    await cb.editMessage({
      text: analysisCardText(session),
      replyMarkup: analysisCardKeyboard(session),
    });
  } else {
    await cb.answer({});
  }
}

async function handleModuleCategory(cb: CallbackQueryContext, session: Session, category: string): Promise<void> {
  await cb.answer({});
  await cb.editMessage({
    text: `⚙️ ${category}\n\nОберіть значення:`,
    replyMarkup: moduleCategoryKeyboard(category, session),
  });
}

async function handleModuleSelect(cb: CallbackQueryContext, session: Session, parts: string[]): Promise<void> {
  // parts = [CATEGORY, value]
  const category = parts[0];
  const value = parts.slice(1).join(":");

  if (category && value) {
    (session.userOverrides as Record<string, string>)[category] = value;
  }

  await cb.answer({});
  await cb.editMessage({
    text: moduleEditorText(session),
    replyMarkup: moduleEditorKeyboard(session),
  });
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
        newSession.phase = "HINT_SELECTION";
        await tg.sendText(userId, hintSelectorText(), {
          replyMarkup: hintSelectorKeyboard(newSession),
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
