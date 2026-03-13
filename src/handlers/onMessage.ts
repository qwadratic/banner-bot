import { BotKeyboard, InputMedia, type TelegramClient } from "@mtcute/node";
import type { MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState, createSession, touchSession } from "../session.js";
import { devAlert } from "../devAlert.js";
import { synthesizeSeed, SeedTimeoutError } from "../flow/seed.js";
import { observeSeed } from "../flow/analyze.js";
import { assemblePrompt, generateImage } from "../flow/generate.js";
import { resultKeyboard, buildResultCaption } from "./onCallback.js";

export async function handleMessage(tg: TelegramClient, msg: MessageContext): Promise<void> {
  const userId = msg.sender?.id;
  if (!userId) return;

  const text = msg.text?.trim();
  if (!text) return;

  const session = globalState.activeSession;

  // No active session — create one and process seed
  if (!session || session.userId !== userId) {
    if (session && session.userId !== userId) {
      await tg.sendText(userId, CONFIG.ui.busyError);
      return;
    }

    const newSession = createSession(userId);
    newSession.phase = "WAITING_FOR_MESSAGE";
    globalState.activeSession = newSession;
    await runFullPipeline(tg, userId, text);
    return;
  }

  touchSession(session);

  // AWAITING_FEEDBACK_COMMENT — user typed a comment
  if (session.phase === "AWAITING_FEEDBACK_COMMENT") {
    const { saveFeedback } = await import("../flow/feedback.js");
    saveFeedback(session, session.pendingRating!, text);
    session.pendingRating = null;
    session.phase = "RESULT_READY";
    await tg.sendText(userId, "Дякую за відгук!", {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("🔁 Повторити", "generate:same"),
        ],
        [BotKeyboard.callback("❌ Завершити сесію", "session:end")],
      ]),
    });
    return;
  }

  // WAITING_FOR_MESSAGE — process the seed
  if (session.phase === "WAITING_FOR_MESSAGE") {
    await runFullPipeline(tg, userId, text);
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

async function runFullPipeline(tg: TelegramClient, userId: number, seedWord: string): Promise<void> {
  const session = globalState.activeSession!;
  session.seedWord = seedWord;

  try {
    // ── Step 1: Haiku DNA synthesis ──────────────────────────────────────
    session.phase = "SYNTHESIZING";
    await tg.sendText(userId, CONFIG.ui.synthesizing);

    const seedResult = await synthesizeSeed(seedWord);
    session.haikuDnaOutput = seedResult.dna;
    session.haikuStats = seedResult.stats;
    session.haikuSystemPrompt = seedResult.systemPrompt;
    session.haikuUserPrompt = seedResult.userPrompt;

    // ── Step 2: Sonnet consciousness observation ────────────────────────
    session.phase = "OBSERVING";
    await tg.sendText(userId, CONFIG.ui.observing);

    const observeResult = await observeSeed(seedWord, seedResult.dna);
    session.sonnetOutput = observeResult.output;
    session.sonnetStats = observeResult.stats;
    session.sonnetSystemPrompt = observeResult.systemPrompt;
    session.sonnetUserPrompt = observeResult.userPrompt;

    // ── Step 3: Image generation ────────────────────────────────────────
    session.phase = "GENERATING";
    await tg.sendText(userId, CONFIG.ui.generating);

    const prompt = assemblePrompt(observeResult.output);
    session.generatedPrompt = prompt;

    const genResult = await generateImage(prompt);
    session.imageStats = genResult.stats;
    session.generationCount++;

    // ── Send result ─────────────────────────────────────────────────────
    await tg.sendMedia(
      userId,
      InputMedia.photo(new Uint8Array(genResult.imageBuffer), { fileName: "banner.png" }),
      {
        caption: buildResultCaption(session),
        replyMarkup: resultKeyboard(),
      },
    );

    session.phase = "RESULT_READY";
  } catch (err) {
    await devAlert("onMessage / pipeline", err, { userId, seedWord: seedWord.slice(0, 200) });

    if (err instanceof SeedTimeoutError) {
      await tg.sendText(userId, CONFIG.ui.timeoutError);
    } else {
      await tg.sendText(userId, CONFIG.ui.retryError);
    }

    // Reset to waiting state
    session.phase = "WAITING_FOR_MESSAGE";
  }
}
