import { CONFIG, resolvedModels } from "../config.js";
import { getHaikuPrompt } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";
import { globalState } from "../session.js";
import { mockClassifyMessage } from "./mocks.js";
import { fetchOpenRouter, withRetries, VALID_CONFIDENCES } from "./openrouter.js";
import type { GateResult } from "./openrouter.js";

function isValidGateResult(obj: unknown): obj is GateResult {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.isFunnelMessage === "boolean" && VALID_CONFIDENCES.has(o.confidence as string);
}

export async function classifyMessage(inputText: string): Promise<GateResult> {
  if (globalState.testMode) return mockClassifyMessage(inputText);

  const meta = { inputText: inputText.slice(0, 200) };

  try {
    return await withRetries({
      attempts: CONFIG.retry.gate.attempts,
      delayMs: CONFIG.retry.gate.delayMs,
      context: "gate",
      meta,
      fn: async () => {
        const data = await fetchOpenRouter({
          body: {
            model: resolvedModels.gate,
            max_tokens: 100,
            messages: [
              { role: "system", content: getHaikuPrompt() },
              { role: "user", content: inputText },
            ],
          },
          timeoutMs: CONFIG.timeouts.gate,
        });

        const rawText = data.choices?.[0]?.message?.content ?? "";
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          // JSON parse failure — fail open
          await devAlert("gate / JSON parse failure", new Error(`Raw: ${rawText.slice(0, 500)}`), meta);
          return { isFunnelMessage: true, confidence: "low" as const };
        }

        if (!isValidGateResult(parsed)) {
          await devAlert("gate / invalid fields", new Error(`Parsed: ${JSON.stringify(parsed)}`), meta);
          return { isFunnelMessage: true, confidence: "low" as const };
        }

        return parsed;
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GateTimeoutError();
    }
    throw new GateApiError(err instanceof Error ? err.message : String(err));
  }
}

export class GateTimeoutError extends Error {
  constructor() {
    super("Gate classification timed out");
    this.name = "GateTimeoutError";
  }
}

export class GateApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateApiError";
  }
}
