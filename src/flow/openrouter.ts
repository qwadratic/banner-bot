import { devAlert } from "../devAlert.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);

export type GateResult = {
  isFunnelMessage: boolean;
  confidence: "high" | "medium" | "low";
};

/**
 * POST to OpenRouter with timeout. Handles HTTP errors and API-level errors.
 * Returns the parsed JSON response body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchOpenRouter(opts: {
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(opts.body),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await resp.json()) as any;

    if (data.error) {
      throw new Error(
        `API error: ${data.error.message ?? JSON.stringify(data.error)}`,
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry loop with timeout detection. AbortError is never retried.
 * Calls devAlert on each failed attempt and on final failure.
 */
export async function withRetries<T>(opts: {
  attempts: number;
  delayMs: number;
  context: string;
  meta?: Record<string, unknown>;
  fn: () => Promise<T>;
}): Promise<T> {
  const { attempts, delayMs, context, meta, fn } = opts;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Timeouts are not retryable
      if (err instanceof Error && err.name === "AbortError") {
        await devAlert(`${context} / timeout`, err, meta);
        throw err;
      }

      if (attempt < attempts) {
        await devAlert(`${context} / error (attempt ${attempt})`, err, meta);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      await devAlert(`${context} / error after retries`, err, meta);
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}
