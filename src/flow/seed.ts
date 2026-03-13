import { CONFIG, resolvedModels } from "../config.js";
import { getHaikuPrompt } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";
import { globalState } from "../session.js";
import type { HaikuDnaOutput, ApiCallStats } from "../session.js";
import { mockSynthesizeSeed } from "./mocks.js";
import { fetchOpenRouter, withRetries } from "./openrouter.js";

const REQUIRED_STRING_FIELDS = [
  "subject", "object", "environment", "feeling",
  "texture", "tempo", "color_mood", "symbolism",
  "tension", "transformation",
] as const;

function isValidDnaOutput(obj: unknown): obj is HaikuDnaOutput {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof o[field] !== "string") return false;
  }
  if (!Array.isArray(o.actions) || o.actions.length === 0) return false;
  if (!o.actions.every((a: unknown) => typeof a === "string")) return false;
  return true;
}

export type SeedResult = {
  dna: HaikuDnaOutput;
  stats: ApiCallStats;
  systemPrompt: string;
  userPrompt: string;
};

export async function synthesizeSeed(seedWord: string): Promise<SeedResult> {
  if (globalState.testMode) return mockSynthesizeSeed(seedWord);

  const systemPrompt = getHaikuPrompt();
  const userPrompt = seedWord;
  const meta = { seedWord: seedWord.slice(0, 200) };

  try {
    return await withRetries({
      attempts: CONFIG.retry.seed.attempts,
      delayMs: CONFIG.retry.seed.delayMs,
      context: "seed",
      meta,
      fn: async () => {
        const { data, usage, durationMs } = await fetchOpenRouter({
          body: {
            model: resolvedModels.seed,
            max_tokens: 1000,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
          timeoutMs: CONFIG.timeouts.seed,
        });

        const rawText = data.choices?.[0]?.message?.content ?? "";
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          await devAlert("seed / JSON parse failure", new Error(`Raw: ${rawText.slice(0, 500)}`), meta);
          throw new Error(`JSON parse failure: ${rawText.slice(0, 200)}`);
        }

        if (!isValidDnaOutput(parsed)) {
          throw new Error(`Invalid DNA fields. Parsed: ${JSON.stringify(parsed).slice(0, 500)}`);
        }

        return {
          dna: parsed,
          stats: {
            durationMs,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          },
          systemPrompt,
          userPrompt,
        };
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SeedTimeoutError();
    }
    throw new SeedApiError(err instanceof Error ? err.message : String(err));
  }
}

export class SeedTimeoutError extends Error {
  constructor() {
    super("Seed synthesis timed out");
    this.name = "SeedTimeoutError";
  }
}

export class SeedApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedApiError";
  }
}
