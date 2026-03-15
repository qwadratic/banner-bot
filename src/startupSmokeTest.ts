import { InputMedia, type TelegramClient } from "@mtcute/node";
import { classifyMessage } from "./flow/gate.js";
import { analyzeMessage } from "./flow/analyze.js";
import { assemblePrompt, generateImage } from "./flow/generate.js";
import { devAlert } from "./devAlert.js";

const TEST_INPUT = `Ви знали, що 80% болю в спині пов'язані зі стопами?
Лише 3% лікарів звертають на це увагу.
Дізнайтеся, як ортезування змінює підхід до лікування.`;

export async function startupSmokeTest(tg: TelegramClient, devTgId: number): Promise<void> {
  const t0 = Date.now();

  try {
    await tg.sendText(devTgId, "🧪 Startup smoke test — running gate → analyze → generate…");

    // 1. Gate
    const gateStart = Date.now();
    const gateResult = await classifyMessage(TEST_INPUT);
    const gateMs = Date.now() - gateStart;

    if (!gateResult.isFunnelMessage) {
      await tg.sendText(devTgId, `🧪 Smoke test FAILED — gate rejected test input (confidence: ${gateResult.confidence}) [${gateMs}ms]`);
      return;
    }

    // 2. Analyze
    const analyzeStart = Date.now();
    const sonnetOutput = await analyzeMessage(TEST_INPUT, {});
    const analyzeMs = Date.now() - analyzeStart;

    const prompt = assemblePrompt(sonnetOutput.modules, {}, sonnetOutput);

    // 3. Generate
    const genStart = Date.now();
    const imageBuffer = await generateImage(prompt, sonnetOutput.detectedStage);
    const genMs = Date.now() - genStart;

    const totalMs = Date.now() - t0;

    // Send result image
    await tg.sendMedia(
      devTgId,
      InputMedia.photo(new Uint8Array(imageBuffer), { fileName: "smoke_test.png" }),
      {
        caption: [
          `🧪 Smoke test OK — ${totalMs}ms total`,
          `Gate: ${gateMs}ms (${gateResult.confidence})`,
          `Analyze: ${analyzeMs}ms → ${sonnetOutput.detectedStage}`,
          `Generate: ${genMs}ms`,
          `Headline: ${sonnetOutput.headline}`,
        ].join("\n"),
      },
    );
  } catch (err) {
    const totalMs = Date.now() - t0;
    await devAlert("startupSmokeTest", err, { elapsedMs: totalMs });
    try {
      await tg.sendText(devTgId, `🧪 Smoke test FAILED after ${totalMs}ms — see alert above`);
    } catch {
      // best-effort
    }
  }
}
