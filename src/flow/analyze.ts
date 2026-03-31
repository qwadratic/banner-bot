import { MODULE_KEYS, globalState } from "../session.js";
import type { SonnetOutput } from "../session.js";
import { CONFIG, resolvedModels } from "../config.js";
import { getSonnetPrompt, getSonnetUserTemplate, getStageModuleDefaults, getModuleOptions } from "../runtimeConfig.js";
import { mockAnalyzeMessage, mockReanalyzeForStage } from "./mocks.js";
import { fetchOpenRouter, withRetries, VALID_CONFIDENCES } from "./openrouter.js";

const VALID_STAGES = new Set([
  "Attention", "Identification", "Problem", "Insight",
  "Authority", "Micro-value", "Possibility", "FOMO",
]);

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
  // Only show module keys that are present in defaults (MAIN_ELEMENT is excluded — chosen by Sonnet)
  const firstRow = Object.values(defaults)[0] ?? {};
  const tableKeys = MODULE_KEYS.filter((k) => k in firstRow);
  const header = `| Stage | ${tableKeys.join(" | ")} |`;
  const sep = `|${["---", ...tableKeys.map(() => "---")].join("|")}|`;
  const rows = Object.entries(defaults).map(([stage, mods]) => {
    const vals = tableKeys.map((k) => mods[k] ?? "");
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

  return getSonnetUserTemplate()
    .replace("{schema}", CONFIG.sonnetOutputSchema)
    .replace("{message}", inputText)
    .replace("{hints}", hintsBlock)
    .replace("{stageModuleTable}", buildStageModuleTable())
    .replace("{moduleOptions}", buildModuleOptionsList());
}

function extractTextContent(data: { choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }> }): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }
  return "";
}

async function callSonnet(
  systemPrompt: string,
  userMessage: string,
  context: string,
): Promise<SonnetOutput> {
  return withRetries({
    attempts: CONFIG.retry.analyze.attempts,
    delayMs: CONFIG.retry.analyze.delayMs,
    context,
    fn: async () => {
      const data = await fetchOpenRouter({
        body: {
          model: resolvedModels.analyze,
          max_tokens: 4000,
          thinking: { type: "enabled", budget_tokens: 8000 },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        },
        timeoutMs: CONFIG.timeouts.analyze,
      });

      const rawText = extractTextContent(data);
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(cleaned) as unknown; // throws → triggers retry

      if (!isValidSonnetOutput(parsed)) {
        throw new Error(`Invalid fields. Parsed: ${JSON.stringify(parsed).slice(0, 500)}`);
      }

      return parsed;
    },
  });
}

export async function analyzeMessage(
  inputText: string,
  hints: { stage?: string; style?: string },
): Promise<SonnetOutput> {
  if (globalState.testMode) return mockAnalyzeMessage(inputText, hints);

  const userMessage = buildUserMessage(inputText, hints);
  return callSonnet(getSonnetPrompt(), userMessage, "analyze");
}

export async function reanalyzeForStage(
  inputText: string,
  stage: string,
  hints: { style?: string },
): Promise<SonnetOutput> {
  if (globalState.testMode) return mockReanalyzeForStage(inputText, stage, hints);

  const userMessage = buildUserMessage(inputText, { stage, style: hints.style });
  return callSonnet(getSonnetPrompt(), userMessage, "reanalyze");
}
