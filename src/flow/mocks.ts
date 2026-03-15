/**
 * Mock implementations for test mode.
 * Replace real API calls with deterministic, realistic responses
 * that exercise all UX paths.
 */

import * as zlib from "node:zlib";
import type { SonnetOutput, ModuleSet } from "../session.js";
import type { GateResult } from "./openrouter.js";
import { getStageModuleDefaults } from "../runtimeConfig.js";

// ── Delays (simulate network latency) ────────────────────────────────────

const GATE_DELAY = 200;
const ANALYZE_DELAY = 600;
const IMAGE_DELAY = 400;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Gate mock ────────────────────────────────────────────────────────────

/**
 * Short / obviously non-funnel text → rejected.
 * Everything else → accepted as funnel message.
 */
export async function mockClassifyMessage(inputText: string): Promise<GateResult> {
  await delay(GATE_DELAY);

  const trimmed = inputText.trim();

  // Very short text → not a funnel message (tests rejection path)
  if (trimmed.length < 15) {
    return { isFunnelMessage: false, confidence: "high" };
  }

  // Greetings / questions → not funnel
  const lower = trimmed.toLowerCase();
  if (/^(привіт|hello|hi|hey|як справи|що це)\b/i.test(lower)) {
    return { isFunnelMessage: false, confidence: "medium" };
  }

  return { isFunnelMessage: true, confidence: "high" };
}

// ── Analyze mock ─────────────────────────────────────────────────────────

const STAGES = [
  "Attention", "Identification", "Problem", "Insight",
  "Authority", "Micro-value", "Possibility", "FOMO",
] as const;

const MOCK_SCENES: Record<string, string> = {
  Attention:      "Close-up of a doctor examining a patient's foot with diagnostic tools, dramatic side lighting, dark green background with neon green accent lines. The foot is positioned centrally with visible pressure-point markers.",
  Identification: "A person looking down at their own feet with a concerned expression, soft clinical lighting. Split composition — left side shows the person, right side shows a mirrored x-ray overlay of the foot structure.",
  Problem:        "X-ray style visualization of foot misalignment, red highlight zones pulsing on metatarsal pressure points. Dark moody atmosphere with clinical precision. Symptoms labeled with bold arrows.",
  Insight:        "Doctor pointing at an illuminated anatomical foot diagram on a modern display, 'eureka moment' lighting. Clean clinical background with green accent panels. Knowledge visualization.",
  Authority:      "Confident podiatrist in a crisp white coat holding a custom orthotic insert at eye level. Professional studio lighting, credentials subtly visible. Authority and trust composition.",
  "Micro-value":  "Extreme macro close-up of orthotic insert surface texture showing engineering precision. Shallow depth of field, dramatic rim lighting revealing material layers and ergonomic contours.",
  Possibility:    "Before-and-after split screen: left side shows discomfort (muted tones), right side shows active healthy lifestyle (vibrant greens). Orthotic insert as the bridge element in the center.",
  FOMO:           "Dynamic countdown-style composition with bold numbers, limited-availability visual cues. High contrast dark green and neon accents. Urgency-driven layout with directional elements.",
};

const MOCK_HEADLINES: Record<string, string> = {
  Attention:      "ВАШІ СТОПИ КРИЧАТЬ",
  Identification: "ВИ ВПІЗНАЄТЕ ЦЕ?",
  Problem:        "БІЛЬ НЕ ЗНИКНЕ САМА",
  Insight:        "ОСЬ ЧОМУ ЦЕ БОЛИТЬ",
  Authority:      "ЛІКАР ЗНАЄ РІШЕННЯ",
  "Micro-value":  "СЕКРЕТ ПРАВИЛЬНОЇ УСТІЛКИ",
  Possibility:    "ХОДІТЬ БЕЗ БОЛЮ",
  FOMO:           "ЗАЛИШИЛОСЬ МАЛО МІСЦЬ",
};

const MOCK_SECONDARY: Record<string, string> = {
  Attention:      "Дізнайтесь що приховують ваші стопи",
  Identification: "Тисячі людей мають цю саму проблему",
  Problem:        "Без лікування стає лише гірше з часом",
  Insight:        "Наука пояснює причину болю в стопах",
  Authority:      "Досвід 15 років практики в ортопедії",
  "Micro-value":  "Деталь яка змінює все у вашій ході",
  Possibility:    "Результат вже через 2 тижні використання",
  FOMO:           "Запис закривається о 23:59 сьогодні",
};

/** Simple hash of a string to a number for deterministic selection */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickStage(inputText: string): string {
  const idx = hashString(inputText) % STAGES.length;
  return STAGES[idx];
}

export async function mockAnalyzeMessage(
  inputText: string,
  hints: { stage?: string; style?: string },
): Promise<SonnetOutput> {
  await delay(ANALYZE_DELAY);

  let stage: string;
  let modelAgreesWithHint: boolean | null = null;
  let disagreementReason: string | null = null;

  if (hints.stage) {
    // 20% chance of disagreeing with hint (based on text hash) to test conflict path
    const disagree = hashString(inputText + "disagree") % 5 === 0;
    if (disagree) {
      stage = pickStage(inputText);
      // Make sure we actually pick a different stage
      if (stage === hints.stage) {
        const idx = (STAGES.indexOf(stage as typeof STAGES[number]) + 1) % STAGES.length;
        stage = STAGES[idx];
      }
      modelAgreesWithHint = false;
      disagreementReason = `The message tone and structure align more with ${stage} than ${hints.stage}. The copy focuses on ${stage.toLowerCase()}-stage psychological triggers.`;
    } else {
      stage = hints.stage;
      modelAgreesWithHint = true;
    }
  } else {
    stage = pickStage(inputText);
  }

  const defaults = getStageModuleDefaults();
  const modules = (defaults[stage] ?? defaults["Attention"]) as ModuleSet;

  const confidence = hints.stage && modelAgreesWithHint ? "high" : "medium";

  return {
    detectedStage: stage,
    confidence,
    modelAgreesWithHint,
    disagreementReason,
    modules,
    scene: MOCK_SCENES[stage] ?? MOCK_SCENES["Attention"],
    headline: MOCK_HEADLINES[stage] ?? MOCK_HEADLINES["Attention"],
    secondary: MOCK_SECONDARY[stage] ?? MOCK_SECONDARY["Attention"],
  };
}

export async function mockReanalyzeForStage(
  inputText: string,
  stage: string,
  hints: { style?: string },
): Promise<SonnetOutput> {
  await delay(ANALYZE_DELAY);

  const defaults = getStageModuleDefaults();
  const modules = (defaults[stage] ?? defaults["Attention"]) as ModuleSet;

  return {
    detectedStage: stage,
    confidence: "high",
    modelAgreesWithHint: true,
    disagreementReason: null,
    modules,
    scene: MOCK_SCENES[stage] ?? MOCK_SCENES["Attention"],
    headline: MOCK_HEADLINES[stage] ?? MOCK_HEADLINES["Attention"],
    secondary: MOCK_SECONDARY[stage] ?? MOCK_SECONDARY["Attention"],
  };
}

// ── Image mock ───────────────────────────────────────────────────────────

/**
 * Generate a minimal valid PNG image buffer.
 * Creates a small solid-color image (4x4 px) — enough to prove the
 * image delivery path works end-to-end.
 */
function createMockPng(): Buffer {
  // Minimal 4x4 PNG, solid dark green (#1B4D3E) — brand color
  // Using raw PNG construction with zlib deflate

  const width = 4;
  const height = 4;

  // Build raw image data: each row starts with filter byte (0 = None)
  const rawRows: number[] = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      rawRows.push(0x1b, 0x4d, 0x3e); // RGB
    }
  }

  const rawData = Buffer.from(rawRows);
  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk("IHDR", ihdr);

  // IDAT chunk
  const idatChunk = makeChunk("IDAT", compressed);

  // IEND chunk
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** CRC-32 for PNG chunks */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

const MOCK_PNG = createMockPng();

export async function mockGenerateImage(
  _prompt: string,
  _detectedStage: string,
): Promise<Buffer> {
  await delay(IMAGE_DELAY);
  return MOCK_PNG;
}
