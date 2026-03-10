import type { SonnetOutput } from "../session.js";
import { CONFIG, resolvedModels } from "../config.js";
import { getSonnetPrompt, getStageModuleDefaults, getModuleOptions } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const VALID_STAGES = new Set([
  "Attention", "Identification", "Problem", "Insight",
  "Authority", "Micro-value", "Possibility", "FOMO",
]);
const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);
const MODULE_KEYS = ["VISUAL_HOOK", "VISUAL_DRAMA", "COMPOSITION", "MAIN_ELEMENT", "SCROLL_EFFECT"] as const;

function isValidSonnetOutput(obj: unknown): obj is SonnetOutput {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (!VALID_STAGES.has(o.detectedStage as string)) return false;
  if (!VALID_CONFIDENCES.has(o.confidence as string)) return false;
  if (typeof o.scene !== "string" || typeof o.headline !== "string" || typeof o.secondary !== "string") return false;
  if (typeof o.modules !== "object" || o.modules === null) return false;
  const mods = o.modules as Record<string, unknown>;
  for (const key of MODULE_KEYS) {
    if (typeof mods[key] !== "string") return false;
  }
  return true;
}

function buildStageModuleTable(): string {
  const defaults = getStageModuleDefaults();
  const modKeys = ["VISUAL_HOOK", "VISUAL_DRAMA", "COMPOSITION", "MAIN_ELEMENT", "SCROLL_EFFECT"];
  const header = `| Stage | ${modKeys.join(" | ")} |`;
  const sep = `|${modKeys.map(() => "---").concat("---").join("|")}|`;
  const rows = Object.entries(defaults).map(([stage, mods]) => {
    const vals = modKeys.map((k) => mods[k] ?? "");
    return `| ${stage} | ${vals.join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function buildModuleOptionsList(): string {
  const opts = getModuleOptions();
  return Object.entries(opts)
    .map(([cat, vals]) => `${cat}: ${vals.join(", ")}`)
    .join("\n\n");
}

function buildUserMessage(inputText: string, hints: { stage?: string; style?: string }): string {
  let hintsBlock: string;
  if (hints.stage && hints.style) {
    hintsBlock = `User stage hint: ${hints.stage}\nUser style hint: ${hints.style}`;
  } else if (hints.stage) {
    hintsBlock = `User stage hint: ${hints.stage}`;
  } else if (hints.style) {
    hintsBlock = `User style hint: ${hints.style}`;
  } else {
    hintsBlock = "No hints provided. Determine stage from the message alone.";
  }

  return `Analyze the following funnel message and return a JSON object matching this schema exactly:

${CONFIG.sonnetOutputSchema}

Funnel message:
"""
${inputText}
"""

${hintsBlock}

Stage-to-module reference table (use as starting point, deviate when justified):

${buildStageModuleTable()}

Available module values per category:

${buildModuleOptionsList()}

Field instructions:
- "scene": English description of the visual scene for the image model. Be specific about composition, subject positioning, and visual drama. 2–4 sentences max.
- "headline": Ukrainian. ALL CAPS. Max 6 words. Extracted or rewritten from the funnel message. Must be the strongest possible hook for this stage.
- "secondary": Ukrainian. Max 10 words. Supports the headline. Calm, direct.
- "modelAgreesWithHint": true if you agree with the stage hint, false if you disagree, null if no hint was given.
- "disagreementReason": one sentence in English explaining why you chose a different stage. null if no disagreement.`;
}

async function callSonnet(
  systemPrompt: string,
  userMessage: string,
  context: string,
): Promise<SonnetOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const { attempts, delayMs } = CONFIG.retry.analyze;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CONFIG.timeouts.analyze);

      const resp = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: resolvedModels.analyze,
          max_tokens: 4000,
          thinking: { type: "enabled", budget_tokens: 8000 },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
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
        choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
        error?: { message?: string };
      };

      if (data.error) {
        throw new Error(`API error: ${data.error.message ?? JSON.stringify(data.error)}`);
      }

      // Extract text content — may be a string or an array with thinking + text blocks
      let rawText = "";
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        rawText = content;
      } else if (Array.isArray(content)) {
        const textBlock = content.find((b) => b.type === "text");
        rawText = textBlock?.text ?? "";
      }

      // Strip markdown fences
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        if (attempt < attempts) {
          await devAlert(`${context} / JSON parse failure (attempt ${attempt})`, new Error(`Raw: ${rawText.slice(0, 500)}`));
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        await devAlert(`${context} / JSON parse failure after retries`, new Error(`Raw: ${rawText.slice(0, 500)}`));
        throw new Error("JSON parse failure after retries");
      }

      if (!isValidSonnetOutput(parsed)) {
        if (attempt < attempts) {
          await devAlert(`${context} / invalid fields (attempt ${attempt})`, new Error(`Parsed: ${JSON.stringify(parsed).slice(0, 500)}`));
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        await devAlert(`${context} / invalid fields after retries`, new Error(`Parsed: ${JSON.stringify(parsed).slice(0, 500)}`));
        throw new Error("Invalid Sonnet output after retries");
      }

      return parsed;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";

      if (isTimeout) {
        await devAlert(`${context} / timeout`, err);
        throw err;
      }

      // If it's our own validation error, rethrow after last attempt
      if (err instanceof Error && (err.message.includes("after retries") || err.message.includes("parse failure"))) {
        throw err;
      }

      if (attempt < attempts) {
        await devAlert(`${context} / API error (attempt ${attempt})`, err);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      await devAlert(`${context} / API error after retries`, err);
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}

export async function analyzeMessage(
  inputText: string,
  hints: { stage?: string; style?: string },
): Promise<SonnetOutput> {
  const userMessage = buildUserMessage(inputText, hints);
  return callSonnet(getSonnetPrompt(), userMessage, "analyze");
}

export async function reanalyzeForStage(
  inputText: string,
  stage: string,
  hints: { style?: string },
): Promise<SonnetOutput> {
  const userMessage = buildUserMessage(inputText, { stage, style: hints.style });
  return callSonnet(getSonnetPrompt(), userMessage, "reanalyze");
}
