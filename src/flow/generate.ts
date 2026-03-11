import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleSet, SonnetOutput } from "../session.js";
import { CONFIG, resolvedModels } from "../config.js";
import { getImageTemplate, getDoctorPortrait, getBannerStyles } from "../runtimeConfig.js";
import { devAlert } from "../devAlert.js";
import { globalState } from "../session.js";
import { mockGenerateImage } from "./mocks.js";
import { fetchOpenRouter, withRetries } from "./openrouter.js";

// Resolve to project root (two levels up from src/flow/ or dist/flow/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

interface ReferenceAsset {
  path: string | null;
  role: string;
  promptHint: string;
  base64?: string;
}

export function assemblePrompt(
  modules: ModuleSet,
  userOverrides: Partial<ModuleSet>,
  sonnetOutput: SonnetOutput,
): string {
  const effective = { ...modules, ...userOverrides };
  const modulesBlock = Object.entries(effective)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");

  return getImageTemplate()
    .replace("{modules}", modulesBlock)
    .replace("{scene}", sonnetOutput.scene)
    .replace("{headline}", sonnetOutput.headline)
    .replace("{secondary}", sonnetOutput.secondary);
}

async function loadReferenceAssets(detectedStage: string): Promise<ReferenceAsset[]> {
  const refs: ReferenceAsset[] = [
    ...getBannerStyles().filter((r) => r.path !== null),
  ];

  if ((CONFIG.stagesWithDoctor as readonly string[]).includes(detectedStage)) {
    const doc = getDoctorPortrait();
    if (doc.path) {
      refs.unshift(doc);
    }
  }

  const loaded: ReferenceAsset[] = [];
  for (const ref of refs) {
    if (!ref.path) continue;
    try {
      const resolved = path.resolve(PROJECT_ROOT, ref.path);
      const buf = await fs.readFile(resolved);
      loaded.push({
        ...ref,
        base64: buf.toString("base64"),
      });
    } catch (err) {
      await devAlert("generate / missing asset", err, { path: ref.path, role: ref.role });
    }
  }

  return loaded;
}

export async function generateImage(
  prompt: string,
  detectedStage: string,
): Promise<Buffer> {
  if (globalState.testMode) return mockGenerateImage(prompt, detectedStage);

  const loadedRefs = await loadReferenceAssets(detectedStage);

  // Assemble multimodal content blocks
  const contentBlocks: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  for (const ref of loadedRefs) {
    if (!ref.base64) continue;
    contentBlocks.push({
      type: "text",
      text: `[${ref.role.toUpperCase()} REFERENCE: ${ref.promptHint}]`,
    });
    contentBlocks.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${ref.base64}` },
    });
  }

  contentBlocks.push({ type: "text", text: prompt });

  return withRetries({
    attempts: CONFIG.retry.imageGen.attempts,
    delayMs: CONFIG.retry.imageGen.delayMs,
    context: "generate",
    meta: { detectedStage },
    fn: async () => {
      const data = await fetchOpenRouter({
        body: {
          model: resolvedModels.image,
          modalities: ["image", "text"],
          messages: [{ role: "user", content: contentBlocks }],
          image_config: { aspect_ratio: "16:9" },
        },
        timeoutMs: CONFIG.timeouts.imageGen,
      });

      // Extract image from response
      const message = data.choices?.[0]?.message;
      let imageBase64: string | null = null;

      // Check message.images[] (OpenRouter/Gemini pattern)
      const images = message?.images;
      if (images && images.length > 0) {
        const dataUrl = images[0].image_url?.url ?? "";
        const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (match) {
          imageBase64 = match[1];
        }
      }

      // Fallback: check if content itself contains a data URL
      if (!imageBase64 && typeof message?.content === "string") {
        const match = message.content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
        if (match) {
          imageBase64 = match[1];
        }
      }

      if (!imageBase64) {
        const msgDump = JSON.stringify(message, (_k: string, v: unknown) => {
          if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "...";
          return v;
        });
        throw new Error(`No image in response. Raw message: ${msgDump?.slice(0, 500)}`);
      }

      return Buffer.from(imageBase64, "base64");
    },
  });
}
