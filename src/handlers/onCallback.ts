import { BotKeyboard, InputMedia, type TelegramClient } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { getAdminUserIds } from "../runtimeConfig.js";
import { globalState, touchSession, createSession } from "../session.js";
import type { Session, ApiCallStats } from "../session.js";
import { devAlert } from "../devAlert.js";
import { synthesizeSeed } from "../flow/seed.js";
import { observeSeed } from "../flow/analyze.js";
import { assemblePrompt, generateImage } from "../flow/generate.js";
import { saveFeedback } from "../flow/feedback.js";

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
    const [action, ...rest] = data.split(":");
    const value = rest.join(":");

    switch (action) {
      case "generate":
        await handleGenerate(tg, cb, session, value);
        break;
      case "prompt":
        await handlePrompt(tg, cb, session, value);
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
      case "share":
        await handleShare(tg, cb, session, value);
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

async function deactivateMessage(cb: CallbackQueryContext, note: string): Promise<void> {
  try {
    await cb.editMessage({ text: note });
  } catch {
    try {
      await cb.editMessage({ replyMarkup: BotKeyboard.inline([]) });
    } catch {
      // Ignore
    }
  }
}

// ── Result display helpers (exported for onMessage.ts) ──────────────────

function formatStats(label: string, stats: ApiCallStats | null): string {
  if (!stats) return `${label}: —`;
  const secs = (stats.durationMs / 1000).toFixed(1);
  return `${label}: ${secs}s (${stats.promptTokens}/${stats.completionTokens} tok)`;
}

export function buildResultCaption(session: Session): string {
  const lines: string[] = [];

  lines.push(`🧬 DNA Generation #${session.generationCount}`);
  lines.push("");
  lines.push(`Seed: "${session.seedWord}"`);

  if (session.sonnetOutput?.style) {
    lines.push(`Style: ${session.sonnetOutput.style}`);
  }

  lines.push("");
  lines.push(formatStats("⏱ Haiku", session.haikuStats));
  lines.push(formatStats("⏱ Sonnet", session.sonnetStats));
  lines.push(formatStats("⏱ Image", session.imageStats));

  if (session.sonnetOutput?.caption) {
    lines.push("");
    lines.push(`"${session.sonnetOutput.caption}"`);
  }

  return lines.join("\n");
}

export function resultKeyboard() {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("📋 System", "prompt:system"),
      BotKeyboard.callback("📝 User", "prompt:user"),
    ],
    [
      BotKeyboard.callback("🧬 Haiku out", "prompt:haiku"),
      BotKeyboard.callback("🔮 Sonnet out", "prompt:sonnet"),
    ],
    [
      BotKeyboard.callback("📤 Send to admins", "share:admins"),
    ],
    [
      BotKeyboard.callback("🔁 Повторити", "generate:same"),
      BotKeyboard.callback("⭐ Оцінити", "feedback:start"),
    ],
    [BotKeyboard.callback("❌ Завершити сесію", "session:end")],
  ]);
}

// ── Generation ───────────────────────────────────────────────────────────

async function handleGenerate(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value !== "same") {
    await cb.answer({});
    return;
  }

  if (!session.sonnetOutput || !session.seedWord) {
    await cb.answer({ text: "Немає даних для генерації" });
    return;
  }

  session.phase = "GENERATING";
  await cb.answer({});
  await deactivateMessage(cb, "🔁 Повторна генерація");
  await tg.sendText(session.userId, CONFIG.ui.generating);

  try {
    // Re-run the full pipeline with the same seed
    const seedResult = await synthesizeSeed(session.seedWord);
    session.haikuDnaOutput = seedResult.dna;
    session.haikuStats = seedResult.stats;
    session.haikuSystemPrompt = seedResult.systemPrompt;
    session.haikuUserPrompt = seedResult.userPrompt;

    const observeResult = await observeSeed(session.seedWord, seedResult.dna);
    session.sonnetOutput = observeResult.output;
    session.sonnetStats = observeResult.stats;
    session.sonnetSystemPrompt = observeResult.systemPrompt;
    session.sonnetUserPrompt = observeResult.userPrompt;

    const prompt = assemblePrompt(observeResult.output);
    session.generatedPrompt = prompt;

    const genResult = await generateImage(prompt);
    session.imageStats = genResult.stats;
    session.generationCount++;

    await tg.sendMedia(
      session.userId,
      InputMedia.photo(new Uint8Array(genResult.imageBuffer), { fileName: "banner.png" }),
      {
        caption: buildResultCaption(session),
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

// ── Prompt viewing ───────────────────────────────────────────────────────

async function handlePrompt(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  await cb.answer({});

  let text: string;

  switch (value) {
    case "system": {
      const haiku = session.haikuSystemPrompt ?? "(not available)";
      const sonnet = session.sonnetSystemPrompt ?? "(not available)";
      text = `📋 SYSTEM PROMPTS\n\n── Haiku (DNA Seed) ──\n${haiku}\n\n── Sonnet (Consciousness) ──\n${sonnet}`;
      break;
    }
    case "user": {
      const haiku = session.haikuUserPrompt ?? "(not available)";
      const sonnet = session.sonnetUserPrompt ?? "(not available)";
      text = `📝 USER PROMPTS\n\n── Haiku input ──\n${haiku}\n\n── Sonnet input ──\n${sonnet}`;
      break;
    }
    case "haiku": {
      if (session.haikuDnaOutput) {
        const dna = session.haikuDnaOutput;
        const lines = Object.entries(dna).map(([k, v]) => {
          if (Array.isArray(v)) return `${k}: ${v.join(", ")}`;
          return `${k}: ${v}`;
        });
        text = `🧬 HAIKU DNA OUTPUT\n\n${lines.join("\n")}`;
      } else {
        text = "🧬 Haiku output not available.";
      }
      break;
    }
    case "sonnet": {
      if (session.sonnetOutput) {
        const out = session.sonnetOutput;
        text = `🔮 SONNET OUTPUT\n\nobservation: ${out.observation}\n\ngoal: ${out.goal}\n\nstyle: ${out.style}\n\ncaption: ${out.caption}\n\nscene: ${out.scene}\n\nheadline: ${out.headline}\n\nsecondary: ${out.secondary}`;
      } else {
        text = "🔮 Sonnet output not available.";
      }
      break;
    }
    default:
      // Legacy: show generated image prompt
      if (session.generatedPrompt) {
        text = session.generatedPrompt;
      } else {
        text = "Промпт не знайдено.";
      }
  }

  // Truncate for Telegram limit
  if (text.length > 4096) {
    text = text.slice(0, 4093) + "...";
  }

  await tg.sendText(session.userId, text);
}

// ── Share to admins ──────────────────────────────────────────────────────

async function handleShare(tg: TelegramClient, cb: CallbackQueryContext, session: Session, value: string): Promise<void> {
  if (value !== "admins") {
    await cb.answer({});
    return;
  }

  const adminIds = getAdminUserIds();
  const devTgId = Number(process.env.DEV_TG_ID);

  // Collect all admin IDs except the current user
  const targets = [...new Set([devTgId, ...adminIds])].filter((id) => id !== session.userId);

  if (targets.length === 0) {
    await cb.answer({ text: "Немає інших адмінів" });
    return;
  }

  await cb.answer({ text: "📤 Надсилаю..." });

  const caption = `📤 Shared by user ${session.userId}\n\n${buildResultCaption(session)}`;
  const truncatedCaption = caption.length > 1024 ? caption.slice(0, 1021) + "..." : caption;

  let sent = 0;
  for (const targetId of targets) {
    try {
      // Send the result text
      await tg.sendText(targetId, truncatedCaption);

      // If we have a generated prompt, also share the haiku DNA and sonnet output
      if (session.haikuDnaOutput) {
        const dna = session.haikuDnaOutput;
        const dnaLines = Object.entries(dna).map(([k, v]) => {
          if (Array.isArray(v)) return `${k}: ${v.join(", ")}`;
          return `${k}: ${v}`;
        });
        let dnaText = `🧬 DNA:\n${dnaLines.join("\n")}`;
        if (dnaText.length > 4096) dnaText = dnaText.slice(0, 4093) + "...";
        await tg.sendText(targetId, dnaText);
      }

      sent++;
    } catch (err) {
      await devAlert("share / send to admin", err, { targetId });
    }
  }

  await tg.sendText(session.userId, `📤 Надіслано ${sent} адмін(ам).`);
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
      text: "Дякую за відгук!",
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
    const pendingText = session.pendingInterruptText;
    const userId = session.userId;

    const newSession = createSession(userId);
    newSession.phase = "WAITING_FOR_MESSAGE";
    globalState.activeSession = newSession;

    await cb.answer({});
    await cb.editMessage({ text: "Сесію скасовано." });

    // Process the pending text as a new seed
    if (pendingText) {
      const { runFullPipeline } = await import("./onMessage.js") as { runFullPipeline?: (tg: TelegramClient, userId: number, seedWord: string) => Promise<void> };
      // Since runFullPipeline is not exported, we'll inline the logic
      try {
        newSession.seedWord = pendingText;
        newSession.phase = "SYNTHESIZING";
        await tg.sendText(userId, CONFIG.ui.synthesizing);

        const { synthesizeSeed: synthSeed } = await import("../flow/seed.js");
        const seedResult = await synthSeed(pendingText);
        newSession.haikuDnaOutput = seedResult.dna;
        newSession.haikuStats = seedResult.stats;
        newSession.haikuSystemPrompt = seedResult.systemPrompt;
        newSession.haikuUserPrompt = seedResult.userPrompt;

        const { observeSeed: observe } = await import("../flow/analyze.js");
        newSession.phase = "OBSERVING";
        await tg.sendText(userId, CONFIG.ui.observing);

        const observeResult = await observe(pendingText, seedResult.dna);
        newSession.sonnetOutput = observeResult.output;
        newSession.sonnetStats = observeResult.stats;
        newSession.sonnetSystemPrompt = observeResult.systemPrompt;
        newSession.sonnetUserPrompt = observeResult.userPrompt;

        const { assemblePrompt: assemble, generateImage: genImage } = await import("../flow/generate.js");
        newSession.phase = "GENERATING";
        await tg.sendText(userId, CONFIG.ui.generating);

        const prompt = assemble(observeResult.output);
        newSession.generatedPrompt = prompt;

        const genResult = await genImage(prompt);
        newSession.imageStats = genResult.stats;
        newSession.generationCount++;

        await tg.sendMedia(
          userId,
          InputMedia.photo(new Uint8Array(genResult.imageBuffer), { fileName: "banner.png" }),
          {
            caption: buildResultCaption(newSession),
            replyMarkup: resultKeyboard(),
          },
        );

        newSession.phase = "RESULT_READY";
      } catch (err) {
        await devAlert("onCallback / interrupt:cancel / pipeline", err, { userId });
        await tg.sendText(userId, CONFIG.ui.retryError);
        newSession.phase = "WAITING_FOR_MESSAGE";
      }
    }
  } else if (value === "continue") {
    session.pendingInterruptText = null;
    session.phase = session.previousPhase ?? "WAITING_FOR_MESSAGE";
    session.previousPhase = null;
    await cb.answer({});
    await cb.editMessage({ text: "Продовжуємо поточну сесію." });
  } else {
    await cb.answer({});
  }
}
