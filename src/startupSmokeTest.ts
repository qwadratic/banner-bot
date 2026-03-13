import { InputMedia, type TelegramClient } from "@mtcute/node";
import { synthesizeSeed } from "./flow/seed.js";
import { observeSeed } from "./flow/analyze.js";
import { assemblePrompt, generateImage } from "./flow/generate.js";
import { devAlert } from "./devAlert.js";

const TEST_SEED = "океан";

export async function startupSmokeTest(tg: TelegramClient, devTgId: number): Promise<void> {
  const t0 = Date.now();

  try {
    await tg.sendText(devTgId, "🧪 Startup smoke test — running seed → observe → generate...");

    // 1. Seed synthesis
    const seedResult = await synthesizeSeed(TEST_SEED);
    const seedMs = seedResult.stats.durationMs;

    // 2. Observe
    const observeResult = await observeSeed(TEST_SEED, seedResult.dna);
    const observeMs = observeResult.stats.durationMs;

    const prompt = assemblePrompt(observeResult.output);

    // 3. Generate
    const genResult = await generateImage(prompt);
    const genMs = genResult.stats.durationMs;

    const totalMs = Date.now() - t0;

    await tg.sendMedia(
      devTgId,
      InputMedia.photo(new Uint8Array(genResult.imageBuffer), { fileName: "smoke_test.png" }),
      {
        caption: [
          `🧪 Smoke test OK — ${totalMs}ms total`,
          `Seed: "${TEST_SEED}" → ${seedMs}ms`,
          `Observe: ${observeMs}ms → style: ${observeResult.output.style}`,
          `Generate: ${genMs}ms`,
          `Headline: ${observeResult.output.headline}`,
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
