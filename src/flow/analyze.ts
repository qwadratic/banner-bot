import { globalState } from "../session.js";
import type { SonnetOutput, HaikuDnaOutput, ApiCallStats } from "../session.js";
import { CONFIG, resolvedModels } from "../config.js";
import { getSonnetPrompt } from "../runtimeConfig.js";
import { mockObserveSeed } from "./mocks.js";
import { fetchOpenRouter, withRetries } from "./openrouter.js";

function isValidSonnetOutput(obj: unknown): obj is SonnetOutput {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.observation !== "string") return false;
  if (typeof o.goal !== "string") return false;
  if (typeof o.style !== "string") return false;
  if (typeof o.caption !== "string") return false;
  if (typeof o.scene !== "string") return false;
  if (typeof o.headline !== "string") return false;
  if (typeof o.secondary !== "string") return false;
  return true;
}

function buildUserMessage(seedWord: string, dna: HaikuDnaOutput): string {
  const dnaBlock = Object.entries(dna)
    .map(([key, val]) => {
      if (Array.isArray(val)) return `${key}: ${val.join(", ")}`;
      return `${key}: ${val}`;
    })
    .join("\n");

  return `Seed word: "${seedWord}"

DNA traits synthesized from this seed:

${dnaBlock}

Now inhabit this seed as consciousness. Observe every detail, bring it to motion, determine its real-life purpose, assign a visual style, and write a caption.

Respond with a JSON object matching this schema exactly:

${CONFIG.sonnetOutputSchema}

Field instructions:
- "observation": Your consciousness's deep observation of this seed — what you see, feel, notice. 2-4 sentences.
- "goal": How this generated visual should be used in real life — its practical purpose. 1-2 sentences.
- "style": A specific, evocative visual style description (e.g., "cinematic noir with medical precision"). 1 sentence.
- "caption": A poetic but purposeful caption for the image. 1-2 sentences.
- "scene": Detailed visual scene description for the image model. Specific about composition, subject positioning, lighting, color. 2-4 sentences.
- "headline": Ukrainian. ALL CAPS. Max 6 words. The strongest possible hook derived from this seed.
- "secondary": Ukrainian. Max 10 words. Supports the headline.`;
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

export type ObserveResult = {
  output: SonnetOutput;
  stats: ApiCallStats;
  systemPrompt: string;
  userPrompt: string;
};

export async function observeSeed(
  seedWord: string,
  dna: HaikuDnaOutput,
): Promise<ObserveResult> {
  if (globalState.testMode) return mockObserveSeed(seedWord, dna);

  const systemPrompt = getSonnetPrompt();
  const userMessage = buildUserMessage(seedWord, dna);

  const result = await withRetries({
    attempts: CONFIG.retry.analyze.attempts,
    delayMs: CONFIG.retry.analyze.delayMs,
    context: "observe",
    fn: async () => {
      const { data, usage, durationMs } = await fetchOpenRouter({
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

      return {
        output: parsed,
        stats: {
          durationMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        } as ApiCallStats,
        systemPrompt,
        userPrompt: userMessage,
      };
    },
  });

  return result;
}
