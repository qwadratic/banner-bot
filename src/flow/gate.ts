import { CONFIG, resolvedModels } from "../config.js";
import { getHaikuPrompt } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type GateResult = { isFunnelMessage: boolean; confidence: "high" | "medium" | "low" };

const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);

function isValidGateResult(obj: unknown): obj is GateResult {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.isFunnelMessage === "boolean" && VALID_CONFIDENCES.has(o.confidence as string);
}

export async function classifyMessage(inputText: string): Promise<GateResult> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const { attempts, delayMs } = CONFIG.retry.gate;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CONFIG.timeouts.gate);

      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: resolvedModels.gate,
          max_tokens: 100,
          messages: [
            { role: "system", content: getHaikuPrompt() },
            { role: "user", content: inputText },
          ],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 500)}`);
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (data.error) {
        throw new Error(`API error: ${data.error.message ?? JSON.stringify(data.error)}`);
      }

      const rawText = data.choices?.[0]?.message?.content ?? "";
      // Strip markdown fences if present
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // JSON parse failure — fail open
        await devAlert("gate / JSON parse failure", new Error(`Raw response: ${rawText.slice(0, 500)}`), { inputText: inputText.slice(0, 200) });
        return { isFunnelMessage: true, confidence: "low" };
      }

      if (!isValidGateResult(parsed)) {
        // Missing fields — fail open
        await devAlert("gate / invalid fields", new Error(`Parsed: ${JSON.stringify(parsed)}`), { inputText: inputText.slice(0, 200) });
        return { isFunnelMessage: true, confidence: "low" };
      }

      return parsed;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";

      if (isTimeout) {
        await devAlert("gate / timeout", err, { inputText: inputText.slice(0, 200) });
        throw new GateTimeoutError();
      }

      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      await devAlert("gate / API error after retries", err, { inputText: inputText.slice(0, 200) });
      throw new GateApiError(err instanceof Error ? err.message : String(err));
    }
  }

  // Unreachable, but TypeScript needs it
  throw new GateApiError("Exhausted retries");
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
